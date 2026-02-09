import { useState, useCallback, useRef } from 'react'
import { getServerUrl } from '@/lib/config'

interface CacheEntry {
  url: string
  timestamp: number
}

interface ImageCache {
  [profileName: string]: CacheEntry
}

const CACHE_KEY = 'meticai-profile-images-cache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Load and clean cache from localStorage synchronously
 * Returns valid (non-expired) entries only
 */
function loadCacheFromStorage(): ImageCache {
  try {
    const stored = localStorage.getItem(CACHE_KEY)
    if (!stored) return {}
    
    const parsed: ImageCache = JSON.parse(stored)
    const now = Date.now()
    const validEntries: ImageCache = {}
    
    for (const [key, entry] of Object.entries(parsed)) {
      if (now - entry.timestamp < CACHE_TTL_MS) {
        validEntries[key] = entry
      }
    }
    
    // Save cleaned cache back if we removed expired entries
    if (Object.keys(validEntries).length !== Object.keys(parsed).length) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(validEntries))
    }
    
    return validEntries
  } catch (err) {
    console.error('Failed to load image cache:', err)
    return {}
  }
}

/**
 * Hook to manage profile image caching with localStorage persistence
 */
export function useProfileImageCache() {
  // Initialize state synchronously from localStorage to avoid race conditions
  const [cache, setCache] = useState<ImageCache>(() => loadCacheFromStorage())
  const [isLoading, setIsLoading] = useState(false)

  // Save cache to localStorage when it changes
  const saveCache = useCallback((newCache: ImageCache) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(newCache))
    } catch (err) {
      console.error('Failed to save image cache:', err)
    }
  }, [])

  // Get image URL for a profile (returns cached or null)
  const getImageUrl = useCallback((profileName: string): string | null => {
    const entry = cache[profileName]
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return entry.url
    }
    return null
  }, [cache])

  // Set image URL for a profile
  const setImageUrl = useCallback((profileName: string, url: string) => {
    setCache(prev => {
      const newCache = {
        ...prev,
        [profileName]: { url, timestamp: Date.now() }
      }
      saveCache(newCache)
      return newCache
    })
  }, [saveCache])

  // Invalidate cache for a specific profile
  const invalidate = useCallback((profileName: string) => {
    setCache(prev => {
      const newCache = { ...prev }
      delete newCache[profileName]
      saveCache(newCache)
      return newCache
    })
  }, [saveCache])

  // Clear entire cache
  const clearCache = useCallback(() => {
    setCache({})
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch (err) {
      console.error('Failed to clear image cache:', err)
    }
  }, [])

  // Use refs to avoid recreating fetchImagesForProfiles when cache changes
  // This prevents infinite loops in useEffect dependencies
  const cacheRef = useRef(cache)
  cacheRef.current = cache
  const setImageUrlRef = useRef(setImageUrl)
  setImageUrlRef.current = setImageUrl

  // Fetch images for multiple profiles, using cache where available
  // This callback is stable (no dependencies that change with cache)
  const fetchImagesForProfiles = useCallback(async (profileNames: string[]): Promise<Record<string, string>> => {
    const serverUrl = await getServerUrl()
    const results: Record<string, string> = {}
    const toFetch: string[] = []
    const currentCache = cacheRef.current

    // Check cache first
    for (const name of profileNames) {
      const entry = currentCache[name]
      if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        results[name] = entry.url
      } else {
        toFetch.push(name)
      }
    }

    if (toFetch.length === 0) {
      return results
    }

    // Only set loading state if we actually need to fetch
    try {
      setIsLoading(true)
      
      // Fetch uncached images in batches
      const batchSize = 10
      for (let i = 0; i < toFetch.length; i += batchSize) {
        const batch = toFetch.slice(i, i + batchSize)
        const fetchPromises = batch.map(async (profileName) => {
          try {
            const response = await fetch(
              `${serverUrl}/api/profile/${encodeURIComponent(profileName)}`
            )
            if (response.ok) {
              const data = await response.json()
              // Always construct image URL if profile exists - let the image proxy handle missing images
              // This prevents the case where profiles exist but image field hasn't been populated yet
              if (data.profile) {
                const imageUrl = `${serverUrl}/api/profile/${encodeURIComponent(profileName)}/image-proxy`
                results[profileName] = imageUrl
                setImageUrlRef.current(profileName, imageUrl)
              }
            }
          } catch (error: unknown) {
            // Ignore errors for individual profile fetches so they don't interrupt the batch,
            // but log them at debug level using structured logging to avoid log injection
            console.debug('Failed to fetch profile image', { profileName, error })
          }
        })

        await Promise.allSettled(fetchPromises)
      }

      return results
    } finally {
      setIsLoading(false)
    }
  }, []) // Empty dependency array - uses refs for stable reference

  return {
    cache,
    isLoading,
    getImageUrl,
    setImageUrl,
    invalidate,
    clearCache,
    fetchImagesForProfiles
  }
}
