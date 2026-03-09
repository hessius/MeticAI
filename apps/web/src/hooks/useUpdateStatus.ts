import { useState, useEffect, useCallback } from 'react'
import { getServerUrl } from '@/lib/config'

interface UpdateStatus {
  update_available: boolean
  last_check?: string
  current_version?: string
  latest_version?: string
  release_url?: string
  fresh_check?: boolean
  latest_stable_version?: string | null
  latest_beta_version?: string | null
}

interface UseUpdateStatusReturn {
  updateAvailable: boolean
  isChecking: boolean
  error: string | null
  checkForUpdates: () => Promise<{ updateAvailable: boolean; error: string | null }>
  lastChecked: string | null
  latestStableVersion: string | null
  latestBetaVersion: string | null
}

// Check cached status every 5 minutes (queries GitHub Releases API with server-side cache)
const CHECK_INTERVAL_MINUTES = 5
const CHECK_INTERVAL = CHECK_INTERVAL_MINUTES * 60 * 1000

export function useUpdateStatus(): UseUpdateStatusReturn {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<string | null>(null)
  const [latestStableVersion, setLatestStableVersion] = useState<string | null>(null)
  const [latestBetaVersion, setLatestBetaVersion] = useState<string | null>(null)

  // Read cached status from the server
  const readCachedStatus = useCallback(async (): Promise<{ updateAvailable: boolean; error: string | null }> => {
    try {
      const serverUrl = await getServerUrl()
      const response = await fetch(`${serverUrl}/api/status`)

      if (!response.ok) {
        throw new Error(`Failed to read status: ${response.status}`)
      }

      const data: UpdateStatus = await response.json()
      const hasUpdate = data.update_available || false
      setUpdateAvailable(hasUpdate)
      setLastChecked(data.last_check || null)
      setLatestStableVersion(data.latest_stable_version ?? null)
      setLatestBetaVersion(data.latest_beta_version ?? null)
      return { updateAvailable: hasUpdate, error: null }
    } catch (err) {
      console.error('Error reading cached status:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to read status'
      return { updateAvailable: false, error: errorMessage }
    }
  }, [])

  // Trigger a fresh update check (queries GitHub Releases API, bypasses cache)
  const checkForUpdates = useCallback(async (): Promise<{ updateAvailable: boolean; error: string | null }> => {
    setIsChecking(true)
    setError(null)

    try {
      const serverUrl = await getServerUrl()
      // Use the check-updates endpoint that bypasses the server-side cache
      const response = await fetch(`${serverUrl}/api/check-updates`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`Failed to check for updates: ${response.status}`)
      }

      const data: UpdateStatus = await response.json()
      const hasUpdate = data.update_available || false
      setUpdateAvailable(hasUpdate)
      setLastChecked(data.last_check || new Date().toISOString())
      setLatestStableVersion(data.latest_stable_version ?? null)
      setLatestBetaVersion(data.latest_beta_version ?? null)
      return { updateAvailable: hasUpdate, error: null }
    } catch (err) {
      console.error('Error checking for updates:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates'
      setError(errorMessage)
      setUpdateAvailable(false)
      return { updateAvailable: false, error: errorMessage }
    } finally {
      setIsChecking(false)
    }
  }, [])

  // Read cached status on mount and periodically
  useEffect(() => {
    readCachedStatus()

    const interval = setInterval(readCachedStatus, CHECK_INTERVAL)
    return () => clearInterval(interval)
  }, [readCachedStatus])

  return {
    updateAvailable,
    isChecking,
    error,
    checkForUpdates,
    lastChecked,
    latestStableVersion,
    latestBetaVersion,
  }
}
