import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from 'next-themes'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { MachineServiceProvider } from '@/services/machine'
import { AIServiceProvider } from '@/services/ai'
import { isDirectMode } from '@/lib/machineMode'
import { createBrowserAIService } from '@/services/ai/BrowserAIService'

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

  // Cache profile list data so /api/profile/{name} and image-proxy lookups work
  interface CachedProfile { id: string; name: string; display?: { image?: string; description?: string; shortDescription?: string; accentColor?: string } }
  const _profileCache = new Map<string, CachedProfile>()
  const PROFILE_LIST_CACHE_KEY = 'meticai-direct-profile-list'

  function _processProfileList(data: CachedProfile[]) {
    _profileCache.clear()
    for (const p of data) _profileCache.set(p.name, p)
    const result = {
      profiles: data.map(p => ({
        ...p,
        in_history: true,
        has_description: !!(p.display?.description || p.display?.shortDescription),
      }))
    }
    try { localStorage.setItem(PROFILE_LIST_CACHE_KEY, JSON.stringify(result)) } catch { /* ignore */ }
    return result
  }

  // Restore profile cache from localStorage on startup
  try {
    const stored = localStorage.getItem(PROFILE_LIST_CACHE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed?.profiles) {
        for (const p of parsed.profiles) _profileCache.set(p.name, p)
      }
    }
  } catch { /* ignore */ }

  // ── Static profile description cache ──────────────────────────────────────
  // Stores the full "Profile Created / Description / Preparation / …" text
  // keyed by profile ID.  Persisted to localStorage and exposed on window so
  // App.tsx can read descriptions when navigating to profile detail.
  const DESC_CACHE_KEY = 'meticai-direct-desc-cache'
  const _descriptionCache = new Map<string, string>()
  try {
    const stored = localStorage.getItem(DESC_CACHE_KEY)
    if (stored) {
      const parsed: Record<string, string> = JSON.parse(stored)
      for (const [k, v] of Object.entries(parsed)) _descriptionCache.set(k, v)
    }
  } catch { /* ignore */ }

  function _persistDescriptionCache() {
    try {
      const obj: Record<string, string> = {}
      _descriptionCache.forEach((v, k) => { obj[k] = v })
      localStorage.setItem(DESC_CACHE_KEY, JSON.stringify(obj))
    } catch { /* ignore */ }
  }

  // Expose on window for App.tsx to read
  ;(window as unknown as Record<string, unknown>).__meticaiDescriptionCache = _descriptionCache

  // Background: generate static descriptions for every profile on the machine.
  // Fetches each profile's JSON sequentially (1 at a time) to avoid overloading
  // the machine, then runs the client-side static analysis.
  async function _generateDescriptionsInBackground(profiles: CachedProfile[]) {
    const { buildStaticProfileDescription } = await import('@/lib/staticProfileDescription')
    for (const p of profiles) {
      if (_descriptionCache.has(p.id)) continue          // already described
      try {
        const r = await _fetch(`/api/v1/profile/get/${p.id}`)
        if (!r.ok) continue
        const profileJson = await r.json()
        const desc = buildStaticProfileDescription(profileJson)
        _descriptionCache.set(p.id, desc)
      } catch { /* non-critical */ }
    }
    _persistDescriptionCache()
  }

  // Background prefetch: refresh profile list on startup so catalogue loads instantly
  setTimeout(() => {
    _fetch('/api/v1/profile/list')
      .then(r => r.ok ? r.json() : null)
      .then((data: CachedProfile[] | null) => {
        if (data) {
          _processProfileList(data)
          // Kick off background description generation
          _generateDescriptionsInBackground(data)
        }
      })
      .catch(() => { /* non-critical */ })
  }, 2000)

  // ── Pour-over profile adapters (ported from backend pour_over_adapter.py / recipe_adapter.py) ──

  const _POUR_OVER_BASE = {
    name: 'MeticAI Ratio Pour-Over',
    id: '', // will be replaced
    author: 'MeticAI',
    author_id: '',
    display: { accentColor: '#566656' },
    temperature: 0,
    final_weight: 300,
    variables: [{ name: 'Zero', key: 'power_Zero', type: 'power', value: 0 }],
    stages: [
      {
        name: 'Bloom (30s)', key: 'power_1', type: 'power',
        dynamics: { points: [[0, '$power_Zero'], [10, '$power_Zero']], over: 'time', interpolation: 'curve' },
        exit_triggers: [{ type: 'time', value: 30, relative: false, comparison: '>=' }],
        limits: [],
      },
      {
        name: 'Infusion (300g)', key: 'power_2', type: 'power',
        dynamics: { points: [[0, '$power_Zero'], [10, '$power_Zero']], over: 'time', interpolation: 'curve' },
        exit_triggers: [{ type: 'weight', value: 300, relative: false, comparison: '>=' }],
        limits: [],
      },
    ],
  }

  const _STAGE_TEMPLATE = {
    type: 'power',
    dynamics: { points: [[0, '$power_Zero'], [10, '$power_Zero']], over: 'time', interpolation: 'curve' },
    limits: [],
  }

  function _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  function _adaptPourOverProfile(opts: { targetWeight: number; bloomEnabled: boolean; bloomSeconds: number; doseGrams: number | null; brewRatio: number | null }) {
    const profile = JSON.parse(JSON.stringify(_POUR_OVER_BASE))
    profile.id = _uuid()
    profile.author_id = _uuid()
    profile.final_weight = opts.targetWeight
    const weightLabel = `${Math.round(opts.targetWeight)}g`

    // Short description
    const parts = [`Target: ${weightLabel}`]
    if (opts.doseGrams) parts.push(`Dose: ${opts.doseGrams.toFixed(1)}g`)
    if (opts.brewRatio) parts.push(`Ratio: 1:${opts.brewRatio.toFixed(1)}`)
    profile.display = { ...profile.display, shortDescription: parts.join(' | ').slice(0, 99) }

    const stages = profile.stages
    if (opts.bloomEnabled && stages.length >= 2) {
      stages[0].name = `Bloom (${Math.round(opts.bloomSeconds)}s)`
      for (const t of stages[0].exit_triggers) if (t.type === 'time') t.value = opts.bloomSeconds
      stages[1].name = `Infusion (${weightLabel})`
      for (const t of stages[1].exit_triggers) if (t.type === 'weight') t.value = opts.targetWeight
      // Add 10-min time backup if missing
      if (!stages[1].exit_triggers.some((t: { type: string }) => t.type === 'time')) {
        stages[1].exit_triggers.push({ type: 'time', value: 600, relative: true, comparison: '>=' })
      }
    } else if (!opts.bloomEnabled && stages.length >= 2) {
      const infusion = stages[1]
      infusion.name = `Infusion (${weightLabel})`
      infusion.key = 'power_1'
      for (const t of infusion.exit_triggers) if (t.type === 'weight') t.value = opts.targetWeight
      if (!infusion.exit_triggers.some((t: { type: string }) => t.type === 'time')) {
        infusion.exit_triggers.push({ type: 'time', value: 600, relative: true, comparison: '>=' })
      }
      profile.stages = [infusion]
    }
    return profile
  }

  interface OPOSStep { step?: number; action: string; water_g?: number; duration_s?: number; notes?: string }

  function _adaptRecipeToProfile(recipe: { metadata?: { name?: string }; ingredients?: { water_g?: number; coffee_g?: number }; protocol?: OPOSStep[] }) {
    const profile = JSON.parse(JSON.stringify(_POUR_OVER_BASE))
    profile.id = _uuid()
    profile.author_id = _uuid()
    const recipeName = recipe.metadata?.name ?? 'Recipe'
    profile.name = `MeticAI Recipe: ${recipeName}`
    const totalWater = Number(recipe.ingredients?.water_g ?? 0)
    const coffeeG = Number(recipe.ingredients?.coffee_g ?? 0) || null
    profile.final_weight = totalWater

    const parts = [`Target: ${Math.round(totalWater)}g`]
    if (coffeeG) {
      parts.push(`Dose: ${Math.round(coffeeG)}g`)
      parts.push(`Ratio: 1:${(totalWater / coffeeG).toFixed(1)}`)
    }
    profile.display = { ...profile.display, shortDescription: parts.join(' | ').slice(0, 99) }

    const stages: typeof _POUR_OVER_BASE.stages = []
    let cumulativeWater = 0
    let pourCount = 0

    for (const step of (recipe.protocol ?? [])) {
      const action = step.action ?? ''
      const waterG = Number(step.water_g ?? 0)
      const durationS = Number(step.duration_s ?? 30)
      const stage = JSON.parse(JSON.stringify(_STAGE_TEMPLATE))
      stage.key = `power_${stages.length + 1}`

      if (action === 'bloom' || action === 'pour') {
        cumulativeWater += waterG
        if (action === 'bloom') {
          stage.name = `Bloom (${Math.round(waterG)}g / ${Math.round(durationS)}s)`
          stage.exit_triggers = [{ type: 'time', value: durationS, relative: true, comparison: '>=' }]
        } else {
          pourCount++
          stage.name = `Pour ${pourCount} (to ${Math.round(cumulativeWater)}g)`
          stage.exit_triggers = [
            { type: 'weight', value: cumulativeWater, relative: false, comparison: '>=' },
            { type: 'time', value: 600, relative: true, comparison: '>=' },
          ]
        }
      } else if (action === 'wait' || action === 'swirl' || action === 'stir') {
        stage.name = action === 'swirl' ? 'Swirl' : action === 'stir' ? 'Stir' : `Wait (${Math.round(durationS)}s)`
        stage.exit_triggers = [{ type: 'time', value: durationS, relative: true, comparison: '>=' }]
      } else {
        continue
      }

      stages.push(stage)
    }

    profile.stages = stages
    return profile
  }

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

    // POST /api/machine/profile/load → load by ID on machine
    if (url.match(/\/api\/machine\/profile\/load$/) && method === 'POST') {
      return (async () => {
        try {
          const { profile_id } = await new Response(init?.body || '{}').json() as { profile_id?: string }
          if (!profile_id) return jsonResponse({ success: false, message: 'No profile_id' }, 400)
          let loadResp = await _fetch(`/api/v1/profile/load/${profile_id}`)
          if (!loadResp.ok) {
            // Machine may be busy — send stop, then retry
            await _fetch('/api/v1/action/stop')
            await new Promise(r => setTimeout(r, 2000))
            loadResp = await _fetch(`/api/v1/profile/load/${profile_id}`)
          }
          if (!loadResp.ok) return jsonResponse({ success: false }, 502)
          return jsonResponse({ success: true })
        } catch {
          return jsonResponse({ success: false }, 500)
        }
      })()
    }

    // GET /api/machine/profiles → /api/v1/profile/list (add in_history/has_description, populate cache)
    if (url.match(/\/api\/machine\/profiles$/)) {
      return _fetch('/api/v1/profile/list').then(r => {
        if (!r.ok) {
          // Return cached data if fetch fails
          const cached = localStorage.getItem(PROFILE_LIST_CACHE_KEY)
          if (cached) return jsonResponse(JSON.parse(cached))
          return jsonResponse({ profiles: [] })
        }
        return r.json().then((data: CachedProfile[]) => jsonResponse(_processProfileList(data)))
      }).catch(() => {
        const cached = localStorage.getItem(PROFILE_LIST_CACHE_KEY)
        if (cached) return jsonResponse(JSON.parse(cached))
        return jsonResponse({ profiles: [] })
      })
    }

    // /api/machine/profile/:id/json → /api/v1/profile/get/:id (wrap in {profile})
    const profileJsonMatch = url.match(/\/api\/machine\/profile\/([^/]+)\/json/)
    if (profileJsonMatch) {
      return _fetch(`/api/v1/profile/get/${profileJsonMatch[1]}`).then(r => {
        if (!r.ok) return jsonResponse({})
        return r.json().then((data: unknown) => jsonResponse({ profile: data }))
      }).catch(() => jsonResponse({}))
    }

    // GET /api/profile/{name}/image-proxy → proxy to machine image URL from cache
    const imageProxyMatch = url.match(/\/api\/profile\/([^/]+)\/image-proxy/)
    if (imageProxyMatch) {
      const name = decodeURIComponent(imageProxyMatch[1])
      const cached = _profileCache.get(name)
      if (cached?.display?.image) {
        // Redirect to the machine's static image URL
        return _fetch(cached.display.image)
      }
      return Promise.resolve(new Response('', { status: 404 }))
    }

    // GET /api/profile/{name} → lookup from cache, return {profile: {...}}
    const profileByNameMatch = url.match(/\/api\/profile\/([^/]+)$/)
    if (profileByNameMatch && method === 'GET') {
      const name = decodeURIComponent(profileByNameMatch[1])
      const cached = _profileCache.get(name)
      if (cached) {
        return Promise.resolve(jsonResponse({ profile: { name: cached.name, id: cached.id, display: cached.display } }))
      }
      return Promise.resolve(jsonResponse({}))
    }

    // /api/machine/status → synthetic response (real state comes via Socket.IO)
    if (url.match(/\/api\/machine\/status/)) {
      return Promise.resolve(jsonResponse({
        machine_status: { state: 'idle' },
        scheduled_shots: [],
      }))
    }

    // /api/last-shot → /api/v1/history/last (translate to MeticAI format)
    if (url.match(/\/api\/last-shot/)) {
      return _fetch('/api/v1/history/last').then(r => {
        if (!r.ok) return jsonResponse({})
        return r.json().then((e: {id?: string; time?: number; name?: string; profile?: {name?: string}}) =>
          jsonResponse({
            id: e.id,
            created_at: e.time ? new Date(e.time * 1000).toISOString() : null,
            profile_name: e.profile?.name ?? e.name ?? 'Unknown',
            coffee_analysis: null,
            user_preferences: null,
            reply: '',
            profile_json: e.profile ?? null,
          })
        )
      }).catch(() => jsonResponse({}))
    }

    // /api/history → /api/v1/history (translate machine history to MeticAI format)
    if (url.match(/\/api\/history/)) {
      return _fetch('/api/v1/history').then(r => {
        if (!r.ok) return jsonResponse({ entries: [], total: 0, limit: 50, offset: 0 })
        return r.json().then((raw: unknown) => {
          type MachineHistEntry = {
            id: string; time: number; name: string;
            profile?: {name?: string; final_weight?: number; temperature?: number};
            data?: {shot?: {weight?: number}; time?: number}[];
          }
          const list: MachineHistEntry[] = Array.isArray(raw) ? raw : ((raw as {history?: MachineHistEntry[]}).history ?? [])
          const entries = list.map(e => ({
            id: e.id,
            created_at: new Date(e.time * 1000).toISOString(),
            profile_name: e.profile?.name ?? e.name ?? 'Unknown',
            coffee_analysis: null,
            user_preferences: null,
            reply: '',
            profile_json: e.profile ?? null,
            notes: null,
          }))
          return jsonResponse({ entries, total: entries.length, limit: 50, offset: 0 })
        })
      }).catch(() => jsonResponse({ entries: [], total: 0, limit: 50, offset: 0 }))
    }

    // POST /api/machine/preheat → GET /api/v1/action/preheat
    if (url.match(/\/api\/machine\/preheat/) && method === 'POST') {
      return _fetch('/api/v1/action/preheat').then(r =>
        r.ok
          ? jsonResponse({ status: 'success', message: 'Preheat started' })
          : jsonResponse({ status: 'error', detail: 'Preheat failed' }, 502)
      ).catch(() => jsonResponse({ status: 'error', detail: 'Preheat failed' }, 502))
    }

    // POST /api/machine/schedule-shot → not supported in direct mode
    // (feature flag scheduledShots=false already hides the UI, but be explicit)
    if (url.match(/\/api\/machine\/schedule-shot/) && method === 'POST') {
      return jsonResponse({
        status: 'error',
        detail: 'Scheduled shots are not supported in direct mode. Use the machine UI or MeticAI Docker mode.',
      }, 501)
    }

    // /api/machine/profiles/orphaned → empty list (no MeticAI DB in direct mode)
    if (url.match(/\/api\/machine\/profiles\/orphaned/)) {
      return Promise.resolve(jsonResponse({ orphaned: [] }))
    }

    // GET /api/shots/recent/by-profile → /api/v1/history (group entries by profile)
    if (url.match(/\/api\/shots\/recent\/by-profile/)) {
      return _fetch('/api/v1/history').then(r => {
        if (!r.ok) return jsonResponse({ profiles: [] })
        return r.json().then((raw: unknown) => {
          type HistEntry = {
            id: string; time: number; name: string; file?: string;
            profile?: { name?: string; id?: string; final_weight?: number };
            data?: { shot?: { weight?: number }; time?: number; profile_time?: number }[];
          }
          const list: HistEntry[] = Array.isArray(raw) ? raw : ((raw as { history?: HistEntry[] }).history ?? [])
          const groups = new Map<string, { profile_name: string; profile_id: string; shots: unknown[]; shot_count: number }>()
          for (const e of list) {
            const pName = e.profile?.name ?? e.name ?? 'Unknown'
            const pId = e.profile?.id ?? e.id
            const lastPt = e.data?.[e.data.length - 1]
            const totalTimeMs = lastPt?.profile_time ?? lastPt?.time
            const shot = {
              profile_name: pName,
              profile_id: pId,
              date: new Date(e.time * 1000).toISOString().split('T')[0],
              filename: e.file ?? `${e.id}.json`,
              timestamp: e.time,
              final_weight: lastPt?.shot?.weight ?? e.profile?.final_weight ?? null,
              total_time: totalTimeMs ? totalTimeMs / 1000 : null,
              has_annotation: false,
            }
            if (!groups.has(pName)) {
              groups.set(pName, { profile_name: pName, profile_id: pId, shots: [], shot_count: 0 })
            }
            const g = groups.get(pName)!
            g.shots.push(shot)
            g.shot_count++
          }
          return jsonResponse({ profiles: Array.from(groups.values()) })
        })
      }).catch(() => jsonResponse({ profiles: [] }))
    }

    // GET /api/shots/recent → /api/v1/history (translate entries to RecentShot format)
    if (url.match(/\/api\/shots\/recent/)) {
      return _fetch('/api/v1/history').then(r => {
        if (!r.ok) return jsonResponse({ shots: [] })
        return r.json().then((raw: unknown) => {
          type HistEntry = {
            id: string; time: number; name: string; file?: string;
            profile?: { name?: string; id?: string; final_weight?: number };
            data?: { shot?: { weight?: number }; time?: number; profile_time?: number }[];
          }
          const list: HistEntry[] = Array.isArray(raw) ? raw : ((raw as { history?: HistEntry[] }).history ?? [])
          const shots = list.map(e => {
            const lastPt = e.data?.[e.data.length - 1]
            const totalTimeMs = lastPt?.profile_time ?? lastPt?.time
            return {
              profile_name: e.profile?.name ?? e.name ?? 'Unknown',
              profile_id: e.profile?.id ?? e.id,
              date: new Date(e.time * 1000).toISOString().split('T')[0],
              filename: e.file ?? `${e.id}.json`,
              timestamp: e.time,
              final_weight: lastPt?.shot?.weight ?? e.profile?.final_weight ?? null,
              total_time: totalTimeMs ? totalTimeMs / 1000 : null,
              has_annotation: false,
            }
          })
          return jsonResponse({ shots })
        })
      }).catch(() => jsonResponse({ shots: [] }))
    }

    // GET /api/shots/by-profile/:profileName → /api/v1/history (filter by profile name)
    const byProfileMatch = url.match(/\/api\/shots\/by-profile\/([^?]+)/)
    if (byProfileMatch) {
      const profileName = decodeURIComponent(byProfileMatch[1])
      return _fetch('/api/v1/history').then(r => {
        if (!r.ok) return jsonResponse({ profile_name: profileName, shots: [], count: 0, limit: 20 })
        return r.json().then((raw: unknown) => {
          type HistEntry = {
            id: string; time: number; name: string; file?: string;
            profile?: { name?: string; id?: string; final_weight?: number; temperature?: number; author?: string; stages?: unknown[] };
            data?: { shot?: { pressure?: number; flow?: number; weight?: number }; time?: number; profile_time?: number; sensors?: { external_1?: number } }[];
          }
          const all: HistEntry[] = Array.isArray(raw) ? raw : ((raw as { history?: HistEntry[] }).history ?? [])
          const filtered = all.filter(e => (e.profile?.name ?? e.name) === profileName)
          const shots = filtered.map(e => {
            const lastPt = e.data?.[e.data.length - 1]
            const totalTimeMs = lastPt?.profile_time ?? lastPt?.time
            return {
              date: new Date(e.time * 1000).toISOString().split('T')[0],
              filename: e.file ?? `${e.id}.json`,
              timestamp: String(e.time),
              profile_name: e.profile?.name ?? e.name ?? 'Unknown',
              final_weight: lastPt?.shot?.weight ?? e.profile?.final_weight ?? null,
              total_time: totalTimeMs ? totalTimeMs / 1000 : null,
            }
          })
          return jsonResponse({ profile_name: profileName, shots, count: shots.length, limit: 20 })
        })
      }).catch(() => jsonResponse({ profile_name: profileName, shots: [], count: 0, limit: 20 }))
    }

    // GET /api/shots/data/:date/:filename → /api/v1/history (find entry and convert data)
    const shotDataMatch = url.match(/\/api\/shots\/data\/([^/]+)\/(.+?)(?:\?|$)/)
    if (shotDataMatch) {
      const shotDate = decodeURIComponent(shotDataMatch[1])
      const shotFilename = decodeURIComponent(shotDataMatch[2])
      return _fetch('/api/v1/history').then(r => {
        if (!r.ok) return jsonResponse({}, 404)
        return r.json().then((raw: unknown) => {
          type HistEntry = {
            id: string; time: number; name: string; file?: string;
            profile?: { name?: string; id?: string; final_weight?: number; temperature?: number; author?: string; stages?: { name: string; type: string; key?: string }[] };
            data?: { shot?: { pressure?: number; flow?: number; weight?: number }; time?: number; profile_time?: number; sensors?: { external_1?: number } }[];
          }
          const all: HistEntry[] = Array.isArray(raw) ? raw : ((raw as { history?: HistEntry[] }).history ?? [])
          const entry = all.find(e => {
            const eDate = new Date(e.time * 1000).toISOString().split('T')[0]
            const eFile = e.file ?? `${e.id}.json`
            return eDate === shotDate && eFile === shotFilename
          })
          if (!entry) return jsonResponse({ detail: 'Shot not found' }, 404)
          const pts = entry.data ?? []
          const timeArr: number[] = []
          const pressureArr: number[] = []
          const flowArr: number[] = []
          const weightArr: number[] = []
          const temperatureArr: number[] = []
          for (const pt of pts) {
            timeArr.push((pt.profile_time ?? pt.time ?? 0) / 1000)
            pressureArr.push(pt.shot?.pressure ?? 0)
            flowArr.push(pt.shot?.flow ?? 0)
            weightArr.push(pt.shot?.weight ?? 0)
            temperatureArr.push(pt.sensors?.external_1 ?? 0)
          }
          const lastPt = pts[pts.length - 1]
          const shotData = {
            date: shotDate,
            filename: shotFilename,
            data: {
              profile: {
                name: entry.profile?.name ?? entry.name ?? 'Unknown',
                author: entry.profile?.author,
                temperature: entry.profile?.temperature,
                final_weight: entry.profile?.final_weight,
                stages: entry.profile?.stages?.map(s => ({ name: s.name, type: s.type, key: s.key })),
              },
              start_time: new Date(entry.time * 1000).toISOString(),
              elapsed_time: lastPt ? (lastPt.profile_time ?? lastPt.time ?? 0) / 1000 : 0,
              final_weight: lastPt?.shot?.weight ?? entry.profile?.final_weight ?? null,
              data: { time: timeArr, pressure: pressureArr, flow: flowArr, weight: weightArr, temperature: temperatureArr },
            }
          }
          return jsonResponse(shotData)
        })
      }).catch(() => jsonResponse({ detail: 'Failed to load shot data' }, 500))
    }

    // GET /api/shots/annotations → return empty in direct mode
    if (url.match(/\/api\/shots\/annotations/)) {
      return Promise.resolve(jsonResponse({ annotations: {} }))
    }

    // GET /api/shots/llm-analysis-cache → no cache in direct mode
    if (url.match(/\/api\/shots\/llm-analysis-cache/)) {
      return Promise.resolve(jsonResponse({ cached: false }))
    }

    // GET /api/shots/dates → derive from history
    if (url.match(/\/api\/shots\/dates/) && method === 'GET') {
      return _fetch('/api/v1/history').then(r => {
        if (!r.ok) return jsonResponse([])
        return r.json().then((raw: unknown) => {
          type HE = { time: number }
          const all: HE[] = Array.isArray(raw) ? raw : ((raw as { history?: HE[] }).history ?? [])
          const dates = [...new Set(all.map(e => new Date(e.time * 1000).toISOString().split('T')[0]))]
          dates.sort((a, b) => b.localeCompare(a))
          return jsonResponse(dates)
        })
      }).catch(() => jsonResponse([]))
    }

    // POST /api/shots/analyze → compute structured LocalAnalysisResult from shot telemetry
    if (url.match(/\/api\/shots\/analyze$/) && method === 'POST') {
      return (async () => {
        try {
          const body = init?.body as FormData
          const shotDate = (body.get('shot_date') as string) || ''
          const shotFilename = (body.get('shot_filename') as string) || ''
          const profileName = (body.get('profile_name') as string) || 'Unknown'

          // Fetch shot data from machine
          const histResp = await _fetch('/api/v1/history')
          if (!histResp.ok) return jsonResponse({ status: 'error', message: 'Failed to load history' })
          const raw = await histResp.json() as unknown
          /* eslint-disable @typescript-eslint/no-explicit-any */
          type HistStage = { name: string; type: string; key?: string; dynamics?: any; exit_triggers?: any[]; limits?: any[] }
          type HistVar = { key: string; name: string; type: string; value: number }
          type HistEntry = {
            id: string; time: number; name: string; file?: string;
            profile?: { name?: string; final_weight?: number; temperature?: number; stages?: HistStage[]; variables?: HistVar[] };
            data?: { shot?: { pressure?: number; flow?: number; weight?: number; gravimetric_flow?: number }; time?: number; profile_time?: number; status?: string }[];
          }
          /* eslint-enable @typescript-eslint/no-explicit-any */
          const all: HistEntry[] = Array.isArray(raw) ? raw : ((raw as { history?: HistEntry[] }).history ?? [])
          const entry = all.find(e => {
            const eDate = new Date(e.time * 1000).toISOString().split('T')[0]
            const eFile = e.file ?? `${e.id}.json`
            return eDate === shotDate && eFile === shotFilename
          })
          if (!entry) return jsonResponse({ status: 'error', message: 'Shot not found' })

          // ── Helper functions (matching server analysis_service.py) ──

          const _sf = (v: unknown, d = 0): number => {
            if (v == null) return d
            const n = Number(v)
            return Number.isFinite(n) ? n : d
          }
          const _round1 = (v: number) => Math.round(v * 10) / 10

          const _resolveVar = (val: unknown, vars: HistVar[]): number => {
            if (typeof val === 'string' && val.startsWith('$')) {
              const key = val.slice(1)
              const v = vars.find(x => x.key === key)
              return v ? _sf(v.value) : 0
            }
            return _sf(val)
          }

          const FLOW_IGNORE_WINDOW = 3.5
          const PREINFUSION_KW = ['bloom', 'soak', 'preinfusion', 'pre-infusion', 'pre infusion', 'wet', 'fill', 'landing']

          // ── Extract per-stage telemetry ──
          const pts = entry.data ?? []
          type StageStats = {
            startTime: number; endTime: number; duration: number
            startWeight: number; endWeight: number
            startPressure: number; endPressure: number; avgPressure: number; maxPressure: number; minPressure: number
            startFlow: number; endFlow: number; avgFlow: number; maxFlow: number
          }
          const shotStages = new Map<string, StageStats>()
          {
            let curStage: string | null = null
            let stagePts: typeof pts = []
            const flush = () => {
              if (!curStage || stagePts.length === 0) return
              const times = stagePts.map(p => (p.time ?? 0) / 1000)
              const prs = stagePts.map(p => p.shot?.pressure ?? 0)
              const wts = stagePts.map(p => p.shot?.weight ?? 0)
              const fls = stagePts.map(p => p.shot?.flow ?? 0)
              const flsFiltered = stagePts.filter(p => (p.time ?? 0) / 1000 >= FLOW_IGNORE_WINDOW).map(p => p.shot?.flow ?? 0)
              const flowSrc = flsFiltered.length > 0 ? flsFiltered : fls
              shotStages.set(curStage, {
                startTime: Math.min(...times), endTime: Math.max(...times),
                duration: Math.max(...times) - Math.min(...times),
                startWeight: wts[0], endWeight: wts[wts.length - 1],
                startPressure: prs[0], endPressure: prs[prs.length - 1],
                avgPressure: prs.reduce((a, b) => a + b, 0) / prs.length,
                maxPressure: Math.max(...prs), minPressure: Math.min(...prs),
                startFlow: fls[0], endFlow: fls[fls.length - 1],
                avgFlow: flowSrc.reduce((a, b) => a + b, 0) / flowSrc.length,
                maxFlow: Math.max(...flowSrc),
              })
            }
            for (const pt of pts) {
              const st = (pt.status ?? '').trim()
              if (!st || st.toLowerCase() === 'retracting') continue
              if (st !== curStage) { flush(); curStage = st; stagePts = [] }
              stagePts.push(pt)
            }
            flush()
          }

          // ── Overall metrics ──
          let maxPressure = 0, maxFlow = 0
          for (const pt of pts) {
            if ((pt.shot?.pressure ?? 0) > maxPressure) maxPressure = pt.shot?.pressure ?? 0
            const t = (pt.time ?? 0) / 1000
            if (t >= FLOW_IGNORE_WINDOW && (pt.shot?.flow ?? 0) > maxFlow) maxFlow = pt.shot?.flow ?? 0
          }
          const lastPt = pts[pts.length - 1]
          const finalWeight = lastPt?.shot?.weight ?? entry.profile?.final_weight ?? 0
          const totalTime = lastPt ? (lastPt.profile_time ?? lastPt.time ?? 0) / 1000 : 0
          const targetWeight = entry.profile?.final_weight ?? null

          // ── Format helpers ──
          const vars = entry.profile?.variables ?? []
          const unitMap: Record<string, string> = { time: 's', weight: 'g', pressure: 'bar', flow: 'ml/s' }
          const compMap: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '=' }

          const fmtDynamics = (stage: HistStage): string => {
            const dp = stage.dynamics?.points ?? []
            if (!dp.length) return `${stage.type} stage`
            const unit = stage.type === 'pressure' ? 'bar' : 'ml/s'
            if (dp.length === 1) {
              const v = _resolveVar(dp[0][1] ?? dp[0][0], vars)
              return `Constant ${stage.type} at ${v} ${unit}`
            }
            if (dp.length === 2) {
              const sy = _resolveVar(dp[0][1], vars), ey = _resolveVar(dp[1][1], vars), ex = _sf(dp[1][0])
              const ou = (stage.dynamics?.over ?? 'time') === 'time' ? 's' : 'g'
              if (sy === ey) return `Constant ${stage.type} at ${sy} ${unit} for ${ex}${ou}`
              const dir = ey > sy ? 'ramp up' : 'ramp down'
              return `${stage.type[0].toUpperCase() + stage.type.slice(1)} ${dir} from ${sy} to ${ey} ${unit} over ${ex}${ou}`
            }
            const vals = dp.map((p: number[]) => _resolveVar(p[1], vars))
            return `${stage.type[0].toUpperCase() + stage.type.slice(1)} curve: ${vals.join(' → ')} ${unit}`
          }

          const fmtTriggers = (triggers: any[]) => triggers.map((t: any) => {
            const v = _resolveVar(t.value, vars)
            const c = compMap[t.comparison] ?? t.comparison
            const u = unitMap[t.type] ?? ''
            return { type: t.type, value: v, comparison: t.comparison, description: `${t.type} ${c} ${v}${u}` }
          })

          const fmtLimits = (limits: any[]) => limits.map((l: any) => {
            const v = _resolveVar(l.value, vars)
            const u = unitMap[l.type] ?? ''
            return { type: l.type, value: v, description: `Limit ${l.type} to ${v}${u}` }
          })

          // ── Stage analysis ──
          const profileStages = entry.profile?.stages ?? []
          const stageAnalyses: any[] = []
          const unreachedStages: string[] = []
          let preinfusionTime = 0
          const preinfusionStages: string[] = []

          for (const ps of profileStages) {
            const stageName = (ps.name ?? '').trim()
            const stageType = ps.type ?? 'unknown'
            // Match shot stage by name (trimmed, case-insensitive)
            let shotData: StageStats | undefined
            for (const [k, v] of shotStages) {
              if (k.trim().toLowerCase() === stageName.toLowerCase()) { shotData = v; break }
            }

            const profileTarget = fmtDynamics(ps)
            const exitTriggers = fmtTriggers(ps.exit_triggers ?? [])
            const limits = fmtLimits(ps.limits ?? [])
            const executed = !!shotData

            const stageResult: any = {
              stage_name: stageName,
              stage_key: (ps.key ?? stageName).toLowerCase().replace(/\s+/g, '_'),
              stage_type: stageType,
              profile_target: profileTarget,
              exit_triggers: exitTriggers,
              limits,
              executed,
              execution_data: null,
              exit_trigger_result: null,
              limit_hit: null,
              assessment: null,
            }

            if (!executed) {
              unreachedStages.push(stageName)
              stageResult.assessment = { status: 'not_reached', message: 'This stage was never executed during the shot' }
              stageAnalyses.push(stageResult)
              continue
            }

            const sd = shotData!
            const wGain = sd.endWeight - sd.startWeight
            // Execution description
            const descParts: string[] = []
            const pDelta = sd.endPressure - sd.startPressure
            if (Math.abs(pDelta) > 0.5) {
              descParts.push(pDelta > 0
                ? `Pressure rose from ${_round1(sd.startPressure)} to ${_round1(sd.endPressure)} bar`
                : `Pressure declined from ${_round1(sd.startPressure)} to ${_round1(sd.endPressure)} bar`)
            } else if (sd.maxPressure > 0) {
              descParts.push(`Pressure held around ${_round1((sd.startPressure + sd.endPressure) / 2)} bar`)
            }
            const fDelta = sd.endFlow - sd.startFlow
            if (Math.abs(fDelta) > 0.3) {
              descParts.push(fDelta > 0
                ? `Flow increased from ${_round1(sd.startFlow)} to ${_round1(sd.endFlow)} ml/s`
                : `Flow decreased from ${_round1(sd.startFlow)} to ${_round1(sd.endFlow)} ml/s`)
            } else if (sd.maxFlow > 0) {
              descParts.push(`Flow steady at ${_round1((sd.startFlow + sd.endFlow) / 2)} ml/s`)
            }
            if (wGain > 1) descParts.push(`extracted ${_round1(wGain)}g`)
            if (sd.duration > 0) descParts.push(`over ${_round1(sd.duration)}s`)
            const execDesc = descParts.length > 0 ? descParts.join(', ').replace(/^./, c => c.toUpperCase()) : `Stage executed for ${_round1(sd.duration)}s`

            stageResult.execution_data = {
              duration: _round1(sd.duration), weight_gain: _round1(wGain),
              start_weight: _round1(sd.startWeight), end_weight: _round1(sd.endWeight),
              start_pressure: _round1(sd.startPressure), end_pressure: _round1(sd.endPressure),
              avg_pressure: _round1(sd.avgPressure), max_pressure: _round1(sd.maxPressure), min_pressure: _round1(sd.minPressure),
              start_flow: _round1(sd.startFlow), end_flow: _round1(sd.endFlow),
              avg_flow: _round1(sd.avgFlow), max_flow: _round1(sd.maxFlow),
              description: execDesc,
            }

            // Determine exit trigger hit
            if (ps.exit_triggers?.length) {
              let triggered: any = null
              const notTriggered: any[] = []
              for (const tr of ps.exit_triggers) {
                const tType = tr.type ?? ''
                const tVal = _resolveVar(tr.value, vars)
                const comp = tr.comparison ?? '>='
                let actual = 0
                if (tType === 'time') actual = sd.duration
                else if (tType === 'weight') actual = sd.endWeight
                else if (tType === 'pressure') actual = comp === '>=' || comp === '>' ? sd.maxPressure : sd.endPressure
                else if (tType === 'flow') actual = comp === '>=' || comp === '>' ? sd.maxFlow : sd.endFlow
                const tol = (tType === 'time' || tType === 'weight') ? 0.5 : 0.2
                let hit = false
                if (comp === '>=') hit = actual >= tVal - tol
                else if (comp === '>') hit = actual > tVal
                else if (comp === '<=') hit = actual <= tVal + tol
                else if (comp === '<') hit = actual < tVal
                const u = unitMap[tType] ?? ''
                const info = { type: tType, target: tVal, actual: _round1(actual), description: `${tType} >= ${tVal}${u}` }
                if (hit && !triggered) triggered = info
                else if (!hit) notTriggered.push(info)
              }
              stageResult.exit_trigger_result = { triggered, not_triggered: notTriggered }
            }

            // Limit hit check
            for (const lim of (ps.limits ?? [])) {
              const lType = lim.type ?? ''
              const lVal = _resolveVar(lim.value, vars)
              let actual = 0
              if (lType === 'flow') actual = sd.maxFlow
              else if (lType === 'pressure') actual = sd.maxPressure
              else if (lType === 'time') actual = sd.duration
              else if (lType === 'weight') actual = sd.endWeight
              const u = unitMap[lType] ?? ''
              if (actual >= lVal - 0.2) {
                stageResult.limit_hit = { type: lType, limit_value: lVal, actual_value: _round1(actual), description: `Hit ${lType} limit of ${lVal}${u}` }
                break
              }
            }

            // Assessment
            const etr = stageResult.exit_trigger_result
            if (etr?.triggered) {
              stageResult.assessment = stageResult.limit_hit
                ? { status: 'hit_limit', message: `Stage exited but hit a limit (${stageResult.limit_hit.description})` }
                : { status: 'reached_goal', message: `Exited via: ${etr.triggered.description}` }
            } else if (etr && etr.not_triggered?.length) {
              stageResult.assessment = { status: 'failed', message: 'Stage ended before exit triggers were satisfied' }
            } else {
              stageResult.assessment = { status: 'executed', message: 'Stage executed (no exit triggers defined)' }
            }

            stageAnalyses.push(stageResult)

            // Pre-infusion tracking
            const nl = stageName.toLowerCase()
            if (PREINFUSION_KW.some(kw => nl.includes(kw))) {
              preinfusionTime += sd.duration
              preinfusionStages.push(stageName)
            }
          }

          const preinfusionWeight = (() => {
            let w = 0
            for (const ps2 of profileStages) {
              const sn = (ps2.name ?? '').trim().toLowerCase()
              if (!PREINFUSION_KW.some(kw => sn.includes(kw))) continue
              for (const [k, v] of shotStages) {
                if (k.trim().toLowerCase() === sn) { w += Math.max(0, v.endWeight - v.startWeight); break }
              }
            }
            return w
          })()

          const analysis = {
            shot_summary: {
              final_weight: _round1(finalWeight),
              target_weight: targetWeight,
              total_time: _round1(totalTime),
              max_pressure: _round1(maxPressure),
              max_flow: _round1(maxFlow),
            },
            weight_analysis: {
              status: targetWeight
                ? Math.abs(finalWeight - targetWeight) / targetWeight < 0.05 ? 'on_target'
                  : finalWeight < targetWeight ? 'under' : 'over'
                : 'on_target',
              target: targetWeight,
              actual: _round1(finalWeight),
              deviation_percent: targetWeight
                ? Math.round(((finalWeight - targetWeight) / targetWeight) * 1000) / 10
                : 0,
            },
            stage_analyses: stageAnalyses,
            unreached_stages: unreachedStages,
            preinfusion_summary: {
              stages: preinfusionStages,
              total_time: _round1(preinfusionTime),
              proportion_of_shot: totalTime > 0 ? _round1(preinfusionTime / totalTime * 100) : 0,
              weight_accumulated: _round1(preinfusionWeight),
              weight_percent_of_total: finalWeight > 0 ? _round1(preinfusionWeight / finalWeight * 100) : 0,
              issues: [],
              recommendations: [],
            },
            profile_info: {
              name: profileName,
              temperature: entry.profile?.temperature ?? null,
              stage_count: profileStages.length,
            },
          }
          return jsonResponse({ status: 'success', analysis })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Analysis failed'
          return jsonResponse({ status: 'error', message: msg })
        }
      })()
    }

    // POST /api/shots/analyze-llm → alias for shot analysis
    if (url.match(/\/api\/shots\/analyze-llm/) && method === 'POST') {
      return (async () => {
        try {
          const aiService = createBrowserAIService()
          if (!aiService.isConfigured()) {
            return jsonResponse({ status: 'error', message: 'Gemini API key not configured.' })
          }
          const body = init?.body as FormData
          const result = await aiService.analyzeShot({
            profileName: (body.get('profile_name') as string) || 'Unknown',
            shotDate: (body.get('shot_date') as string) || '',
            shotFilename: (body.get('shot_filename') as string) || '',
            profileDescription: (body.get('profile_description') as string) || undefined,
          })
          return jsonResponse({ status: 'success', llm_analysis: result.llm_analysis, cached: false })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Analysis failed'
          return jsonResponse({ status: 'error', message: msg })
        }
      })()
    }

    // POST /api/shots/analyze-recommendations → stub (no backend for recommendations in direct mode)
    if (url.match(/\/api\/shots\/analyze-recommendations/) && method === 'POST') {
      return Promise.resolve(jsonResponse({ recommendations: [] }))
    }

    // GET /api/generate/progress → no SSE in direct mode (generation is synchronous via BrowserAIService)
    if (url.match(/\/api\/generate\/progress/)) {
      return Promise.resolve(jsonResponse({ error: 'No active generation' }, 404))
    }

    // POST /api/analyze_and_profile → client-side Gemini profile generation via BrowserAIService
    if (url.match(/\/api\/analyze_and_profile$/) && method === 'POST') {
      return (async () => {
        try {
          const aiService = createBrowserAIService()
          if (!aiService.isConfigured()) {
            return jsonResponse({ status: 'error', reply: 'Gemini API key not configured. Please set your API key in Settings.', analysis: '' })
          }

          const body = init?.body as FormData
          const image = body.get('file') as File | null
          const userPrefs = (body.get('user_prefs') as string) || ''

          const result = await aiService.generateProfile({
            image,
            preferences: userPrefs,
            tags: [],
          })

          // Save profile to machine (convert Gemini JSON to OEPF format)
          if (result.status === 'success') {
            const jsonMatch = result.analysis.match(/```json\s*([\s\S]*?)```/)
            if (jsonMatch) {
              try {
                const raw = JSON.parse(jsonMatch[1])
                const toOEPF = (p: Record<string, unknown>) => {
                  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')
                  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0
                    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
                  })
                  // Build variable lookup for resolving $refs in stages
                  const varLookup: Record<string, number> = {}
                  if (Array.isArray(p.variables)) {
                    for (const v of p.variables as Array<Record<string, unknown>>) {
                      if (v.key && typeof v.value === 'number') varLookup[v.key as string] = v.value
                      if (v.name && typeof v.value === 'number') varLookup[v.name as string] = v.value
                    }
                  } else if (p.variables && typeof p.variables === 'object') {
                    for (const [k, v] of Object.entries(p.variables as Record<string, unknown>)) {
                      const num = typeof v === 'number' ? v : typeof v === 'object' && v !== null ? (v as Record<string, unknown>).value : undefined
                      if (typeof num === 'number') varLookup[k] = num
                    }
                  }
                  // Resolve $varname references to numeric values
                  const resolve = (val: unknown): unknown => {
                    if (typeof val === 'string' && val.startsWith('$')) {
                      const name = val.slice(1)
                      return varLookup[name] ?? 0
                    }
                    return val
                  }
                  // Keep only OEPF-valid variables (array form with valid type)
                  const validTypes = ['power', 'flow', 'pressure', 'weight', 'time', 'piston_position']
                  let vars: Array<Record<string, unknown>> = []
                  if (Array.isArray(p.variables)) {
                    vars = (p.variables as Array<Record<string, unknown>>).filter(v =>
                      typeof v.value === 'number' && typeof v.type === 'string' && validTypes.includes(v.type as string)
                    )
                  }
                  // Convert stages
                  const stages = Array.isArray(p.stages) ? (p.stages as Array<Record<string, unknown>>).map((s, i) => {
                    // dynamics: array of {time,value} → {points: [[t,v]], over, interpolation}
                    let dynamics = s.dynamics
                    if (Array.isArray(dynamics)) {
                      dynamics = {
                        points: (dynamics as Array<Record<string, unknown>>).map(pt => [
                          Number(resolve(pt.time)) || 0, Number(resolve(pt.value)) || 0
                        ]),
                        over: 'time', interpolation: 'linear',
                      }
                    } else if (dynamics && typeof dynamics === 'object') {
                      const d = dynamics as Record<string, unknown>
                      if (Array.isArray(d.points) && d.points.length > 0 && typeof d.points[0] === 'object' && !Array.isArray(d.points[0])) {
                        d.points = (d.points as Array<Record<string, unknown>>).map(pt => [
                          Number(resolve(pt.time)) || 0, Number(resolve(pt.value)) || 0
                        ])
                      }
                      if (!d.over) d.over = 'time'
                      if (!d.interpolation) d.interpolation = 'linear'
                    }
                    // Fix type: map Gemini names to valid OEPF types (power|flow|pressure)
                    const typeMap: Record<string, string> = { flowRate: 'flow', flow_rate: 'flow', flowrate: 'flow' }
                    let type = typeMap[s.type as string] || (s.type as string)
                    if (!['power', 'flow', 'pressure'].includes(type)) type = 'pressure'
                    // Fix exit_triggers: comparator → comparison, resolve $refs, map types, ensure relative
                    const triggerTypes = ['weight', 'pressure', 'flow', 'time', 'piston_position', 'power', 'user_interaction']
                    const mapTriggerType = (t: string) => {
                      if (triggerTypes.includes(t)) return t
                      if (/weight|dose|grams/i.test(t)) return 'weight'
                      if (/time|duration|elapsed/i.test(t)) return 'time'
                      if (/pressure/i.test(t)) return 'pressure'
                      if (/flow/i.test(t)) return 'flow'
                      return 'time'
                    }
                    const triggers = Array.isArray(s.exit_triggers)
                      ? (s.exit_triggers as Array<Record<string, unknown>>).map(t => ({
                          type: mapTriggerType(String(t.type || 'time')),
                          value: Number(resolve(t.value)) || 0,
                          relative: t.relative ?? true,
                          comparison: t.comparison || t.comparator || '>=',
                        }))
                      : []
                    // Fix limits: strip comparator, resolve $refs, map types (only pressure|flow valid)
                    const limits = Array.isArray(s.limits)
                      ? (s.limits as Array<Record<string, unknown>>).map(l => {
                          let lt = String(l.type || 'pressure')
                          if (lt !== 'pressure' && lt !== 'flow') {
                            lt = /flow/i.test(lt) ? 'flow' : 'pressure'
                          }
                          return { type: lt, value: Number(resolve(l.value)) || 0 }
                        })
                      : []
                    return {
                      name: s.name || `Stage ${i + 1}`,
                      key: s.key || slugify(String(s.name || `stage_${i + 1}`)),
                      type, dynamics, exit_triggers: triggers, limits,
                    }
                  }) : []
                  return {
                    name: p.name || 'AI Generated Profile',
                    id: uuid(),
                    author: typeof p.author === 'string' ? p.author : 'MeticAI',
                    author_id: uuid(),
                    previous_authors: [],
                    display: { accentColor: '#6366f1' },
                    temperature: p.temperature ?? 93,
                    final_weight: p.final_weight ?? 36,
                    variables: vars,
                    stages,
                    last_changed: Date.now() / 1000,
                  }
                }
                const oepf = toOEPF(raw)
                await _fetch('/api/v1/profile/save', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(oepf),
                })
              } catch (e) {
                console.warn('[direct-mode] Failed to save profile to machine:', e)
              }
            }
          }

          return jsonResponse({
            status: result.status,
            analysis: result.analysis,
            reply: result.analysis,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          return jsonResponse({ status: 'error', reply: msg, analysis: '' })
        }
      })()
    }

    // /api/profiles/sync/status → no sync needed in direct mode
    if (url.match(/\/api\/profiles\/sync\/status/)) {
      return Promise.resolve(jsonResponse({ new_count: 0, updated_count: 0, orphaned_count: 0 }))
    }

    // POST /api/profiles/sync → no-op in direct mode
    if (url.match(/\/api\/profiles\/sync/) && method === 'POST') {
      return Promise.resolve(jsonResponse({ synced: 0, updated: [], created: [], orphaned: [] }))
    }

    // GET /api/recipes → bundled pour-over recipes
    if (url.match(/\/api\/recipes$/)) {
      return Promise.resolve(jsonResponse([
        {"version":"1.1.0","metadata":{"name":"Tetsu Kasuya 4:6 (Lighter)","author":"Tetsu Kasuya","description":"Lighter-bodied 4:6 with a single strength pour. First 40% (two pours of 60g) controls sweetness; final 60% (one pour of 180g) produces a lighter, cleaner cup. Use a coarse grind for clarity.","compatibility":["V60","April","Origami"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Ceramic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":300.0,"grind_setting":"Coarse"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"notes":"First pour — controls sweetness"},{"step":2,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":3,"action":"pour","water_g":60,"duration_s":15,"notes":"Second pour — controls sweetness"},{"step":4,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":5,"action":"pour","water_g":180,"duration_s":45,"notes":"Single combined strength pour to 300g total"}],"slug":"4-6-method-lighter"},
        {"version":"1.1.0","metadata":{"name":"Tetsu Kasuya 4:6 (Standard)","author":"Tetsu Kasuya","description":"Classic 4:6 with two equal strength pours. First 40% (two pours of 60g) controls sweetness; final 60% (two pours of 90g) controls strength. Use a coarse grind for clarity.","compatibility":["V60","April","Origami"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Ceramic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":300.0,"grind_setting":"Coarse"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"notes":"First pour — controls sweetness"},{"step":2,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":3,"action":"pour","water_g":60,"duration_s":15,"notes":"Second pour — controls sweetness"},{"step":4,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":5,"action":"pour","water_g":90,"duration_s":20,"notes":"Third pour — controls strength"},{"step":6,"action":"wait","duration_s":60,"notes":"Wait for the bed to drain"},{"step":7,"action":"pour","water_g":90,"duration_s":20,"notes":"Fourth pour — controls strength"}],"slug":"4-6-method-standard"},
        {"version":"1.1.0","metadata":{"name":"Tetsu Kasuya 4:6 (Stronger)","author":"Tetsu Kasuya","description":"Adjust sweetness with the first 40% of water (pours 1–2) and strength with the final 60% (pours 3–5). Use a coarse grind for clarity.","compatibility":["V60","April","Origami"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Ceramic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":300.0,"grind_setting":"Coarse"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"notes":"First pour — controls sweetness"},{"step":2,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":3,"action":"pour","water_g":60,"duration_s":15,"notes":"Second pour — controls sweetness"},{"step":4,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":5,"action":"pour","water_g":60,"duration_s":15,"notes":"Third pour — controls strength"},{"step":6,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":7,"action":"pour","water_g":60,"duration_s":15,"notes":"Fourth pour — controls strength"},{"step":8,"action":"wait","duration_s":45,"notes":"Wait for the bed to drain"},{"step":9,"action":"pour","water_g":60,"duration_s":15,"notes":"Fifth pour — controls strength"}],"slug":"4-6-method"},
        {"version":"1.1.0","metadata":{"name":"James Hoffmann V2","author":"James Hoffmann","description":"Better 1-Cup V60 technique. 50g bloom with a mid-bloom swirl, then four measured pours of 50g each with 10-second pauses, finished with a gentle swirl.","compatibility":["V60"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Plastic"},"filter_type":"Paper"},"ingredients":{"coffee_g":15.0,"water_g":250.0,"grind_setting":"Medium-Fine"},"protocol":[{"step":1,"action":"bloom","water_g":50,"duration_s":10,"notes":"Pour 50g to bloom"},{"step":2,"action":"swirl","duration_s":5,"notes":"Gently swirl at 10–15s"},{"step":3,"action":"wait","duration_s":30,"notes":"Finish bloom — wait until 0:45"},{"step":4,"action":"pour","water_g":50,"duration_s":15,"notes":"Pour to 100g total (40% weight)"},{"step":5,"action":"wait","duration_s":10},{"step":6,"action":"pour","water_g":50,"duration_s":10,"notes":"Pour to 150g total (60% weight)"},{"step":7,"action":"wait","duration_s":10},{"step":8,"action":"pour","water_g":50,"duration_s":10,"notes":"Pour to 200g total (80% weight)"},{"step":9,"action":"wait","duration_s":10},{"step":10,"action":"pour","water_g":50,"duration_s":10,"notes":"Pour to 250g total (100% weight)"},{"step":11,"action":"swirl","duration_s":5,"notes":"Gently swirl to flatten the bed"},{"step":12,"action":"wait","duration_s":60,"notes":"Allow to drain completely"}],"slug":"hoffmann-v2"},
        {"version":"1.1.0","metadata":{"name":"Tetsu Kasuya God/Devil","author":"Tetsu Kasuya","description":"Hario Switch recipe. Open-valve hot percolation for the first 120g, then close the valve for cool immersion to 280g. Requires a gooseneck kettle with adjustable temperature.","compatibility":["Hario Switch"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"Switch","material":"Glass"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":280.0,"grind_setting":"Medium-Fine"},"protocol":[{"step":1,"action":"pour","water_g":60,"duration_s":15,"valve_state":"open","notes":"Valve OPEN — pour 60g at 90°C"},{"step":2,"action":"wait","duration_s":15,"valve_state":"open","notes":"Wait — valve remains open, percolating"},{"step":3,"action":"pour","water_g":60,"duration_s":20,"valve_state":"open","notes":"Pour 60g more to 120g total — still at 90°C. Begin lowering kettle temperature to 70°C now."},{"step":4,"action":"wait","duration_s":25,"valve_state":"open","notes":"Wait until ~1:15. Ensure water is at 70°C before next step."},{"step":5,"action":"pour","water_g":160,"duration_s":25,"valve_state":"closed","notes":"CLOSE valve, then pour 160g at 70°C to 280g total — immersion phase begins"},{"step":6,"action":"wait","duration_s":30,"valve_state":"closed","notes":"Steep with valve closed"},{"step":7,"action":"wait","duration_s":60,"valve_state":"open","notes":"OPEN valve — drain. Aim to complete by 3-minute mark."}],"slug":"kasuya-god-devil"},
        {"version":"1.1.0","metadata":{"name":"Lance Hedrick Single Pour","author":"Lance Hedrick","description":"Long bloom with wet WDT to fully saturate grounds, then one continuous pour. High extraction with minimal fines migration.","compatibility":["V60"],"visualizer_hint":"linear_ramp"},"equipment":{"dripper":{"model":"V60","material":"Plastic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":340.0,"grind_setting":"Medium-Coarse"},"protocol":[{"step":1,"action":"bloom","water_g":60,"duration_s":10,"notes":"Pour 60g (3× dose) to saturate all grounds evenly"},{"step":2,"action":"stir","duration_s":10,"notes":"Wet WDT — stir through the grounds with a WDT tool or chopstick to break all dry pockets"},{"step":3,"action":"wait","duration_s":80,"notes":"Wait — total bloom ~1:40"},{"step":4,"action":"pour","water_g":280,"duration_s":120,"flow_rate":"steady","notes":"Single continuous centre pour to 340g — maintain height for turbulence. After draining, swirl if slow / wet WDT if somewhat quick / turn bed with spoon if draining fast."}],"slug":"lance-hedrick-single-pour"},
        {"version":"1.1.0","metadata":{"name":"Scott Rao V60","author":"Scott Rao","description":"Centre-pour technique with an aggressive bloom spin (5–7 revolutions), two equal main pours separated by a 50%-drained wait, each followed by a gentle 2-revolution spin. Targets 22–24.5% extraction.","compatibility":["V60"],"visualizer_hint":"pulse_block"},"equipment":{"dripper":{"model":"V60","material":"Plastic"},"filter_type":"Paper"},"ingredients":{"coffee_g":20.0,"water_g":330.0,"grind_setting":"Medium"},"protocol":[{"step":1,"action":"bloom","water_g":60,"duration_s":5,"notes":"Spiral pour for 60g bloom"},{"step":2,"action":"swirl","duration_s":10,"notes":"Rao Spin — aggressive swirl 5–7 revolutions to fully saturate the bed"},{"step":3,"action":"wait","duration_s":35,"notes":"Wait — total bloom 45s"},{"step":4,"action":"pour","water_g":135,"duration_s":30,"flow_rate":"fast","notes":"Pour to 195g total as fast as possible with a nearly vertical stream"},{"step":5,"action":"swirl","duration_s":5,"notes":"Gentle spin — 2 revolutions to fill ribbed channels"},{"step":6,"action":"wait","duration_s":45,"notes":"Wait until slurry is ~50% drained (visual check)"},{"step":7,"action":"pour","water_g":135,"duration_s":30,"flow_rate":"fast","notes":"Pour to 330g total — same fast, vertical technique"},{"step":8,"action":"swirl","duration_s":5,"notes":"Final gentle spin — 2 revolutions to level the bed and break channels"}],"slug":"scott-rao-v60"}
      ]))
    }

    // GET /api/pour-over/preferences → stored preferences
    const POUR_OVER_PREFS_KEY = 'meticai-direct-pour-over-prefs'
    if (url.match(/\/api\/pour-over\/preferences$/) && method === 'GET') {
      const defaultModePrefs = { autoStart: true, bloomEnabled: true, bloomSeconds: 30, bloomWeightMultiplier: 2, machineIntegration: false, doseGrams: null, brewRatio: null }
      const defaultPrefs = {
        free: defaultModePrefs,
        ratio: { ...defaultModePrefs, doseGrams: 18, brewRatio: 15 },
        recipe: { machineIntegration: false, autoStart: true, progressionMode: 'weight' }
      }
      try {
        const stored = localStorage.getItem(POUR_OVER_PREFS_KEY)
        if (stored) return Promise.resolve(jsonResponse(JSON.parse(stored)))
      } catch { /* ignore */ }
      return Promise.resolve(jsonResponse(defaultPrefs))
    }

    // PUT /api/pour-over/preferences → persist to localStorage
    if (url.match(/\/api\/pour-over\/preferences$/) && method === 'PUT') {
      return (async () => {
        try {
          const body = typeof input === 'string' ? input : await new Request(input, init).text()
          const prefs = JSON.parse(body)
          localStorage.setItem(POUR_OVER_PREFS_KEY, JSON.stringify(prefs))
          return jsonResponse(prefs)
        } catch {
          return jsonResponse({ error: 'Invalid preferences' }, 400)
        }
      })()
    }

    // POST /api/pour-over/prepare → build adapted pour-over profile and load on machine
    if (url.match(/\/api\/pour-over\/prepare$/) && method === 'POST') {
      return (async () => {
        try {
          const body = typeof input === 'string' ? input : await new Request(input, init).text()
          const req = JSON.parse(body)
          const profile = _adaptPourOverProfile({
            targetWeight: req.target_weight ?? 300,
            bloomEnabled: req.bloom_enabled ?? true,
            bloomSeconds: req.bloom_seconds ?? 30,
            doseGrams: req.dose_grams ?? null,
            brewRatio: req.brew_ratio ?? null,
          })
          await _fetch(`/api/v1/profile/load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
          return jsonResponse({ status: 'ready' })
        } catch (e) {
          return jsonResponse({ status: 'error', detail: (e as Error).message }, 500)
        }
      })()
    }

    // POST /api/pour-over/cleanup, force-cleanup → no-op (profile is ephemeral, no purge in pour-over)
    if (url.match(/\/api\/pour-over\/(cleanup|force-cleanup)$/)) {
      return Promise.resolve(jsonResponse({ status: 'ok' }))
    }

    // GET /api/pour-over/active → no active session tracking in direct mode
    if (url.match(/\/api\/pour-over\/active$/)) {
      return Promise.resolve(jsonResponse({ active: false }))
    }

    // POST /api/pour-over/prepare-recipe → convert OPOS recipe to profile and load on machine
    if (url.match(/\/api\/pour-over\/prepare-recipe$/) && method === 'POST') {
      return (async () => {
        try {
          const body = typeof input === 'string' ? input : await new Request(input, init).text()
          const { recipe_slug } = JSON.parse(body)
          // Find recipe in our bundled list
          const recipesResp = await window.fetch(url.replace(/\/pour-over\/prepare-recipe$/, '/recipes'))
          const recipes = await recipesResp.json()
          const recipe = recipes.find((r: { slug: string }) => r.slug === recipe_slug)
          if (!recipe) return jsonResponse({ status: 'error', detail: `Recipe '${recipe_slug}' not found` }, 404)
          const profile = _adaptRecipeToProfile(recipe)
          await _fetch(`/api/v1/profile/load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })
          return jsonResponse({ status: 'ready' })
        } catch (e) {
          return jsonResponse({ status: 'error', detail: (e as Error).message }, 500)
        }
      })()
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
