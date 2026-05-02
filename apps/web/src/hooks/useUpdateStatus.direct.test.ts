import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasFeature } from '@/lib/featureFlags'
import { useUpdateStatus } from './useUpdateStatus'

const originalFetch = globalThis.fetch
const mockedHasFeature = vi.mocked(hasFeature)

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

vi.mock('@/lib/featureFlags', () => ({
  hasFeature: vi.fn((feature: string) => feature !== 'watchtowerUpdate' && feature !== 'bridgeStatus'),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useUpdateStatus direct-mode guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    mockedHasFeature.mockImplementation((feature: string) => feature !== 'watchtowerUpdate' && feature !== 'bridgeStatus')
  })

  it('does not fire backend update-status calls when update features are disabled', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ update_available: false }))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useUpdateStatus())
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fire a manual check-updates call when update features are disabled', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ update_available: false }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useUpdateStatus())
    let response: { updateAvailable: boolean; error: string | null } | undefined
    await act(async () => {
      response = await result.current.checkForUpdates()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response).toEqual({ updateAvailable: false, error: 'update.unavailableInMode' })
    expect(result.current.error).toBe('update.unavailableInMode')
  })
})
