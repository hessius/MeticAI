import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock useIsMobile before importing the hook
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}))

import { useKonstaOverride, useKonstaToggle } from './useKonstaOverride'
import { useIsMobile } from '@/hooks/use-mobile'
import { STORAGE_KEYS } from '@/lib/constants'

describe('useKonstaOverride', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(useIsMobile).mockReturnValue(false)
  })

  it('returns false when not mobile and not forced', () => {
    const { result } = renderHook(() => useKonstaOverride())
    expect(result.current).toBe(false)
  })

  it('returns true when mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    const { result } = renderHook(() => useKonstaOverride())
    expect(result.current).toBe(true)
  })

  it('returns true when forced via localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.USE_KONSTA_UI, 'true')
    const { result } = renderHook(() => useKonstaOverride())
    expect(result.current).toBe(true)
  })
})

describe('useKonstaToggle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes from localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.USE_KONSTA_UI, 'true')
    const { result } = renderHook(() => useKonstaToggle())
    expect(result.current.enabled).toBe(true)
  })

  it('defaults to false', () => {
    const { result } = renderHook(() => useKonstaToggle())
    expect(result.current.enabled).toBe(false)
  })

  it('writes to localStorage and updates state', () => {
    const { result } = renderHook(() => useKonstaToggle())
    act(() => result.current.setEnabled(true))
    expect(result.current.enabled).toBe(true)
    expect(localStorage.getItem(STORAGE_KEYS.USE_KONSTA_UI)).toBe('true')
  })

  it('same-tab toggle updates useKonstaOverride immediately', () => {
    const { result: overrideResult } = renderHook(() => useKonstaOverride())
    const { result: toggleResult } = renderHook(() => useKonstaToggle())

    expect(overrideResult.current).toBe(false)
    act(() => toggleResult.current.setEnabled(true))
    // After dispatching the custom event, the override should pick it up
    expect(overrideResult.current).toBe(true)
  })
})
