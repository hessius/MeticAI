import { useState, useCallback } from 'react'
import { getServerUrl } from '@/lib/config'

export interface ShotInfo {
  date: string
  filename: string
  timestamp: string | null
  profile_name: string
  final_weight: number | null
  total_time: number | null
  data?: ShotData
}

export interface ShotData {
  profile: {
    name: string
    author?: string
    temperature?: number
    final_weight?: number
    stages?: Array<{
      name: string
      type: string
      key?: string
    }>
  }
  start_time?: string
  elapsed_time?: number
  final_weight?: number
  data?: {
    time: number[]
    pressure: number[]
    flow: number[]
    weight: number[]
    temperature?: number[]
  }
  // The shot log can have varying structures, this is a common format
  [key: string]: unknown
}

export interface ShotDataResponse {
  date: string
  filename: string
  data: ShotData
}

export interface ProfileShotsResponse {
  profile_name: string
  shots: ShotInfo[]
  count: number
  limit: number
  cached_at?: number
  is_stale?: boolean
}

// Module-level cache that persists across component mounts
interface ShotCache {
  profileName: string | null
  shots: ShotInfo[]
  lastFetched: Date | null
  cachedAt: number | null
}

const shotCache: ShotCache = {
  profileName: null,
  shots: [],
  lastFetched: null,
  cachedAt: null
}

export function useShotHistory() {
  // Initialize state from cache
  const [shots, setShots] = useState<ShotInfo[]>(shotCache.shots)
  const [isLoading, setIsLoading] = useState(false)
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(shotCache.lastFetched)

  const fetchShotsByProfile = useCallback(async (
    profileName: string, 
    options?: { limit?: number; includeData?: boolean; forceRefresh?: boolean }
  ): Promise<ProfileShotsResponse> => {
    // For force refresh, always fetch fresh
    if (options?.forceRefresh) {
      setIsLoading(true)
      setError(null)
    } else if (shotCache.profileName === profileName && shotCache.shots.length > 0) {
      // Return cached data immediately
      setShots(shotCache.shots)
      setLastFetched(shotCache.lastFetched)
      
      // Return cached data - the server will tell us if it's stale
      // Don't block on network, just return cache
      return { 
        profile_name: profileName, 
        shots: shotCache.shots, 
        count: shotCache.shots.length, 
        limit: options?.limit || 20,
        cached_at: shotCache.cachedAt || undefined,
        is_stale: false // Client cache, server will determine staleness
      }
    } else {
      setIsLoading(true)
      setError(null)
    }

    try {
      const serverUrl = await getServerUrl()
      const params = new URLSearchParams()
      if (options?.limit) params.set('limit', options.limit.toString())
      if (options?.includeData) params.set('include_data', 'true')
      if (options?.forceRefresh) params.set('force_refresh', 'true')
      
      const url = `${serverUrl}/api/shots/by-profile/${encodeURIComponent(profileName)}?${params}`
      const response = await fetch(url)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = typeof errorData.detail === 'string' 
          ? errorData.detail 
          : errorData.detail?.message || `Failed to fetch shots: ${response.status}`
        throw new Error(errorMessage)
      }

      const data: ProfileShotsResponse = await response.json()
      const now = new Date()
      
      // Update both local state and module-level cache
      setShots(data.shots)
      setLastFetched(now)
      shotCache.profileName = profileName
      shotCache.shots = data.shots
      shotCache.lastFetched = now
      shotCache.cachedAt = data.cached_at || null
      
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch shot history'
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
      setIsBackgroundRefreshing(false)
    }
  }, [])

  // Background refresh that doesn't block UI - shows cached data while refreshing
  const backgroundRefresh = useCallback(async (
    profileName: string,
    options?: { limit?: number }
  ): Promise<void> => {
    setIsBackgroundRefreshing(true)
    
    try {
      const serverUrl = await getServerUrl()
      const params = new URLSearchParams()
      if (options?.limit) params.set('limit', options.limit.toString())
      params.set('force_refresh', 'true')
      
      const url = `${serverUrl}/api/shots/by-profile/${encodeURIComponent(profileName)}?${params}`
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`Background refresh failed: ${response.status}`)
      }

      const data: ProfileShotsResponse = await response.json()
      const now = new Date()
      
      // Update state with fresh data
      setShots(data.shots)
      setLastFetched(now)
      shotCache.profileName = profileName
      shotCache.shots = data.shots
      shotCache.lastFetched = now
      shotCache.cachedAt = data.cached_at || null
    } catch (err) {
      // Don't set error state for background refresh - we still have cached data
      console.warn('Background refresh failed:', err)
    } finally {
      setIsBackgroundRefreshing(false)
    }
  }, [])

  const fetchShotData = useCallback(async (
    date: string, 
    filename: string
  ): Promise<ShotData> => {
    setIsLoading(true)
    setError(null)

    try {
      const serverUrl = await getServerUrl()
      const url = `${serverUrl}/api/shots/data/${date}/${encodeURIComponent(filename)}`
      const response = await fetch(url)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = typeof errorData.detail === 'string' 
          ? errorData.detail 
          : errorData.detail?.message || `Failed to fetch shot data: ${response.status}`
        throw new Error(errorMessage)
      }

      const result: ShotDataResponse = await response.json()
      return result.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch shot data'
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchAvailableDates = useCallback(async (): Promise<string[]> => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/shots/dates`)
      
      if (!response.ok) {
        throw new Error(`Failed to fetch dates: ${response.status}`)
      }

      const data = await response.json()
      return data.dates || []
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch dates'
      setError(message)
      throw err
    }
  }, [])

  // Check if cache is valid for a given profile
  const isCacheValidForProfile = useCallback((profileName: string): boolean => {
    return shotCache.profileName === profileName && shotCache.shots.length > 0 && shotCache.lastFetched !== null
  }, [])

  return {
    shots,
    isLoading,
    isBackgroundRefreshing,
    error,
    lastFetched,
    fetchShotsByProfile,
    backgroundRefresh,
    fetchShotData,
    fetchAvailableDates,
    isCacheValidForProfile
  }
}
