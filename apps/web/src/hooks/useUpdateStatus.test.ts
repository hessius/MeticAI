import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUpdateStatus } from './useUpdateStatus'

describe('useUpdateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with default values', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ update_available: false }),
      } as Response)
    )

    const { result } = renderHook(() => useUpdateStatus())

    // Initially, it will start checking
    expect(result.current.updateAvailable).toBe(false)
    
    // Wait for the initial check to complete
    await waitFor(() => {
      expect(result.current.isChecking).toBe(false)
    })
    
    expect(result.current.error).toBe(null)
  })

  it('should check for updates on mount', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          update_available: true,
          last_check: '2026-01-14T12:00:00Z',
        }),
      } as Response)
    )
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateStatus())

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true)
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/status')
    )
  })

  it('should handle fetch errors gracefully', async () => {
    const mockFetch = vi.fn(() =>
      Promise.reject(new Error('Network error'))
    )
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateStatus())

    // Wait for the initial check to complete
    await waitFor(() => {
      expect(result.current.isChecking).toBe(false)
    })

    // readCachedStatus doesn't set error state, only returns it
    // Error state is only set when checkForUpdates is called
    expect(result.current.updateAvailable).toBe(false)
    expect(result.current.error).toBe(null)
  })

  it('should manually check for updates', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ update_available: false }),
      } as Response)
    )
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateStatus())

    await result.current.checkForUpdates()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })
  })
})
