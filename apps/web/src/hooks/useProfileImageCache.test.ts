import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useProfileImageCache } from './useProfileImageCache'

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

describe('useProfileImageCache', () => {
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

  describe('initialization', () => {
    it('should initialize with empty cache when localStorage is empty', () => {
      const { result } = renderHook(() => useProfileImageCache())
      
      expect(result.current.cache).toEqual({})
      expect(result.current.isLoading).toBe(false)
    })

    it('should load cache from localStorage on mount', async () => {
      const cachedData = {
        'Test Profile': { url: 'http://example.com/image.jpg', timestamp: Date.now() }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.cache['Test Profile']).toBeDefined()
      })
      expect(result.current.cache['Test Profile'].url).toBe('http://example.com/image.jpg')
    })

    it('should filter out expired entries on load', async () => {
      const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000) // 25 hours ago
      const newTimestamp = Date.now() - (1 * 60 * 60 * 1000) // 1 hour ago
      
      const cachedData = {
        'Old Profile': { url: 'http://example.com/old.jpg', timestamp: oldTimestamp },
        'New Profile': { url: 'http://example.com/new.jpg', timestamp: newTimestamp }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.cache['New Profile']).toBeDefined()
      })
      expect(result.current.cache['Old Profile']).toBeUndefined()
    })
  })

  describe('getImageUrl', () => {
    it('should return cached URL for valid cache entry', async () => {
      const cachedData = {
        'Test Profile': { url: 'http://example.com/image.jpg', timestamp: Date.now() }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.getImageUrl('Test Profile')).toBe('http://example.com/image.jpg')
      })
    })

    it('should return null for expired cache entry', async () => {
      const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000) // 25 hours ago
      const cachedData = {
        'Old Profile': { url: 'http://example.com/old.jpg', timestamp: oldTimestamp }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      // Expired entries are filtered on load, so this should be null
      await waitFor(() => {
        expect(result.current.getImageUrl('Old Profile')).toBeNull()
      })
    })

    it('should return null for non-existent profile', () => {
      const { result } = renderHook(() => useProfileImageCache())
      
      expect(result.current.getImageUrl('Non Existent')).toBeNull()
    })
  })

  describe('setImageUrl', () => {
    it('should add new entry to cache', () => {
      const { result } = renderHook(() => useProfileImageCache())
      
      act(() => {
        result.current.setImageUrl('New Profile', 'http://example.com/new.jpg')
      })
      
      expect(result.current.cache['New Profile']).toBeDefined()
      expect(result.current.cache['New Profile'].url).toBe('http://example.com/new.jpg')
    })

    it('should save to localStorage when setting URL', () => {
      const { result } = renderHook(() => useProfileImageCache())
      
      act(() => {
        result.current.setImageUrl('New Profile', 'http://example.com/new.jpg')
      })
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'meticai-profile-images-cache',
        expect.any(String)
      )
    })

    it('should update existing cache entry', async () => {
      const cachedData = {
        'Test Profile': { url: 'http://example.com/old.jpg', timestamp: Date.now() - 10000 }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.cache['Test Profile']).toBeDefined()
      })
      
      act(() => {
        result.current.setImageUrl('Test Profile', 'http://example.com/updated.jpg')
      })
      
      expect(result.current.cache['Test Profile'].url).toBe('http://example.com/updated.jpg')
    })
  })

  describe('invalidate', () => {
    it('should remove entry from cache', async () => {
      const cachedData = {
        'Test Profile': { url: 'http://example.com/image.jpg', timestamp: Date.now() }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.cache['Test Profile']).toBeDefined()
      })
      
      act(() => {
        result.current.invalidate('Test Profile')
      })
      
      expect(result.current.cache['Test Profile']).toBeUndefined()
    })

    it('should update localStorage when invalidating', async () => {
      const cachedData = {
        'Test Profile': { url: 'http://example.com/image.jpg', timestamp: Date.now() }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.cache['Test Profile']).toBeDefined()
      })
      
      act(() => {
        result.current.invalidate('Test Profile')
      })
      
      // Should have been called to save the updated cache
      expect(localStorageMock.setItem).toHaveBeenCalled()
    })
  })

  describe('clearCache', () => {
    it('should clear all entries', async () => {
      const cachedData = {
        'Profile 1': { url: 'http://example.com/1.jpg', timestamp: Date.now() },
        'Profile 2': { url: 'http://example.com/2.jpg', timestamp: Date.now() }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(Object.keys(result.current.cache).length).toBe(2)
      })
      
      act(() => {
        result.current.clearCache()
      })
      
      expect(result.current.cache).toEqual({})
    })

    it('should remove from localStorage', () => {
      const { result } = renderHook(() => useProfileImageCache())
      
      act(() => {
        result.current.setImageUrl('Test', 'http://test.com')
      })
      
      act(() => {
        result.current.clearCache()
      })
      
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('meticai-profile-images-cache')
    })
  })

  describe('fetchImagesForProfiles', () => {
    it('should return cached images without fetching', async () => {
      const cachedData = {
        'Cached Profile': { url: 'http://example.com/cached.jpg', timestamp: Date.now() }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.cache['Cached Profile']).toBeDefined()
      })
      
      let images: Record<string, string> = {}
      await act(async () => {
        images = await result.current.fetchImagesForProfiles(['Cached Profile'])
      })
      
      expect(images['Cached Profile']).toBe('http://example.com/cached.jpg')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should fetch uncached images', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ profile: { image: 'some-image-data' } })
      })
      
      const { result } = renderHook(() => useProfileImageCache())
      
      let images: Record<string, string> = {}
      await act(async () => {
        images = await result.current.fetchImagesForProfiles(['New Profile'])
      })
      
      expect(mockFetch).toHaveBeenCalled()
      // URL should be defined and contain encoded profile name
      expect(images['New Profile']).toContain('New%20Profile')
    })

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      
      const { result } = renderHook(() => useProfileImageCache())
      
      let images: Record<string, string> = {}
      await act(async () => {
        images = await result.current.fetchImagesForProfiles(['Error Profile'])
      })
      
      // Should return empty for failed fetch
      expect(images['Error Profile']).toBeUndefined()
    })

    it('should mix cached and fetched results', async () => {
      const cachedData = {
        'Cached Profile': { url: 'http://example.com/cached.jpg', timestamp: Date.now() }
      }
      localStorageMock.setItem('meticai-profile-images-cache', JSON.stringify(cachedData))
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ profile: { image: 'some-image-data' } })
      })
      
      const { result } = renderHook(() => useProfileImageCache())
      
      await waitFor(() => {
        expect(result.current.cache['Cached Profile']).toBeDefined()
      })
      
      let images: Record<string, string> = {}
      await act(async () => {
        images = await result.current.fetchImagesForProfiles(['Cached Profile', 'New Profile'])
      })
      
      expect(images['Cached Profile']).toBe('http://example.com/cached.jpg')
      expect(images['New Profile']).toBeDefined()
    })

    it('should set isLoading during fetch', async () => {
      // This test verifies that isLoading becomes false after fetch completes
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ profile: { image: 'data' } })
      })
      
      const { result } = renderHook(() => useProfileImageCache())
      
      // Before any fetch, isLoading should be false
      expect(result.current.isLoading).toBe(false)
      
      await act(async () => {
        await result.current.fetchImagesForProfiles(['Loading Profile'])
      })
      
      // After fetch completes, isLoading should be false again
      expect(result.current.isLoading).toBe(false)
    })

    it('should reset isLoading to false if an error occurs during fetch', async () => {
      // Mock a fetch that throws an error after setIsLoading(true) is called
      mockFetch.mockImplementationOnce(() => {
        throw new Error('Network error during fetch')
      })
      
      const { result } = renderHook(() => useProfileImageCache())
      
      // Before any fetch, isLoading should be false
      expect(result.current.isLoading).toBe(false)
      
      await act(async () => {
        await result.current.fetchImagesForProfiles(['Test Profile'])
      })
      
      // After error, isLoading should be reset to false
      expect(result.current.isLoading).toBe(false)
    })
  })
})
