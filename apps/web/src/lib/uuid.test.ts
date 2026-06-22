import { describe, it, expect, afterEach, vi } from 'vitest'
import { safeRandomUUID } from './uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('safeRandomUUID', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns native crypto.randomUUID when available (secure context)', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID')
    const id = safeRandomUUID()
    expect(spy).toHaveBeenCalled()
    expect(id).toMatch(UUID_V4)
  })

  it('falls back to getRandomValues when randomUUID is unavailable (insecure http context)', () => {
    // Simulate a non-secure context where crypto.randomUUID is undefined,
    // e.g. self-hosted Metic reached over http://<lan-ip>:<port>.
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      undefined as unknown as `${string}-${string}-${string}-${string}-${string}`,
    )
    const id = safeRandomUUID()
    expect(id).toMatch(UUID_V4)
  })

  it('produces unique values across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => safeRandomUUID()))
    expect(ids.size).toBe(100)
  })
})
