import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importProfileFromSource } from './importProfile'

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

function mockFetch(impl: () => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('importProfileFromSource', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('posts the source and generate_description flag to the endpoint', async () => {
    mockFetch(() => jsonResponse({ status: 'success', profile_name: 'Slay-ish' }))
    await importProfileFromSource('https://metprofiles.link/profile/abc', {
      generateDescription: true,
    })
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(call[0])).toBe('/api/import-from-url')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      url: 'https://metprofiles.link/profile/abc',
      generate_description: true,
    })
  })

  it('returns success with the profile name', async () => {
    mockFetch(() => jsonResponse({ status: 'success', profile_name: 'Slay-ish' }))
    const result = await importProfileFromSource('{"name":"Slay-ish"}')
    expect(result).toEqual({ status: 'success', profileName: 'Slay-ish' })
  })

  it('distinguishes an already-imported profile as exists', async () => {
    mockFetch(() => jsonResponse({ status: 'exists', profile_name: 'Slay-ish' }))
    const result = await importProfileFromSource('https://x/p.json')
    expect(result).toEqual({ status: 'exists', profileName: 'Slay-ish' })
  })

  it('surfaces a string detail as the error message', async () => {
    mockFetch(() => jsonResponse({ detail: 'Could not fetch profile (404)' }, 502))
    const result = await importProfileFromSource('https://x/missing.json')
    expect(result).toEqual({ status: 'error', message: 'Could not fetch profile (404)' })
  })

  it('surfaces a nested detail.error as the error message', async () => {
    mockFetch(() => jsonResponse({ detail: { error: 'Not a valid profile' } }, 400))
    const result = await importProfileFromSource('https://x/bad.json')
    expect(result).toEqual({ status: 'error', message: 'Not a valid profile' })
  })

  it('returns a null message when the error body has no detail', async () => {
    mockFetch(() => jsonResponse({}, 500))
    const result = await importProfileFromSource('https://x/p.json')
    expect(result).toEqual({ status: 'error', message: null })
  })

  it('returns an error result when fetch rejects', async () => {
    mockFetch(() => {
      throw new Error('Network down')
    })
    const result = await importProfileFromSource('https://x/p.json')
    expect(result).toEqual({ status: 'error', message: 'Network down' })
  })
})
