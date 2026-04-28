import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProfileImageCache } from './useProfileImageCache'
import { useProfileImageSrc } from './useProfileImageSrc'

const machineUrlMocks = vi.hoisted(() => ({
  resolveMachineUrl: vi.fn(async () => 'http://native-preferences:8080'),
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

vi.mock('@/lib/machineMode', () => ({
  isDirectMode: vi.fn(() => true),
  isNativePlatform: vi.fn(() => true),
  getDefaultMachineUrl: vi.fn(() => 'http://stale-localstorage:8080'),
}))

vi.mock('@/services/machine/machineUrl', () => machineUrlMocks)

describe('direct/native profile image resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('resolves flat profile.image paths with the async native machine URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      profile: { image: '/profile-images/turbo.png' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const { result } = renderHook(() => useProfileImageSrc('Turbo Bloom'))

    await waitFor(() => {
      expect(result.current).toBe('http://native-preferences:8080/profile-images/turbo.png')
    })
    expect(machineUrlMocks.resolveMachineUrl).toHaveBeenCalled()
  })

  it('caches flat profile.image paths with the async native machine URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      profile: { image: '/profile-images/cache.png' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const { result } = renderHook(() => useProfileImageCache())

    let images: Record<string, string> = {}
    await act(async () => {
      images = await result.current.fetchImagesForProfiles(['Cached Bloom'])
    })

    expect(images['Cached Bloom']).toBe('http://native-preferences:8080/profile-images/cache.png')
    expect(result.current.getImageUrl('Cached Bloom')).toBe('http://native-preferences:8080/profile-images/cache.png')
  })
})
