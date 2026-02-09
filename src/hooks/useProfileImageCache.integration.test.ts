import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useProfileImageCache } from './useProfileImageCache'
import { useState, useEffect } from 'react'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get store() { return store },
    reset: () => { store = {} }
  }
})()

// Mock fetch
const mockFetch = vi.fn()

// Mock getServerUrl
vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn().mockResolvedValue('http://localhost:8000')
}))

describe('useProfileImageCache - Integration Tests', () => {
  beforeEach(() => {
    localStorageMock.reset()
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
    global.fetch = mockFetch
    mockFetch.mockReset()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should handle the HistoryView usage pattern correctly', async () => {
    // Simulate successful fetch responses
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ profile: { image: 'some-image-data' } })
    })

    // Create a component that mimics HistoryView behavior
    function TestComponent() {
      const [entries] = useState<Array<{ profile_name: string }>>([
        { profile_name: 'Profile 1' },
        { profile_name: 'Profile 2' }
      ])
      const [profileImages, setProfileImages] = useState<Record<string, string>>({})
      const { fetchImagesForProfiles } = useProfileImageCache()

      // Mimic the HistoryView image loading effect
      useEffect(() => {
        const loadImages = async () => {
          if (entries.length === 0) return
          
          const profileNames = entries.map(e => e.profile_name)
          const images = await fetchImagesForProfiles(profileNames)
          setProfileImages(images)
        }
        
        loadImages()
      }, [entries, fetchImagesForProfiles])

      return { entries, profileImages }
    }

    const { result } = renderHook(() => TestComponent())

    // Wait for images to load
    await waitFor(() => {
      expect(Object.keys(result.current.profileImages).length).toBe(2)
    })

    // Verify images were fetched and set correctly
    expect(result.current.profileImages['Profile 1']).toContain('Profile%201')
    expect(result.current.profileImages['Profile 2']).toContain('Profile%202')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('should construct image URLs even when profile.image field is missing', async () => {
    // Simulate responses where profile exists but image field is missing
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ profile: {} }) // No image field
    })

    const { result } = renderHook(() => useProfileImageCache())

    let images: Record<string, string> = {}
    await act(async () => {
      images = await result.current.fetchImagesForProfiles(['Profile Without Image'])
    })

    // Should still construct the image-proxy URL
    expect(images['Profile Without Image']).toBeDefined()
    expect(images['Profile Without Image']).toContain('Profile%20Without%20Image')
    expect(images['Profile Without Image']).toContain('/image-proxy')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Verify it was cached
    expect(result.current.cache['Profile Without Image']).toBeDefined()
    expect(result.current.cache['Profile Without Image'].url).toBe(images['Profile Without Image'])
  })

  it('should use cached images on second mount (simulating page refresh)', async () => {
    // First mount - fetch images
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ profile: { image: 'some-image-data' } })
    })

    const { result: result1, unmount } = renderHook(() => useProfileImageCache())

    let images1: Record<string, string> = {}
    await act(async () => {
      images1 = await result1.current.fetchImagesForProfiles(['Profile 1'])
    })

    expect(images1['Profile 1']).toBeDefined()
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Unmount (simulate page navigation/refresh)
    unmount()
    mockFetch.mockClear()

    // Second mount - should use cache
    const { result: result2 } = renderHook(() => useProfileImageCache())

    let images2: Record<string, string> = {}
    await act(async () => {
      images2 = await result2.current.fetchImagesForProfiles(['Profile 1'])
    })

    // Should return cached image without fetching
    expect(images2['Profile 1']).toBe(images1['Profile 1'])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
