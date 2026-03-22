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

    // /api/machine/profiles → /api/v1/profile/list (wrap array in { profiles })
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

    // Everything else → return 200 with empty JSON (silences errors)
    return Promise.resolve(jsonResponse({}))
  }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
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
