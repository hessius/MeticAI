import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProxyAiConfigured } from './aiConfigStatus'

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

describe('fetchProxyAiConfigured', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when the backend reports the key configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ geminiApiKeyConfigured: true, geminiApiKey: '' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))
    await expect(fetchProxyAiConfigured()).resolves.toBe(true)
  })

  it('returns true when a non-empty geminiApiKey is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ geminiApiKeyConfigured: false, geminiApiKey: 'AIzaKEY' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))
    await expect(fetchProxyAiConfigured()).resolves.toBe(true)
  })

  it('returns false when no key is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ geminiApiKeyConfigured: false, geminiApiKey: '' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))
    await expect(fetchProxyAiConfigured()).resolves.toBe(false)
  })

  it('returns null when the backend responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(fetchProxyAiConfigured()).resolves.toBeNull()
  })

  it('returns null when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(fetchProxyAiConfigured()).resolves.toBeNull()
  })
})
