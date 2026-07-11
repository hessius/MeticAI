import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let mockIsNative = false
let mockPlatform = 'web'
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNative,
    getPlatform: () => mockPlatform,
  },
}))

const mockRemove = vi.fn()
const mockAddListener = vi.fn(async () => ({ remove: mockRemove }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (...args: unknown[]) => mockAddListener(...args),
  },
}))

import { useAndroidBackButton } from './useAndroidBackButton'

describe('useAndroidBackButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNative = false
    mockPlatform = 'web'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not register on the web', () => {
    renderHook(() => useAndroidBackButton(() => {}))
    expect(mockAddListener).not.toHaveBeenCalled()
  })

  it('does not register on native iOS', () => {
    mockIsNative = true
    mockPlatform = 'ios'
    renderHook(() => useAndroidBackButton(() => {}))
    expect(mockAddListener).not.toHaveBeenCalled()
  })

  it('registers a backButton listener on native Android', async () => {
    mockIsNative = true
    mockPlatform = 'android'
    const handler = vi.fn()
    await act(async () => {
      renderHook(() => useAndroidBackButton(handler))
    })
    expect(mockAddListener).toHaveBeenCalledWith('backButton', expect.any(Function))

    // Simulate the hardware back press.
    const registered = mockAddListener.mock.calls[0][1] as () => void
    registered()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not register when disabled', () => {
    mockIsNative = true
    mockPlatform = 'android'
    renderHook(() => useAndroidBackButton(() => {}, false))
    expect(mockAddListener).not.toHaveBeenCalled()
  })

  it('removes the listener on unmount', async () => {
    mockIsNative = true
    mockPlatform = 'android'
    let unmountFn: () => void = () => {}
    await act(async () => {
      const { unmount } = renderHook(() => useAndroidBackButton(() => {}))
      unmountFn = unmount
    })
    await act(async () => {
      unmountFn()
    })
    expect(mockRemove).toHaveBeenCalledTimes(1)
  })
})
