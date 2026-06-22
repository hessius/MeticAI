import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsNative = true
const secureStorageMock = vi.hoisted(() => ({
  setItem: vi.fn(),
  getItem: vi.fn(),
  removeItem: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockIsNative },
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: secureStorageMock,
}))

import { useSecureStorage } from './useSecureStorage'

describe('useSecureStorage (native key mirroring)', () => {
  beforeEach(() => {
    mockIsNative = true
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('mirrors the value to localStorage synchronously, before awaiting the Keychain write', async () => {
    // Keychain write that never resolves — simulates a slow/hung native plugin.
    let resolveKeychain: (() => void) | undefined
    secureStorageMock.setItem.mockReturnValue(new Promise<void>(res => { resolveKeychain = () => res() }))

    const { result } = renderHook(() => useSecureStorage())

    // Fire the write but do NOT await it (the Keychain promise is pending).
    let writePromise: Promise<void>
    act(() => {
      writePromise = result.current.setItem('gemini-api-key', 'AIzaTESTKEY')
    })

    // localStorage mirror must already be present even though Keychain is pending.
    expect(localStorage.getItem('gemini-api-key')).toBe('AIzaTESTKEY')
    expect(secureStorageMock.setItem).toHaveBeenCalledWith('gemini-api-key', 'AIzaTESTKEY')

    // Clean up the pending promise.
    resolveKeychain?.()
    await act(async () => { await writePromise })
  })

  it('still mirrors to localStorage when the Keychain write rejects', async () => {
    secureStorageMock.setItem.mockRejectedValue(new Error('Keychain unavailable'))
    const { result } = renderHook(() => useSecureStorage())

    await act(async () => {
      await result.current.setItem('gemini-api-key', 'AIzaTESTKEY')
    })

    expect(localStorage.getItem('gemini-api-key')).toBe('AIzaTESTKEY')
  })

  it('writes directly to localStorage on web (non-native)', async () => {
    mockIsNative = false
    const { result } = renderHook(() => useSecureStorage())

    await act(async () => {
      await result.current.setItem('gemini-api-key', 'AIzaWEBKEY')
    })

    expect(localStorage.getItem('gemini-api-key')).toBe('AIzaWEBKEY')
    expect(secureStorageMock.setItem).not.toHaveBeenCalled()
  })
})
