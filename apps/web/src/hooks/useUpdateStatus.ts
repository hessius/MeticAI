import { useState, useEffect, useCallback } from 'react'
import { getServerUrl } from '@/lib/config'

interface UpdateStatus {
  update_available: boolean
  last_check?: string
  repositories?: Record<string, unknown>
  fresh_check?: boolean
}

interface UseUpdateStatusReturn {
  updateAvailable: boolean
  isChecking: boolean
  error: string | null
  checkForUpdates: () => Promise<{ updateAvailable: boolean; error: string | null }>
  lastChecked: string | null
}

// Check cached status every 5 minutes (reads from .versions.json)
const CHECK_INTERVAL_MINUTES = 5
const CHECK_INTERVAL = CHECK_INTERVAL_MINUTES * 60 * 1000

export function useUpdateStatus(): UseUpdateStatusReturn {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  // Read cached status (fast, no git fetch)
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
      return { updateAvailable: hasUpdate, error: null }
    } catch (err) {
      console.error('Error reading cached status:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to read status'
      return { updateAvailable: false, error: errorMessage }
    }
  }, [])

  // Trigger a fresh update check (runs git fetch, slower)
  const checkForUpdates = useCallback(async (): Promise<{ updateAvailable: boolean; error: string | null }> => {
    setIsChecking(true)
    setError(null)

    try {
      const serverUrl = await getServerUrl()
      // Use the new endpoint that triggers an actual git fetch
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
  }
}
