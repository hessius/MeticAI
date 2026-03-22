import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { MachineServiceProvider } from '@/services/machine'
import { AIServiceProvider } from '@/services/ai'
import { isDirectMode } from '@/lib/machineMode'

// Initialize i18n
import './i18n/config'

import "./main.css"
import "./styles/theme.css"
import "./index.css"

// In direct mode (PWA on machine), intercept MeticAI proxy API calls and either
// translate them to Meticulous-native /api/v1/ endpoints or return empty responses.
// The machine only serves /api/v1/... (via espresso-api/axios). All other /api/
// paths are MeticAI-specific and don't exist on the machine.
if (isDirectMode()) {
  const _fetch = window.fetch
  window.fetch = function directModeFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request ? input.url : ''

    // Allow Meticulous machine API (/api/v1/...) and external/non-api URLs
    if (!url.match(/\/api\/(?!v\d)/)) {
      return _fetch(input, init)
    }

    // ── Translate key MeticAI proxy endpoints to Meticulous native API ──

    const method = init?.method?.toUpperCase() || 'GET'

    // POST /api/machine/run-profile/:id → load profile → start
    const runMatch = url.match(/\/api\/machine\/run-profile\/([^/?]+)/)
    if (runMatch && method === 'POST') {
      const profileId = decodeURIComponent(runMatch[1])
      return (async () => {
        // Try loading directly first
        let loadResp = await _fetch(`/api/v1/profile/load/${profileId}`)
        if (!loadResp.ok) {
          // Machine is busy — send stop, then retry with backoff
          await _fetch('/api/v1/action/stop')
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(r => setTimeout(r, 2000))
            loadResp = await _fetch(`/api/v1/profile/load/${profileId}`)
            if (loadResp.ok) break
            const body = await loadResp.json().catch(() => ({})) as {error?: string}
            if (body.error !== 'machine is busy') {
              return jsonResponse({ status: 'error', detail: body.error || 'Load failed' }, 502)
            }
          }
          if (!loadResp.ok) {
            return jsonResponse({ status: 'error', detail: 'Machine busy — try again' }, 409)
          }
        }
        const startResp = await _fetch('/api/v1/action/start')
        return startResp.ok
          ? jsonResponse({ status: 'success', message: 'Profile started' })
          : jsonResponse({ status: 'error', detail: 'Failed to start' }, 502)
      })()
    }

    // POST /api/machine/run-profile-with-overrides/:id → same as run-profile (overrides not supported in direct mode)
    const runOverridesMatch = url.match(/\/api\/machine\/run-profile-with-overrides\/([^/?]+)/)
    if (runOverridesMatch && method === 'POST') {
      const profileId = decodeURIComponent(runOverridesMatch[1])
      return (async () => {
        let loadResp = await _fetch(`/api/v1/profile/load/${profileId}`)
        if (!loadResp.ok) {
          await _fetch('/api/v1/action/stop')
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(r => setTimeout(r, 2000))
            loadResp = await _fetch(`/api/v1/profile/load/${profileId}`)
            if (loadResp.ok) break
            const body = await loadResp.json().catch(() => ({})) as {error?: string}
            if (body.error !== 'machine is busy') {
              return jsonResponse({ status: 'error', detail: body.error || 'Load failed' }, 502)
            }
          }
          if (!loadResp.ok) {
            return jsonResponse({ status: 'error', detail: 'Machine busy — try again' }, 409)
          }
        }
        const startResp = await _fetch('/api/v1/action/start')
        return startResp.ok
          ? jsonResponse({ status: 'success', message: 'Profile started (overrides ignored in direct mode)' })
          : jsonResponse({ status: 'error', detail: 'Failed to start' }, 502)
      })()
    }

    // POST /api/machine/command/start → GET /api/v1/action/start
    if (url.match(/\/api\/machine\/command\/start/) && method === 'POST') {
      return _fetch('/api/v1/action/start').then(r =>
        r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502)
      ).catch(() => jsonResponse({ success: false }, 502))
    }

    // POST /api/machine/command/stop → GET /api/v1/action/stop
    if (url.match(/\/api\/machine\/command\/stop/) && method === 'POST') {
      return _fetch('/api/v1/action/stop').then(r =>
        r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502)
      ).catch(() => jsonResponse({ success: false }, 502))
    }

    // POST /api/machine/command/load-profile → load by name
    if (url.match(/\/api\/machine\/command\/load-profile/) && method === 'POST') {
      return new Response(init?.body || '{}').json().then((body: {name?: string}) => {
        if (!body.name) return jsonResponse({ success: false, message: 'No profile name' }, 400)
        // Find profile ID by name, then load it
        return _fetch('/api/v1/profile/list').then(r => r.json()).then((profiles: {name: string; id: string}[]) => {
          const match = profiles.find(p => p.name === body.name)
          if (!match) return jsonResponse({ success: false, message: 'Profile not found' }, 404)
          return _fetch(`/api/v1/profile/load/${match.id}`).then(r =>
            r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502)
          )
        })
      }).catch(() => jsonResponse({ success: false }, 502))
    }

    // POST /api/profile/import → save to machine (file import) or no-op (machine import)
    if (url.match(/\/api\/profile\/import$/) && method === 'POST') {
      return (async () => {
        try {
          const body = await new Response(init?.body || '{}').json() as {
            profile?: Record<string, unknown>; source?: string; generate_description?: boolean
          }
          const profileName = (body.profile as {name?: string})?.name || 'Unknown'
          if (body.source === 'file' && body.profile) {
            // Upload profile to machine
            const saveResp = await _fetch('/api/v1/profile/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body.profile),
            })
            if (!saveResp.ok) {
              return jsonResponse({ status: 'error', detail: 'Failed to save profile to machine' }, 502)
            }
          }
          return jsonResponse({
            status: 'success',
            entry_id: 'direct-' + Date.now(),
            profile_name: profileName,
            has_description: false,
            uploaded_to_machine: true,
          })
        } catch {
          return jsonResponse({ status: 'error', detail: 'Import failed' }, 500)
        }
      })()
    }

    // POST /api/profile/import-all → return success (profiles already on machine)
    if (url.match(/\/api\/profile\/import-all/) && method === 'POST') {
      return Promise.resolve(jsonResponse({
        status: 'success',
        imported: 0,
        skipped: 0,
        message: 'All profiles already on machine',
      }))
    }

    // DELETE /api/machine/profile/:id → DELETE /api/v1/profile/delete/:id
    const deleteMatch = url.match(/\/api\/machine\/profile\/([^/?]+)$/)
    if (deleteMatch && method === 'DELETE') {
      return _fetch(`/api/v1/profile/delete/${deleteMatch[1]}`, { method: 'DELETE' })
        .then(r => r.ok ? jsonResponse({ success: true }) : jsonResponse({ success: false }, 502))
        .catch(() => jsonResponse({ success: false }, 502))
    }

    // GET /api/machine/profiles → /api/v1/profile/list (wrap array in { profiles })
    if (url.match(/\/api\/machine\/profiles$/)) {
      return _fetch('/api/v1/profile/list').then(r => {
        if (!r.ok) return jsonResponse({ profiles: [] })
        return r.json().then((data: unknown[]) =>
          jsonResponse({ profiles: data })
        )
      }).catch(() => jsonResponse({ profiles: [] }))
    }

    // /api/machine/profile/:id/json → /api/v1/profile/get/:id
    const profileJsonMatch = url.match(/\/api\/machine\/profile\/([^/]+)\/json/)
    if (profileJsonMatch) {
      return _fetch(`/api/v1/profile/get/${profileJsonMatch[1]}`).then(r => {
        if (!r.ok) return jsonResponse({})
        return r.json().then((data: unknown) => jsonResponse(data))
      }).catch(() => jsonResponse({}))
    }

    // /api/machine/status → synthetic response (real state comes via Socket.IO)
    if (url.match(/\/api\/machine\/status/)) {
      return Promise.resolve(jsonResponse({
        machine_status: { state: 'idle' },
        scheduled_shots: [],
      }))
    }

    // /api/last-shot → /api/v1/history/last
    if (url.match(/\/api\/last-shot/)) {
      return _fetch('/api/v1/history/last').then(r => {
        if (!r.ok) return jsonResponse({})
        return r.json().then((data: unknown) => jsonResponse(data))
      }).catch(() => jsonResponse({}))
    }

    // /api/history → /api/v1/history (translate response format)
    if (url.match(/\/api\/history/)) {
      return _fetch('/api/v1/history').then(r => {
        if (!r.ok) return jsonResponse({ entries: [], total: 0 })
        return r.json().then((data: unknown) => {
          if (Array.isArray(data)) {
            return jsonResponse({ entries: data, total: data.length })
          }
          return jsonResponse({ entries: [], total: 0, ...data as object })
        })
      }).catch(() => jsonResponse({ entries: [], total: 0 }))
    }

    // POST /api/machine/preheat → GET /api/v1/action/preheat
    if (url.match(/\/api\/machine\/preheat/) && method === 'POST') {
      return _fetch('/api/v1/action/preheat').then(r =>
        r.ok
          ? jsonResponse({ status: 'success', message: 'Preheat started' })
          : jsonResponse({ status: 'error', detail: 'Preheat failed' }, 502)
      ).catch(() => jsonResponse({ status: 'error', detail: 'Preheat failed' }, 502))
    }

    // POST /api/machine/schedule-shot → load profile now and schedule start via setTimeout
    if (url.match(/\/api\/machine\/schedule-shot/) && method === 'POST') {
      return (async () => {
        try {
          const body = await new Response(init?.body || '{}').json() as {
            profile_id?: string; scheduled_time?: string; preheat?: boolean
          }

          // If preheat requested, start it immediately
          if (body.preheat) {
            await _fetch('/api/v1/action/preheat')
          }

          // Calculate delay until scheduled time
          if (body.profile_id && body.scheduled_time) {
            const delay = new Date(body.scheduled_time).getTime() - Date.now()
            if (delay > 0) {
              // Schedule the profile run after delay
              setTimeout(async () => {
                try {
                  const loadResp = await _fetch(`/api/v1/profile/load/${body.profile_id}`)
                  if (loadResp.ok) {
                    await _fetch('/api/v1/action/start')
                  }
                } catch { /* best effort */ }
              }, delay)
            }
          }

          return jsonResponse({
            status: 'success',
            scheduled_shot: {
              id: 'direct-' + Date.now(),
              profile_id: body.profile_id,
              scheduled_time: body.scheduled_time,
              preheat: body.preheat || false,
            },
          })
        } catch {
          return jsonResponse({ status: 'error', detail: 'Schedule failed' }, 500)
        }
      })()
    }

    // /api/machine/profiles/orphaned → empty list (no MeticAI DB in direct mode)
    if (url.match(/\/api\/machine\/profiles\/orphaned/)) {
      return Promise.resolve(jsonResponse({ orphaned: [] }))
    }

    // /api/profiles/sync/status → no sync needed in direct mode
    if (url.match(/\/api\/profiles\/sync\/status/)) {
      return Promise.resolve(jsonResponse({ new_count: 0, updated_count: 0, orphaned_count: 0 }))
    }

    // POST /api/profiles/sync → no-op in direct mode
    if (url.match(/\/api\/profiles\/sync/) && method === 'POST') {
      return Promise.resolve(jsonResponse({ synced: 0, updated: [], created: [], orphaned: [] }))
    }

    // Everything else → return 200 with empty JSON (silences errors)
    return Promise.resolve(jsonResponse({}))
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <MachineServiceProvider>
        <AIServiceProvider>
          <App />
        </AIServiceProvider>
      </MachineServiceProvider>
    </ThemeProvider>
   </ErrorBoundary>
)
