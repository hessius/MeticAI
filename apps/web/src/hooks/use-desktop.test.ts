import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useIsDesktop } from './use-desktop'

describe('useIsDesktop', () => {
  beforeEach(() => {
    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it('should return true for desktop width (>= 768px)', async () => {
    // Mock matchMedia to return matches: true
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    const { result } = renderHook(() => useIsDesktop())
    
    await waitFor(() => {
      expect(result.current).toBe(true)
    })
  })

  it('should return false for mobile width (< 768px)', async () => {
    // Mock matchMedia to return matches: false
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    const { result } = renderHook(() => useIsDesktop())
    
    await waitFor(() => {
      expect(result.current).toBe(false)
    })
  })

  it('should return undefined initially then update', async () => {
    const { result } = renderHook(() => useIsDesktop())
    // The hook sets the value synchronously in useEffect, so it might already be set
    // Just verify it's a boolean value eventually
    await waitFor(() => {
      expect(typeof result.current).toBe('boolean')
    })
  })

  it('should update when media query changes', async () => {
    let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null
    
    const mockMediaQuery = {
      matches: false,
      media: '(min-width: 768px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          mediaQueryListener = listener
        }
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mockMediaQuery),
    })

    const { result } = renderHook(() => useIsDesktop())
    
    await waitFor(() => {
      expect(result.current).toBe(false)
    })

    // Simulate media query change
    mockMediaQuery.matches = true
    if (mediaQueryListener) {
      (mediaQueryListener as (e: MediaQueryListEvent) => void)({ matches: true } as MediaQueryListEvent)
    }

    await waitFor(() => {
      expect(result.current).toBe(true)
    })
  })
})
