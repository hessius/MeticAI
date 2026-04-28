import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { hasFeature } from '@/lib/featureFlags'
import { useUpdateTrigger } from './useUpdateTrigger'

vi.mock('@/lib/featureFlags', () => ({
  hasFeature: vi.fn(() => true),
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const mockedHasFeature = vi.mocked(hasFeature)

describe('useUpdateTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedHasFeature.mockReturnValue(true)
    delete (window as { location?: unknown }).location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: vi.fn() },
    })
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

    await act(async () => {
      void result.current.triggerUpdate()
    })

    await waitFor(() => {
      expect(result.current.isUpdating).toBe(true)
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/trigger-update'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('should handle update errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: async () => ({ detail: { message: 'Update failed' } }),
      } as Response)
    )
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateTrigger())

    await act(async () => {
      await result.current.triggerUpdate()
    })

    await waitFor(() => {
      expect(result.current.updateError).toBeTruthy()
    })

    expect(result.current.isUpdating).toBe(false)
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error triggering update:', expect.any(Error))
  })

  it('should handle network errors during update', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockFetch = vi.fn(() =>
      Promise.reject(new Error('Network error'))
    )
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateTrigger())

    await act(async () => {
      await result.current.triggerUpdate()
    })

    await waitFor(() => {
      expect(result.current.updateError).toBeTruthy()
    })

    expect(result.current.updateError).toContain('Network error')
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error triggering update:', expect.any(Error))
  })

  it('does not trigger backend updates when watchtower updates are disabled', async () => {
    mockedHasFeature.mockReturnValue(false)
    const mockFetch = vi.fn()
    global.fetch = mockFetch

    const { result } = renderHook(() => useUpdateTrigger())

    await act(async () => {
      await result.current.triggerUpdate()
    })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.updateError).toBe('update.unavailableInMode')
    expect(result.current.isUpdating).toBe(false)
  })
})
