import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUpdateTrigger } from './useUpdateTrigger'

describe('useUpdateTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (window as { location?: unknown }).location
    window.location = { reload: vi.fn() } as unknown as Location
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useUpdateTrigger())

    expect(result.current.isUpdating).toBe(false)
    expect(result.current.updateError).toBe(null)
    expect(result.current.updateSuccess).toBe(false)
  })

  it('should trigger update successfully', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', message: 'Update started' }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ update_available: false }),
      } as Response)

    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateTrigger())

    result.current.triggerUpdate()

    await waitFor(() => {
      expect(result.current.isUpdating).toBe(true)
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/trigger-update'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('should handle update errors', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: async () => ({ detail: { message: 'Update failed' } }),
      } as Response)
    )
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateTrigger())

    await result.current.triggerUpdate()

    await waitFor(() => {
      expect(result.current.updateError).toBeTruthy()
    })

    expect(result.current.isUpdating).toBe(false)
  })

  it('should handle network errors during update', async () => {
    const mockFetch = vi.fn(() =>
      Promise.reject(new Error('Network error'))
    )
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateTrigger())

    await result.current.triggerUpdate()

    await waitFor(() => {
      expect(result.current.updateError).toBeTruthy()
    })

    expect(result.current.updateError).toContain('Network error')
  })
})
