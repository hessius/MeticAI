import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { STORAGE_KEYS } from '@/lib/constants'
import { deleteProfileImage, deleteSetting, getDB, setSetting } from '@/services/storage/AppDatabase'
import type { ProfileIdent } from '@meticulous-home/espresso-api'

const machineModeMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getDefaultMachineUrl: vi.fn(),
}))

const browserAIServiceMocks = vi.hoisted(() => ({
  isConfigured: vi.fn(() => false),
  analyzeShot: vi.fn(),
  generateProfile: vi.fn(),
  generateImage: vi.fn(),
}))

vi.mock('@/lib/machineMode', () => ({
  isNativePlatform: machineModeMocks.isNativePlatform,
  getDefaultMachineUrl: machineModeMocks.getDefaultMachineUrl,
}))

vi.mock('@/services/ai/BrowserAIService', () => ({
  createBrowserAIService: vi.fn(() => ({
    isConfigured: browserAIServiceMocks.isConfigured,
    analyzeShot: browserAIServiceMocks.analyzeShot,
    generateProfile: browserAIServiceMocks.generateProfile,
    generateImage: browserAIServiceMocks.generateImage,
  })),
}))

import { installDirectModeInterceptor } from './DirectModeInterceptor'

type FetchCall = {
  input: RequestInfo | URL
  init?: RequestInit
  method: string
  url: string
  pathname: string
}

type FetchHandler = (call: FetchCall) => Response | Promise<Response>
type RouteFixture = FetchHandler | Response | unknown

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function validPngBlob(): Blob {
  const bytes = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  ), char => char.charCodeAt(0))
  return new Blob([bytes], { type: 'image/png' })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function createMachineFetch(routes: Record<string, RouteFixture> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const method = requestMethod(input, init)
    const pathname = new URL(url, 'http://machine.local').pathname
    const route = routes[`${method} ${pathname}`] ?? routes[pathname]
    const call = { input, init, method, url, pathname }

    if (typeof route === 'function') return route(call)
    if (route instanceof Response) return route.clone()
    if (route !== undefined) return jsonResponse(route)
    return jsonResponse({ ok: true })
  })
}

async function readJson<T>(response: Response): Promise<T> {
  expect(response.headers.get('content-type')).toContain('application/json')
  return await response.json() as T
}

function directMode() {
  machineModeMocks.isNativePlatform.mockReturnValue(false)
  machineModeMocks.getDefaultMachineUrl.mockReturnValue('')
}

function capacitorMode(machineUrl = 'http://machine.local:8080') {
  machineModeMocks.isNativePlatform.mockReturnValue(true)
  machineModeMocks.getDefaultMachineUrl.mockReturnValue(machineUrl)
}

function nestedMachineProfiles(): ProfileIdent[] {
  // @meticulous-home/espresso-api exposes profile/list entries as nested
  // ProfileIdent objects: { change_id, profile }. Keep this shape so the RED
  // harness catches DirectModeInterceptor's current CachedProfile[] type cast.
  return [
    {
      change_id: 'change-1',
      profile: {
        id: 'profile-1',
        name: 'Turbo Bloom',
        author: 'MeticAI',
        author_id: 'author-1',
        previous_authors: [],
        display: {
          description: 'Bright fruit profile',
          image: '/profile/profile-1.png',
        },
        temperature: 93,
        final_weight: 36,
        variables: [],
        stages: [
          {
            name: 'Bloom',
            type: 'flow',
            key: 'flow_bloom',
            dynamics: { points: [[0, 2.1]], over: 'time', interpolation: 'linear' },
            exit_triggers: [],
            limits: [],
          },
          {
            name: 'Ramp',
            type: 'pressure',
            key: 'pressure_ramp',
            dynamics: { points: [[0, 8]], over: 'time', interpolation: 'linear' },
            exit_triggers: [],
            limits: [],
          },
        ],
      },
    },
    {
      change_id: 'change-2',
      profile: {
        id: 'profile-2',
        name: 'Chocolate Cruise',
        author: 'MeticAI',
        author_id: 'author-2',
        previous_authors: [],
        display: { shortDescription: 'Sweet classic espresso' },
        temperature: 92,
        final_weight: 38,
        variables: [],
        stages: [
          {
            name: 'Flat',
            type: 'pressure',
            key: 'pressure_flat',
            dynamics: { points: [[0, 9]], over: 'time', interpolation: 'linear' },
            exit_triggers: [],
            limits: [],
          },
        ],
      },
    },
  ]
}

function machineHistory() {
  return [
    {
      id: 'shot-1',
      time: Date.parse('2026-01-03T10:00:00Z') / 1000,
      name: 'Turbo Bloom',
      file: 'shot-1.json',
      profile: {
        id: 'profile-1',
        name: 'Turbo Bloom',
        final_weight: 36,
        temperature: 93,
      },
      data: [
        { time: 0, profile_time: 0, shot: { pressure: 0, flow: 0, weight: 0 } },
        { time: 30000, profile_time: 30000, shot: { pressure: 8, flow: 2.1, weight: 36 } },
      ],
    },
    {
      id: 'shot-2',
      time: Date.parse('2026-01-02T09:00:00Z') / 1000,
      name: 'Chocolate Cruise',
      file: 'shot-2.json',
      profile: { id: 'profile-2', name: 'Chocolate Cruise', final_weight: 38 },
      data: [],
    },
    {
      id: 'shot-3',
      time: Date.parse('2026-01-03T11:00:00Z') / 1000,
      name: 'Turbo Bloom',
      file: 'shot-3.json',
      profile: { id: 'profile-1', name: 'Turbo Bloom', final_weight: 36 },
      data: [],
    },
  ]
}

let restoreFetch = () => {}

function installInterceptor(machineFetch = createMachineFetch()) {
  const previousFetch = window.fetch
  window.fetch = machineFetch as unknown as typeof fetch
  installDirectModeInterceptor()
  restoreFetch = () => { window.fetch = previousFetch }
  return machineFetch
}

describe('DirectModeInterceptor regression harness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    directMode()
    browserAIServiceMocks.isConfigured.mockReset()
    browserAIServiceMocks.isConfigured.mockReturnValue(false)
    browserAIServiceMocks.analyzeShot.mockReset()
    browserAIServiceMocks.generateProfile.mockReset()
    browserAIServiceMocks.generateImage.mockReset()
    localStorage.clear()
    restoreFetch = () => {}
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    restoreFetch()
    vi.clearAllTimers()
    vi.useRealTimers()
    localStorage.clear()
    const db = await getDB()
    const dialInTx = db.transaction('dial-in-sessions', 'readwrite')
    await dialInTx.store.clear()
    await dialInTx.done
    await Promise.all([
      deleteSetting(STORAGE_KEYS.POUR_OVER_PREFS),
      deleteSetting('direct-history-deleted-ids'),
      deleteSetting('history-notes:shot-1'),
      deleteSetting('history-notes:shot-2'),
      deleteSetting('history-notes:shot-3'),
      deleteProfileImage('profile-1'),
      deleteProfileImage('profile-2'),
    ].map((cleanup) => cleanup.catch(() => undefined)))
    vi.restoreAllMocks()
  })

  it('can stub Capacitor mode and prefixes native machine API requests', async () => {
    capacitorMode('http://192.168.1.50:8080')
    const nativeProfileList = [{ id: 'native-profile', name: 'Native Profile' }]
    const machineFetch = installInterceptor(createMachineFetch({
      'GET /api/v1/profile/list': ({ url }: FetchCall) => (
        url === 'http://192.168.1.50:8080/api/v1/profile/list'
          ? jsonResponse(nativeProfileList)
          : jsonResponse({ error: `unprefixed request: ${url}` }, 599)
      ),
    }))

    const response = await window.fetch('/api/v1/profile/list')

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual(nativeProfileList)
    expect(machineFetch).toHaveBeenCalledWith('http://192.168.1.50:8080/api/v1/profile/list', undefined)
  })

  it('prefixes native machine API URL and Request inputs while preserving request details', async () => {
    capacitorMode('http://192.168.1.51:8080')
    const machineFetch = installInterceptor(createMachineFetch({
      'GET /api/v1/profile/list': ({ url }: FetchCall) => (
        url === 'http://192.168.1.51:8080/api/v1/profile/list'
          ? jsonResponse([{ id: 'url-profile', name: 'URL Profile' }])
          : jsonResponse({ error: `unprefixed URL input: ${url}` }, 599)
      ),
      'POST /api/v1/profile/save': async ({ input, method, url }: FetchCall) => {
        const body = input instanceof Request ? await input.clone().text() : ''
        return url === 'http://192.168.1.51:8080/api/v1/profile/save'
          && method === 'POST'
          && body === '{"name":"Saved"}'
          ? jsonResponse({ saved: true })
          : jsonResponse({ error: `request not preserved: ${method} ${url} ${body}` }, 599)
      },
    }))

    const urlResponse = await window.fetch(new URL('/api/v1/profile/list', window.location.origin))
    const requestResponse = await window.fetch(new Request(`${window.location.origin}/api/v1/profile/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Saved' }),
    }))

    expect(urlResponse.status).toBe(200)
    await expect(readJson(urlResponse)).resolves.toEqual([{ id: 'url-profile', name: 'URL Profile' }])
    expect(requestResponse.status).toBe(200)
    await expect(readJson(requestResponse)).resolves.toEqual({ saved: true })
    const requestedUrls = machineFetch.mock.calls.map(([input]) => requestUrl(input))
    expect(requestedUrls).toEqual([
      'http://192.168.1.51:8080/api/v1/profile/list',
      'http://192.168.1.51:8080/api/v1/profile/save',
    ])
  })

  describe('direct dial-in endpoint parity', () => {
    it('persists a backend-compatible direct dial-in session lifecycle', async () => {
      vi.useRealTimers()
      installInterceptor()

      const createResponse = await window.fetch('/api/dialin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coffee: { roast_level: 'light', origin: 'Kenya', process: 'washed' },
          profile_name: 'Turbo Bloom',
        }),
      })
      const created = await readJson<{
        id: string
        coffee: Record<string, unknown>
        profile_name: string
        iterations: unknown[]
        status: string
        created_at: string
        updated_at: string
      }>(createResponse)

      expect(createResponse.status).toBe(201)
      expect(created).toMatchObject({
        id: expect.any(String),
        coffee: { roast_level: 'light', origin: 'Kenya', process: 'washed' },
        profile_name: 'Turbo Bloom',
        iterations: [],
        status: 'active',
        created_at: expect.any(String),
        updated_at: expect.any(String),
      })

      const listActive = await window.fetch('/api/dialin/sessions?status=active')
      await expect(readJson(listActive)).resolves.toEqual({ sessions: [created] })

      const iterationResponse = await window.fetch(`/api/dialin/sessions/${created.id}/iterations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taste: { x: -0.45, y: 0.35, descriptors: ['sour', 'strong'], notes: 'Sharp' },
          shot_ref: 'shot-1',
        }),
      })

      expect(iterationResponse.status).toBe(201)
      await expect(readJson(iterationResponse)).resolves.toMatchObject({
        iteration_number: 1,
        shot_ref: 'shot-1',
        taste: { x: -0.45, y: 0.35, descriptors: ['sour', 'strong'], notes: 'Sharp' },
        recommendations: [],
        timestamp: expect.any(String),
      })

      const recommendResponse = await window.fetch(`/api/dialin/sessions/${created.id}/recommend`, {
        method: 'POST',
      })
      const recommendationBody = await readJson<{ recommendations: string[]; source: string }>(recommendResponse)
      expect(recommendationBody).toEqual({
        recommendations: [
          'Grind finer (2-3 steps)',
          'Increase temperature by 1-2°C',
          'Decrease dose by 0.3-0.5g',
        ],
        source: 'rules',
      })

      const updateResponse = await window.fetch(`/api/dialin/sessions/${created.id}/iterations/1/recommendations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendations: ['Try a shorter ratio'] }),
      })
      await expect(readJson(updateResponse)).resolves.toMatchObject({
        iteration_number: 1,
        recommendations: ['Try a shorter ratio'],
      })

      const getResponse = await window.fetch(`/api/dialin/sessions/${created.id}`)
      await expect(readJson(getResponse)).resolves.toMatchObject({
        id: created.id,
        status: 'active',
        iterations: [
          expect.objectContaining({
            iteration_number: 1,
            recommendations: ['Try a shorter ratio'],
          }),
        ],
      })

      const completeResponse = await window.fetch(`/api/dialin/sessions/${created.id}/complete`, {
        method: 'POST',
      })
      await expect(readJson(completeResponse)).resolves.toMatchObject({
        id: created.id,
        status: 'completed',
      })

      const completedList = await window.fetch('/api/dialin/sessions?status=completed')
      await expect(readJson(completedList)).resolves.toEqual({
        sessions: [expect.objectContaining({ id: created.id, status: 'completed' })],
      })

      const deleteResponse = await window.fetch(`/api/dialin/sessions/${created.id}`, { method: 'DELETE' })
      await expect(readJson(deleteResponse)).resolves.toEqual({ deleted: true })
      expect((await window.fetch(`/api/dialin/sessions/${created.id}`)).status).toBe(404)
    })

    it('returns backend-compatible errors for missing and empty direct dial-in sessions', async () => {
      vi.useRealTimers()
      installInterceptor()

      const missingResponse = await window.fetch('/api/dialin/sessions/missing/recommend', { method: 'POST' })
      expect(missingResponse.status).toBe(404)
      await expect(readJson(missingResponse)).resolves.toEqual({ detail: 'Session not found' })

      const createResponse = await window.fetch('/api/dialin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coffee: { roast_level: 'medium' } }),
      })
      const created = await readJson<{ id: string }>(createResponse)
      const emptyResponse = await window.fetch(`/api/dialin/sessions/${created.id}/recommend`, { method: 'POST' })

      expect(emptyResponse.status).toBe(400)
      await expect(readJson(emptyResponse)).resolves.toEqual({ detail: 'No iterations to recommend from' })
    })

    it('supports backend-compatible unprefixed dial-in route aliases', async () => {
      vi.useRealTimers()
      const machineFetch = installInterceptor(createMachineFetch({
        '/dialin/sessions': jsonResponse({ delegated: true }, 599),
      }))

      const createResponse = await window.fetch('/dialin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coffee: { roast_level: 'medium' } }),
      })
      const created = await readJson<{ id: string; status: string }>(createResponse)

      expect(createResponse.status).toBe(201)
      expect(created.status).toBe('active')

      const iterationResponse = await window.fetch(`/dialin/sessions/${created.id}/iterations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taste: { x: 0, y: 0, descriptors: [] } }),
      })
      expect(iterationResponse.status).toBe(201)

      const recommendResponse = await window.fetch(`/dialin/sessions/${created.id}/recommend`, { method: 'POST' })
      await expect(readJson(recommendResponse)).resolves.toEqual({
        recommendations: ['Looking good! Small tweaks only — try ±0.5°C or ±0.2g dose'],
        source: 'rules',
      })

      const getResponse = await window.fetch(`/dialin/sessions/${created.id}`)
      await expect(readJson(getResponse)).resolves.toMatchObject({
        id: created.id,
        iterations: [expect.objectContaining({
          recommendations: ['Looking good! Small tweaks only — try ±0.5°C or ±0.2g dose'],
        })],
      })
      expect(machineFetch).not.toHaveBeenCalled()
    })
  })

  describe('direct recommendation endpoint parity', () => {
    it.each([
      ['/api/profiles/recommend', (form: FormData) => {
        form.append('tags', 'bright')
        form.append('tags', 'fruity')
        form.append('limit', '5')
      }],
      ['/api/profiles/find-similar', (form: FormData) => {
        form.append('profile_name', 'Turbo Bloom')
        form.append('limit', '5')
      }],
    ] as const)('%s returns non-empty recommendations in direct mode', async (endpoint, fillForm) => {
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
      }))
      const form = new FormData()
      fillForm(form)

      const response = await window.fetch(endpoint, { method: 'POST', body: form })

      expect(response.status).toBe(200)
      const body = await readJson<{ status: string; recommendations: unknown[]; count: number }>(response)
      expect(body).toMatchObject({
        status: 'success',
        recommendations: expect.any(Array),
        count: expect.any(Number),
      })
      expect(body.recommendations).not.toHaveLength(0)
      expect(body.count).toBeGreaterThan(0)
    })

    it('extracts available shot recommendations instead of returning a silent empty list', async () => {
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
      }))
      const analysisWithRecommendations = [
        '## 4. Profile Recommendations',
        'RECOMMENDATIONS_JSON:',
        JSON.stringify([
          {
            variable: 'flow',
            current_value: 2.1,
            recommended_value: 1.8,
            stage: 'Bloom',
            confidence: 'high',
            reason: 'Reduce early-channeling flow.',
          },
        ]),
        'END_RECOMMENDATIONS_JSON',
      ].join('\n')
      localStorage.setItem(STORAGE_KEYS.ANALYSIS_CACHE, JSON.stringify({
        'Turbo Bloom::shot-1.json': analysisWithRecommendations,
      }))
      const form = new FormData()
      form.append('profile_name', 'Turbo Bloom')
      form.append('shot_filename', 'shot-1.json')
      form.append('analysis', analysisWithRecommendations)

      const response = await window.fetch('/api/shots/analyze-recommendations', {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(200)
      const body = await readJson<{ recommendations: unknown[]; total: number; patchable_count: number }>(response)
      expect(body.recommendations).toEqual([
        expect.objectContaining({
          variable: 'flow',
          current_value: 2.1,
          recommended_value: 1.8,
          stage: 'Bloom',
          confidence: 'high',
          is_patchable: true,
        }),
      ])
      expect(body.total).toBe(1)
      expect(body.patchable_count).toBe(1)
    })

    it('uses fuzzy backend-compatible patchability for non-adjustable variables', async () => {
      const profileIdent = nestedMachineProfiles()[0]
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': [{
          ...profileIdent,
          profile: {
            ...profileIdent.profile,
            variables: [
              { key: 'info_roast', name: 'Roast Level', type: 'number', value: 3, adjustable: false },
            ],
          },
        }],
      }))
      const analysisWithRecommendations = [
        'RECOMMENDATIONS_JSON:',
        JSON.stringify([
          {
            variable: 'roast level',
            current_value: 3,
            recommended_value: 4,
            stage: 'global',
            confidence: 'medium',
            reason: 'Info-only note should not be patchable.',
          },
        ]),
        'END_RECOMMENDATIONS_JSON',
      ].join('\n')
      const form = new FormData()
      form.append('profile_name', 'Turbo Bloom')
      form.append('shot_filename', 'shot-1.json')
      form.append('analysis', analysisWithRecommendations)

      const response = await window.fetch('/api/shots/analyze-recommendations', {
        method: 'POST',
        body: form,
      })

      const body = await readJson<{ recommendations: Array<{ is_patchable: boolean }>; patchable_count: number }>(response)
      expect(body.recommendations[0]).toMatchObject({ is_patchable: false })
      expect(body.patchable_count).toBe(0)
    })

    it('applies patchable recommendations directly to the machine profile JSON', async () => {
      const profileIdent = nestedMachineProfiles()[0]
      const editableProfile = {
        ...profileIdent,
        profile: {
          ...profileIdent.profile,
          variables: [
            { key: 'flow_bloom', name: 'Bloom Flow', type: 'number', value: 2.1, adjustable: true },
            { key: 'info_note', name: 'Info Note', type: 'number', value: 1, adjustable: false },
          ],
        },
      }
      let savedProfile: Record<string, unknown> | null = null
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': [editableProfile],
        'POST /api/v1/profile/save': ({ init }: FetchCall) => {
          savedProfile = JSON.parse(String(init?.body))
          return jsonResponse({ ok: true })
        },
      }))
      const form = new FormData()
      form.append('recommendations', JSON.stringify([
        { variable: 'flow_bloom', recommended_value: 1.8, stage: 'Bloom' },
        { variable: 'temperature', recommended_value: 94, stage: 'global' },
        { variable: 'info_note', recommended_value: 5, stage: 'global' },
      ]))

      const response = await window.fetch('/api/profile/Turbo%20Bloom/apply-recommendations', {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toMatchObject({
        status: 'success',
        applied: [
          { variable: 'flow_bloom', stage: 'Bloom', value: 1.8 },
          { variable: 'temperature', stage: 'global', value: 94 },
        ],
        skipped: [
          { variable: 'info_note', reason: 'info-only / not adjustable' },
        ],
      })
      expect(savedProfile).toMatchObject({
        name: 'Turbo Bloom',
        temperature: 94,
        variables: expect.arrayContaining([
          expect.objectContaining({ key: 'flow_bloom', value: 1.8 }),
        ]),
      })
    })

    it('applies stage trigger and limit recommendations that direct analysis marks patchable', async () => {
      const profileIdent = nestedMachineProfiles()[0]
      const editableProfile = {
        ...profileIdent,
        profile: {
          ...profileIdent.profile,
          stages: [
            {
              name: 'Bloom',
              type: 'flow',
              key: 'flow_bloom',
              dynamics: { points: [[0, 2.1]], over: 'time', interpolation: 'linear' },
              exit_triggers: [{ type: 'weight', value: 5, relative: false, comparison: '>=' }],
              limits: [{ type: 'pressure', value: 9 }],
            },
          ],
        },
      }
      let savedProfile: Record<string, unknown> | null = null
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': [editableProfile],
        'POST /api/v1/profile/save': ({ init }: FetchCall) => {
          savedProfile = JSON.parse(String(init?.body))
          return jsonResponse({ ok: true })
        },
      }))
      const form = new FormData()
      form.append('recommendations', JSON.stringify([
        { variable: 'exit_weight', recommended_value: 8, stage: 'Bloom' },
        { variable: 'limit_pressure', recommended_value: 7.5, stage: 'Bloom' },
      ]))

      const response = await window.fetch('/api/profile/Turbo%20Bloom/apply-recommendations', {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toMatchObject({
        status: 'success',
        applied: [
          { variable: 'exit_weight', stage: 'Bloom', value: 8 },
          { variable: 'limit_pressure', stage: 'Bloom', value: 7.5 },
        ],
      })
      expect(savedProfile).toMatchObject({
        stages: [
          expect.objectContaining({
            exit_triggers: [expect.objectContaining({ type: 'weight', value: 8 })],
            limits: [expect.objectContaining({ type: 'pressure', value: 7.5 })],
          }),
        ],
      })
    })

    it('uploads and caches direct profile images on the machine profile', async () => {
      vi.useRealTimers()
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
      }))
      const form = new FormData()
      const uploadedImage = validPngBlob()
      form.append('file', uploadedImage, 'profile-image.png')

      const uploadResponse = await window.fetch('/api/profile/Turbo%20Bloom/image', {
        method: 'POST',
        body: form,
      })
      const imageResponse = await window.fetch('/api/profile/Turbo%20Bloom/image-proxy')

      expect(uploadResponse.status).toBe(200)
      await expect(readJson(uploadResponse)).resolves.toMatchObject({
        status: 'success',
        profile_id: 'profile-1',
        image_size: expect.any(Number),
      })
      // Image is saved to local IndexedDB, not to the machine profile
      expect(imageResponse.status).toBe(200)
      await expect(imageResponse.arrayBuffer()).resolves.toHaveProperty('byteLength', uploadedImage.size)
    })

    it('applies generated direct profile image previews to the machine profile', async () => {
      vi.useRealTimers()
      browserAIServiceMocks.isConfigured.mockReturnValue(true)
      const generatedImage = validPngBlob()
      browserAIServiceMocks.generateImage.mockResolvedValue(generatedImage)
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
      }))

      const previewResponse = await window.fetch(
        '/api/profile/Turbo%20Bloom/generate-image?style=modern&tags=bright%2Cfruit&preview=true',
        { method: 'POST' },
      )
      const previewBody = await readJson<{ image_data: string }>(previewResponse)
      const applyResponse = await window.fetch('/api/profile/Turbo%20Bloom/apply-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: previewBody.image_data }),
      })
      const imageResponse = await window.fetch('/api/profile/Turbo%20Bloom/image-proxy')

      expect(previewResponse.status).toBe(200)
      expect(previewBody.image_data).toMatch(/^data:image\/png;base64,/)
      expect(browserAIServiceMocks.generateImage).toHaveBeenCalledWith({
        profileName: 'Turbo Bloom',
        style: 'modern',
        tags: ['bright', 'fruit'],
        preview: true,
      })
      expect(applyResponse.status).toBe(200)
      await expect(readJson(applyResponse)).resolves.toMatchObject({
        status: 'success',
        profile_id: 'profile-1',
      })
      // Image is saved to local IndexedDB, not to the machine profile
      expect(imageResponse.status).toBe(200)
      await expect(imageResponse.arrayBuffer()).resolves.toHaveProperty('byteLength', generatedImage.size)
    })

    it('does not let unapplied generated previews shadow the machine profile image', async () => {
      vi.useRealTimers()
      machineModeMocks.getDefaultMachineUrl.mockReturnValue('http://machine.local:8080')
      browserAIServiceMocks.isConfigured.mockReturnValue(true)
      browserAIServiceMocks.generateImage.mockResolvedValue(validPngBlob())
      let imageFetches = 0
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
        'GET /profile/profile-1.png': () => {
          imageFetches += 1
          return new Response('machine-image', { headers: { 'Content-Type': 'image/png' } })
        },
      }))

      const previewResponse = await window.fetch(
        '/api/profile/Turbo%20Bloom/generate-image?style=modern&tags=bright&preview=true',
        { method: 'POST' },
      )
      const imageResponse = await window.fetch('/api/profile/Turbo%20Bloom/image-proxy')

      expect(previewResponse.status).toBe(200)
      expect(imageResponse.status).toBe(200)
      await expect(imageResponse.text()).resolves.toBe('machine-image')
      expect(imageFetches).toBe(1)
    })

    it('rejects oversized and malformed direct profile images before saving', async () => {
      vi.useRealTimers()
      const saveRoute = vi.fn(() => jsonResponse({ ok: true }))
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
        'POST /api/v1/profile/save': saveRoute,
      }))
      const oversizedForm = new FormData()
      oversizedForm.append('file', new Blob([new Uint8Array((10 * 1024 * 1024) + 1)], { type: 'image/png' }), 'huge.png')

      const oversizedResponse = await window.fetch('/api/profile/Turbo%20Bloom/image', {
        method: 'POST',
        body: oversizedForm,
      })
      const malformedResponse = await window.fetch('/api/profile/Turbo%20Bloom/apply-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: 'data:image/png;base64,bm90LWFjdHVhbC1pbWFnZQ==' }),
      })

      expect(oversizedResponse.status).toBe(413)
      expect(malformedResponse.status).toBe(400)
      expect(saveRoute).not.toHaveBeenCalled()
    })

    it('rejects oversized apply-image data URIs before decoding payloads', async () => {
      vi.useRealTimers()
      const saveRoute = vi.fn(() => jsonResponse({ ok: true }))
      const atobSpy = vi.spyOn(globalThis, 'atob').mockImplementation(() => {
        throw new Error('oversized payload should not be decoded')
      })
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
        'POST /api/v1/profile/save': saveRoute,
      }))

      const oversizedPayload = 'a'.repeat(Math.ceil(((10 * 1024 * 1024) + 1) / 3) * 4)
      const response = await window.fetch('/api/profile/Turbo%20Bloom/apply-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: `data:image/png;base64,${oversizedPayload}` }),
      })

      expect(response.status).toBe(413)
      expect(atobSpy).not.toHaveBeenCalled()
      expect(saveRoute).not.toHaveBeenCalled()
    })
  })

  it('returns a contract-compatible no-op profile sync result in direct mode', async () => {
    installInterceptor()

    const response = await window.fetch('/api/profiles/sync', { method: 'POST' })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      status: 'success',
      new: [],
      updated: [],
      orphaned: [],
    })
  })

  describe('direct profile, history, and pour-over contracts', () => {
    it('returns backend-compatible detail errors for invalid pour-over preference bodies', async () => {
      installInterceptor()

      const response = await window.fetch('/api/pour-over/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      })

      expect(response.status).toBe(400)
      await expect(readJson(response)).resolves.toEqual({
        detail: 'Invalid preferences',
      })
    })

    it('returns backend-compatible detail errors for corrupt stored pour-over preferences', async () => {
      vi.useRealTimers()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await setSetting(STORAGE_KEYS.POUR_OVER_PREFS, 'not-an-object')
      installInterceptor()

      const response = await window.fetch('/api/pour-over/preferences')

      expect(response.status).toBe(500)
      const body = await readJson<{ detail: string }>(response)
      expect(body.detail).toContain('pour-over preferences')
    })

    it('returns shot dates wrapped in { dates } instead of a raw array', async () => {
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': machineHistory(),
      }))
      vi.useRealTimers()

      const response = await window.fetch('/api/shots/dates')

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toEqual({
        dates: ['2026-01-03', '2026-01-02'],
      })
    })

    it('returns backend-compatible last-shot metadata', async () => {
      const [lastShot] = machineHistory()
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': [lastShot],
      }))
      vi.useRealTimers()

      const response = await window.fetch('/api/last-shot')

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toEqual({
        profile_name: 'Turbo Bloom',
        date: '2026-01-03',
        filename: 'shot-1.json',
        timestamp: lastShot.time,
        final_weight: 36,
        total_time: 30,
      })
    })

    it('returns 404 when direct last-shot has no machine history', async () => {
      installInterceptor(createMachineFetch({
        'GET /api/v1/history/last': jsonResponse({ detail: 'No shots found' }, 404),
      }))
      vi.useRealTimers()

      const response = await window.fetch('/api/last-shot')

      expect(response.status).toBe(404)
      await expect(readJson(response)).resolves.toEqual({ detail: 'No shots found' })
    })

    it('normalizes nested machine ProfileIdent objects from /api/machine/profiles', async () => {
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
      }))

      const response = await window.fetch('/api/machine/profiles')

      expect(response.status).toBe(200)
      const body = await readJson<{ profiles: Array<Record<string, unknown>> }>(response)
      expect(body.profiles).toEqual([
        expect.objectContaining({
          id: 'profile-1',
          name: 'Turbo Bloom',
          change_id: 'change-1',
          display: expect.objectContaining({ description: 'Bright fruit profile' }),
        }),
        expect.objectContaining({
          id: 'profile-2',
          name: 'Chocolate Cruise',
          change_id: 'change-2',
        }),
      ])
      expect(body.profiles[0]).not.toHaveProperty('profile')
    })

    it('applies variable overrides and runs the profile via ephemeral load', async () => {
      const profileData = nestedMachineProfiles()[0].profile
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/get/profile-1': profileData,
        'POST /api/v1/profile/load': { ok: true },
        'GET /api/v1/action/start': { ok: true },
      }))
      const form = new FormData()
      form.append('overrides_json', JSON.stringify({ temperature: 94 }))

      const response = await window.fetch('/api/machine/run-profile-with-overrides/profile-1', {
        method: 'POST',
        body: form,
      })

      expect(response.status).toBe(200)
      const body = await readJson<Record<string, unknown>>(response)
      expect(body.status).toBe('success')
      expect(body.overrides_applied).toBe(1)
    })

    it('renames visible direct machine profiles through the machine API', async () => {
      const profileIdent = nestedMachineProfiles()[0]
      let savedProfile: Record<string, unknown> | null = null
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/get/profile-1': profileIdent.profile,
        'POST /api/v1/profile/save': ({ init }: FetchCall) => {
          savedProfile = JSON.parse(String(init?.body))
          return jsonResponse({ ok: true })
        },
      }))

      const response = await window.fetch('/api/machine/profile/profile-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Turbo Bloom Mk II' }),
      })

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toEqual({
        status: 'success',
        message: "Profile renamed from 'Turbo Bloom' to 'Turbo Bloom Mk II'",
        profile_id: 'profile-1',
        old_name: 'Turbo Bloom',
        new_name: 'Turbo Bloom Mk II',
      })
      expect(savedProfile).toMatchObject({
        id: 'profile-1',
        name: 'Turbo Bloom Mk II',
      })
    })

    it('invalidates name-based direct profile cache after rename', async () => {
      const profileIdent = nestedMachineProfiles()[0]
      let machineProfile = profileIdent.profile
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': () => jsonResponse([{ ...profileIdent, profile: machineProfile }]),
        'GET /api/v1/profile/get/profile-1': () => jsonResponse(machineProfile),
        'POST /api/v1/profile/save': ({ init }: FetchCall) => {
          machineProfile = JSON.parse(String(init?.body))
          return jsonResponse({ ok: true })
        },
      }))

      await window.fetch('/api/machine/profiles')
      await window.fetch('/api/machine/profile/profile-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Turbo Bloom Mk II' }),
      })
      const oldNameResponse = await window.fetch('/api/profile/Turbo%20Bloom')
      const newNameResponse = await window.fetch('/api/profile/Turbo%20Bloom%20Mk%20II')

      await expect(readJson(oldNameResponse)).resolves.toMatchObject({
        status: 'not_found',
        profile: null,
      })
      await expect(readJson(newNameResponse)).resolves.toMatchObject({
        status: 'success',
        profile: expect.objectContaining({
          id: 'profile-1',
          name: 'Turbo Bloom Mk II',
        }),
      })
    })

    it('invalidates the profile list cache after importing a new profile', async () => {
      const profiles: ProfileIdent[] = [nestedMachineProfiles()[0]]
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': () => jsonResponse(profiles),
        'POST /api/v1/profile/save': ({ init }: FetchCall) => {
          const saved = JSON.parse(String(init?.body)) as { id?: string; name?: string }
          profiles.push({
            id: saved.id || 'imported-1',
            name: saved.name || 'Imported',
            profile: saved,
          } as unknown as ProfileIdent)
          return jsonResponse({ ok: true })
        },
      }))

      // Prime the catalogue cache with the single existing profile.
      const first = await window.fetch('/api/machine/profiles')
      const firstBody = await readJson<{ profiles: Array<{ name: string }> }>(first)
      expect(firstBody.profiles.map((p) => p.name)).toEqual(['Turbo Bloom'])
      expect(localStorage.getItem(STORAGE_KEYS.PROFILE_LIST_CACHE)).not.toBeNull()

      // Import a brand-new profile from a file.
      const importResponse = await window.fetch('/api/profile/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'file', profile: { id: 'imported-1', name: 'Imported Joy' } }),
      })
      expect(importResponse.status).toBe(200)
      // Cache must be dropped so the new profile is not hidden behind stale data.
      expect(localStorage.getItem(STORAGE_KEYS.PROFILE_LIST_CACHE)).toBeNull()

      // The next catalogue fetch reflects the newly created profile.
      const second = await window.fetch('/api/machine/profiles')
      const secondBody = await readJson<{ profiles: Array<{ name: string }> }>(second)
      expect(secondBody.profiles.map((p) => p.name)).toEqual(['Turbo Bloom', 'Imported Joy'])
    })

    it('rejects empty direct machine profile rename requests before saving', async () => {
      const saveRoute = vi.fn(() => jsonResponse({ ok: true }))
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/get/profile-1': nestedMachineProfiles()[0].profile,
        'POST /api/v1/profile/save': saveRoute,
      }))

      const response = await window.fetch('/api/machine/profile/profile-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      })

      expect(response.status).toBe(400)
      await expect(readJson(response)).resolves.toEqual({
        detail: "At least one field to update is required (e.g., 'name')",
      })
      expect(saveRoute).not.toHaveBeenCalled()
    })

    it('returns the backend-compatible pour-over prepare identifiers', async () => {
      installInterceptor(createMachineFetch({
        'POST /api/v1/profile/load': { ok: true },
      }))

      const response = await window.fetch('/api/pour-over/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_weight: 320,
          bloom_enabled: true,
          bloom_seconds: 35,
          dose_grams: 20,
          brew_ratio: 16,
        }),
      })

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toEqual({
        profile_id: expect.any(String),
        profile_name: 'MeticAI Ratio Pour-Over',
      })
    })

    it('routes /api/history/:id detail requests before the broad /api/history list handler', async () => {
      vi.useRealTimers()
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': machineHistory(),
      }))

      const response = await window.fetch('/api/history/shot-1')

      expect(response.status).toBe(200)
      const body = await readJson<Record<string, unknown>>(response)
      expect(body).toMatchObject({
        id: 'shot-1',
        profile_name: 'Turbo Bloom',
        profile_json: expect.objectContaining({ name: 'Turbo Bloom' }),
      })
      expect(body).not.toHaveProperty('entries')
    })

    it('applies local tombstones for direct history delete and clear routes', async () => {
      vi.useRealTimers()
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': machineHistory(),
      }))

      const deleteResponse = await window.fetch('/api/history/shot-2', { method: 'DELETE' })
      const afterDeleteList = await window.fetch('/api/history?limit=50&offset=0')
      const afterDeleteDetail = await window.fetch('/api/history/shot-2')
      const clearResponse = await window.fetch('/api/history', { method: 'DELETE' })
      const afterClearList = await window.fetch('/api/history?limit=50&offset=0')

      await expect(readJson(deleteResponse)).resolves.toEqual({
        status: 'success',
        message: 'History entry deleted',
      })
      const deletedList = await readJson<{ entries: Array<{ id: string }>; total: number }>(afterDeleteList)
      expect(deletedList.entries.map((entry) => entry.id)).not.toContain('shot-2')
      expect(deletedList.total).toBe(2)
      expect(afterDeleteDetail.status).toBe(404)
      await expect(readJson(clearResponse)).resolves.toEqual({
        status: 'success',
        message: 'All history cleared',
      })
      await expect(readJson(afterClearList)).resolves.toMatchObject({
        entries: [],
        total: 0,
      })
    })

    it('falls back to the newest visible last shot when the machine last shot is tombstoned', async () => {
      vi.useRealTimers()
      const history = machineHistory()
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': history,
        'GET /api/v1/history/last': history[2],
      }))

      await window.fetch('/api/history/shot-3', { method: 'DELETE' })
      const response = await window.fetch('/api/last-shot')

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toEqual({
        profile_name: 'Turbo Bloom',
        date: '2026-01-03',
        filename: 'shot-1.json',
        timestamp: history[0].time,
        final_weight: 36,
        total_time: 30,
      })
    })

    it('hides tombstoned shots from profile lists, shot data, and direct analysis', async () => {
      vi.useRealTimers()
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': machineHistory(),
      }))

      await window.fetch('/api/history/shot-1', { method: 'DELETE' })
      const byProfileResponse = await window.fetch('/api/shots/by-profile/Turbo%20Bloom')
      const shotDataResponse = await window.fetch('/api/shots/data/2026-01-03/shot-1.json')
      const form = new FormData()
      form.append('profile_name', 'Turbo Bloom')
      form.append('shot_date', '2026-01-03')
      form.append('shot_filename', 'shot-1.json')
      const analyzeResponse = await window.fetch('/api/shots/analyze', {
        method: 'POST',
        body: form,
      })

      const byProfileBody = await readJson<{ shots: Array<{ filename: string }>; count: number }>(byProfileResponse)
      expect(byProfileBody.shots.map((shot) => shot.filename)).toEqual(['shot-3.json'])
      expect(byProfileBody.count).toBe(1)
      expect(shotDataResponse.status).toBe(404)
      await expect(readJson(shotDataResponse)).resolves.toEqual({ detail: 'Shot not found' })
      await expect(readJson(analyzeResponse)).resolves.toEqual({
        status: 'error',
        message: 'Shot not found',
      })
    })

    it('returns profile info with stages and target curves without relying on a prewarmed cache', async () => {
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
      }))

      const profileResponse = await window.fetch('/api/profile/Turbo%20Bloom?include_stages=true')
      const curvesResponse = await window.fetch('/api/profile/Turbo%20Bloom/target-curves')

      expect(profileResponse.status).toBe(200)
      await expect(readJson(profileResponse)).resolves.toEqual({
        status: 'success',
        profile: expect.objectContaining({
          id: 'profile-1',
          name: 'Turbo Bloom',
          stages: expect.arrayContaining([
            expect.objectContaining({ name: 'Bloom', type: 'flow' }),
          ]),
        }),
      })
      expect(curvesResponse.status).toBe(200)
      const curvesBody = await readJson<{ status: string; target_curves: Array<Record<string, unknown>> }>(curvesResponse)
      expect(curvesBody.status).toBe('success')
      expect(curvesBody.target_curves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage_name: 'Bloom', target_flow: 2.1 }),
          expect.objectContaining({ stage_name: 'Ramp', target_pressure: 8 }),
        ]),
      )
    })

    it('fetches full stages + variables by id when the profile list omits them', async () => {
      // Real machines return profile/list entries without full stage data, so
      // the pre-shot breakdown and auto-generated description must fall back to
      // the get-by-id endpoint. The list here intentionally has empty stages.
      const listWithoutStages = [
        {
          change_id: 'change-1',
          profile: {
            id: 'profile-1',
            name: 'Turbo Bloom',
            author: 'MeticAI',
            author_id: 'author-1',
            previous_authors: [],
            display: { description: 'Bright fruit profile' },
            temperature: 93,
            final_weight: 36,
            variables: [],
            stages: [],
          },
        },
      ] as unknown as ProfileIdent[]

      const fullProfile = {
        id: 'profile-1',
        name: 'Turbo Bloom',
        temperature: 93,
        final_weight: 36,
        variables: [{ name: 'dose', key: 'dose', value: 18 }],
        stages: [
          {
            name: 'Bloom',
            type: 'flow',
            key: 'flow_bloom',
            dynamics: { points: [[0, 2.1]], over: 'time', interpolation: 'linear' },
            exit_triggers: [],
            limits: [],
          },
        ],
      }

      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': listWithoutStages,
        'GET /api/v1/profile/get/profile-1': fullProfile,
      }))

      const response = await window.fetch('/api/profile/Turbo%20Bloom?include_stages=true')
      expect(response.status).toBe(200)
      const body = await readJson<{
        status: string
        profile: { stages: Array<Record<string, unknown>>; variables: Array<Record<string, unknown>> }
      }>(response)
      expect(body.profile.stages).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Bloom' })]),
      )
      expect(body.profile.variables).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'dose' })]),
      )
    })

    it('renders a short dynamics ramp over real time instead of compressing it to instant (#483)', async () => {
      const rampProfile = [
        {
          change_id: 'change-ramp',
          profile: {
            id: 'profile-ramp',
            name: 'Ramp Hold',
            author: 'MeticAI',
            author_id: 'author-ramp',
            previous_authors: [],
            display: { description: 'ramp then hold' },
            temperature: 93,
            final_weight: 36,
            variables: [],
            stages: [
              {
                name: 'Ramp',
                type: 'pressure',
                key: 'pressure_ramp',
                // 3→9 bar over the first 2s, then hold at 9 bar to ~30s
                dynamics: { points: [[0, 3], [2, 9], [30, 9]], over: 'time', interpolation: 'linear' },
                exit_triggers: [{ type: 'time', value: 8 }],
                limits: [],
              },
            ],
          },
        },
      ] as unknown as ProfileIdent[]

      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': rampProfile,
      }))

      const response = await window.fetch('/api/profile/Ramp%20Hold/target-curves')
      expect(response.status).toBe(200)
      const body = await readJson<{ target_curves: Array<{ time: number; target_pressure?: number }> }>(response)
      const curve = body.target_curves

      // The ramp's end (9 bar) must land at its real 2s offset — the old scaling
      // (duration / maxX) compressed it toward t=0 (~0.53s), rendering it instant.
      const nineBar = curve.find(point => point.target_pressure === 9)
      expect(nineBar).toBeDefined()
      expect(nineBar!.time).toBeCloseTo(2, 1)

      // Stage starts at 3 bar and the final value is held to the 8s exit.
      expect(curve[0]).toMatchObject({ time: 0, target_pressure: 3 })
      expect(curve.some(point => point.time === 8 && point.target_pressure === 9)).toBe(true)
    })

    it('preserves flat profile.image in direct profile info and image proxy routes', async () => {
      vi.useRealTimers()
      machineModeMocks.getDefaultMachineUrl.mockReturnValue('http://machine.local:8080')
      const flatImageProfiles: ProfileIdent[] = [{
        ...nestedMachineProfiles()[0],
        profile: {
          ...nestedMachineProfiles()[0].profile,
          display: { description: 'Flat image profile' },
          image: '/profile/flat-profile.png',
        } as ProfileIdent['profile'] & { image: string },
      }]
      let imageFetches = 0
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': flatImageProfiles,
        'GET /profile/flat-profile.png': ({ url }: FetchCall) => {
          imageFetches += 1
          return url === 'http://machine.local:8080/profile/flat-profile.png'
            ? new Response('flat-image-bytes', { headers: { 'Content-Type': 'image/png' } })
            : jsonResponse({ detail: `wrong image URL: ${url}` }, 599)
        },
      }))

      const profileResponse = await window.fetch('/api/profile/Turbo%20Bloom')
      const imageResponse = await window.fetch('/api/profile/Turbo%20Bloom/image-proxy')

      expect(profileResponse.status).toBe(200)
      await expect(readJson(profileResponse)).resolves.toEqual({
        status: 'success',
        profile: expect.objectContaining({
          id: 'profile-1',
          name: 'Turbo Bloom',
          image: '/profile/flat-profile.png',
        }),
      })
      expect(imageResponse.status).toBe(200)
      await expect(imageResponse.text()).resolves.toBe('flat-image-bytes')
      expect(imageFetches).toBe(1)
    })

    it('proxies and caches profile images from a cold direct profile cache', async () => {
      vi.useRealTimers()
      machineModeMocks.getDefaultMachineUrl.mockReturnValue('http://machine.local:8080')
      let imageFetches = 0
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
        'GET /profile/profile-1.png': ({ url }: FetchCall) => {
          imageFetches += 1
          return url === 'http://machine.local:8080/profile/profile-1.png'
            ? new Response('image-bytes', { headers: { 'Content-Type': 'image/png' } })
            : jsonResponse({ detail: `wrong image URL: ${url}` }, 599)
        },
      }))

      const firstResponse = await window.fetch('/api/profile/Turbo%20Bloom/image-proxy')
      const secondResponse = await window.fetch('/api/profile/Turbo%20Bloom/image-proxy')

      expect(firstResponse.status).toBe(200)
      expect(firstResponse.headers.get('content-type')).toContain('image/png')
      await expect(firstResponse.text()).resolves.toBe('image-bytes')
      expect(secondResponse.status).toBe(200)
      await expect(secondResponse.text()).resolves.toBe('image-bytes')
      expect(imageFetches).toBe(1)
    })

    it('updates a machine profile through the direct profile edit route', async () => {
      let savedProfile: Record<string, unknown> | null = null
      installInterceptor(createMachineFetch({
        'GET /api/v1/profile/list': nestedMachineProfiles(),
        'POST /api/v1/profile/save': ({ init }: FetchCall) => {
          savedProfile = JSON.parse(String(init?.body))
          return jsonResponse({ ok: true })
        },
      }))

      const response = await window.fetch('/api/profile/Turbo%20Bloom/edit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Turbo Bloom v2',
          temperature: 94,
          final_weight: 37,
          variables: [{ key: 'flow_bloom', value: 1.8 }],
          author: 'Direct Barista',
        }),
      })

      expect(response.status).toBe(200)
      const body = await readJson<{ status: string; profile: Record<string, unknown> }>(response)
      expect(body).toMatchObject({
        status: 'success',
        profile: {
          id: 'profile-1',
          name: 'Turbo Bloom v2',
          temperature: 94,
          final_weight: 37,
          author: 'Direct Barista',
        },
      })
      expect(savedProfile).toMatchObject({
        id: 'profile-1',
        name: 'Turbo Bloom v2',
        temperature: 94,
        final_weight: 37,
        author: 'Direct Barista',
      })
    })

    it('persists direct shot annotations with rating and exposes summaries', async () => {
      vi.useRealTimers()
      installInterceptor()

      const patchResponse = await window.fetch('/api/shots/2026-01-03/shot-1.json/annotation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotation: 'Sweet and balanced', rating: 4 }),
      })
      const getResponse = await window.fetch('/api/shots/2026-01-03/shot-1.json/annotation')
      const summaryResponse = await window.fetch('/api/shots/annotations')
      const clearRatingResponse = await window.fetch('/api/shots/2026-01-03/shot-1.json/annotation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: null }),
      })
      const deleteResponse = await window.fetch('/api/shots/2026-01-03/shot-1.json/annotation', {
        method: 'DELETE',
      })
      const afterDeleteResponse = await window.fetch('/api/shots/2026-01-03/shot-1.json/annotation')

      expect(patchResponse.status).toBe(200)
      await expect(readJson(patchResponse)).resolves.toEqual({
        status: 'success',
        annotation: 'Sweet and balanced',
        rating: 4,
        updated_at: expect.any(String),
      })
      await expect(readJson(getResponse)).resolves.toMatchObject({
        status: 'success',
        annotation: 'Sweet and balanced',
        rating: 4,
      })
      await expect(readJson(summaryResponse)).resolves.toMatchObject({
        status: 'success',
        annotations: {
          '2026-01-03/shot-1.json': { has_annotation: true, rating: 4 },
        },
      })
      await expect(readJson(clearRatingResponse)).resolves.toMatchObject({
        status: 'success',
        annotation: 'Sweet and balanced',
        rating: null,
      })
      await expect(readJson(deleteResponse)).resolves.toEqual({ status: 'success', deleted: true })
      await expect(readJson(afterDeleteResponse)).resolves.toEqual({
        status: 'success',
        annotation: null,
        rating: null,
        updated_at: null,
      })
    })

    it('marks rating-only annotations as annotated in recent-shot routes', async () => {
      vi.useRealTimers()
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': machineHistory(),
      }))

      await window.fetch('/api/shots/2026-01-03/shot-1.json/annotation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 4 }),
      })
      const recentResponse = await window.fetch('/api/shots/recent')
      const byProfileResponse = await window.fetch('/api/shots/recent/by-profile')

      const recentBody = await readJson<{ shots: Array<{ filename: string; has_annotation: boolean }> }>(recentResponse)
      expect(recentBody.shots.find((shot) => shot.filename === 'shot-1.json')).toMatchObject({
        has_annotation: true,
      })
      const byProfileBody = await readJson<{
        profiles: Array<{ shots: Array<{ filename: string; has_annotation: boolean }> }>
      }>(byProfileResponse)
      const groupedShot = byProfileBody.profiles
        .flatMap((profile) => profile.shots)
        .find((shot) => shot.filename === 'shot-1.json')
      expect(groupedShot).toMatchObject({ has_annotation: true })
    })

    it('rejects invalid direct annotation ratings and clears empty annotations', async () => {
      vi.useRealTimers()
      installInterceptor()

      const invalidRatingResponse = await window.fetch('/api/shots/2026-01-03/shot-clear.json/annotation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 6 }),
      })
      const initialResponse = await window.fetch('/api/shots/2026-01-03/shot-clear.json/annotation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotation: '  Keep this note  ', rating: 3 }),
      })
      const clearRatingResponse = await window.fetch('/api/shots/2026-01-03/shot-clear.json/annotation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: null }),
      })
      const clearResponse = await window.fetch('/api/shots/2026-01-03/shot-clear.json/annotation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotation: '   ' }),
      })
      const afterClearResponse = await window.fetch('/api/shots/2026-01-03/shot-clear.json/annotation')
      const summariesResponse = await window.fetch('/api/shots/annotations')

      expect(invalidRatingResponse.status).toBe(422)
      expect(initialResponse.status).toBe(200)
      await expect(readJson(clearRatingResponse)).resolves.toMatchObject({
        status: 'success',
        annotation: 'Keep this note',
        rating: null,
      })
      expect(clearResponse.status).toBe(200)
      await expect(readJson(clearResponse)).resolves.toEqual({
        status: 'success',
        annotation: null,
        rating: null,
        updated_at: null,
      })
      await expect(readJson(afterClearResponse)).resolves.toEqual({
        status: 'success',
        annotation: null,
        rating: null,
        updated_at: null,
      })
      const summaries = await readJson<{ annotations: Record<string, unknown> }>(summariesResponse)
      expect(summaries.annotations).not.toHaveProperty('2026-01-03/shot-clear.json')
    })

    it('persists direct history notes and merges them into history detail responses', async () => {
      vi.useRealTimers()
      installInterceptor(createMachineFetch({
        'GET /api/v1/history': machineHistory(),
      }))

      const patchResponse = await window.fetch('/api/history/shot-1/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Needs a finer grind next time.' }),
      })
      const notesResponse = await window.fetch('/api/history/shot-1/notes')
      const detailResponse = await window.fetch('/api/history/shot-1')

      expect(patchResponse.status).toBe(200)
      await expect(readJson(patchResponse)).resolves.toEqual({
        status: 'success',
        notes: 'Needs a finer grind next time.',
        notes_updated_at: expect.any(String),
      })
      await expect(readJson(notesResponse)).resolves.toMatchObject({
        status: 'success',
        notes: 'Needs a finer grind next time.',
      })
      await expect(readJson(detailResponse)).resolves.toMatchObject({
        id: 'shot-1',
        notes: 'Needs a finer grind next time.',
        notes_updated_at: expect.any(String),
      })
    })

    it('returns backend-compatible identifiers when preparing a bundled recipe', async () => {
      installInterceptor(createMachineFetch({
        'POST /api/v1/profile/load': { ok: true },
      }))

      const response = await window.fetch('/api/pour-over/prepare-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe_slug: 'hoffmann-v2' }),
      })

      expect(response.status).toBe(200)
      await expect(readJson(response)).resolves.toEqual({
        profile_id: expect.any(String),
        profile_name: 'MeticAI Recipe: Better 1-Cup V60',
      })
    })

    it('uses settled weight from retracting data points for shot metrics', async () => {
      vi.useRealTimers()
      const historyWithRetraction = [{
        id: 'shot-retract',
        time: Date.parse('2026-01-03T10:00:00Z') / 1000,
        name: 'Turbo Bloom',
        file: 'shot-retract.json',
        profile: {
          id: 'profile-1',
          name: 'Turbo Bloom',
          final_weight: 36,
          temperature: 93,
        },
        data: [
          { time: 0, profile_time: 0, status: 'Bloom', shot: { pressure: 2, flow: 2.1, weight: 0 } },
          { time: 15000, profile_time: 15000, status: 'Bloom', shot: { pressure: 2, flow: 2.0, weight: 12 } },
          { time: 25000, profile_time: 25000, status: 'Ramp', shot: { pressure: 8, flow: 1.5, weight: 28 } },
          { time: 30000, profile_time: 30000, status: 'Ramp', shot: { pressure: 8, flow: 1.2, weight: 33.5 } },
          // Retracting phase — piston retracts, residual liquid drips into cup
          { time: 31000, profile_time: 31000, status: 'retracting', shot: { pressure: 0, flow: 0.3, weight: 34.8 } },
          { time: 33000, profile_time: 33000, status: 'retracting', shot: { pressure: 0, flow: 0.1, weight: 35.9 } },
        ],
      }]

      installInterceptor(createMachineFetch({
        'GET /api/v1/history': historyWithRetraction,
      }))

      // The last-shot endpoint uses getHistoryMetrics which reads the absolute last data point
      const lastShotResponse = await window.fetch('/api/last-shot')
      const lastShot = await readJson<{ final_weight: number; total_time: number }>(lastShotResponse)
      // Should use the settled weight (35.9g from the last retracting point), not 33.5g from the last active point
      expect(lastShot.final_weight).toBe(35.9)
      expect(lastShot.total_time).toBe(33)
    })
  })
})
