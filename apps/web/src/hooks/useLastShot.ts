/**
 * useLastShot — fetches the most recent shot from the server and
 * calculates how long ago it was pulled.
 *
 * Uses sessionStorage to track user dismissals so the banner won't
 * reappear during the same browser session for the same shot.
 */
import { useCallback, useEffect, useState } from 'react'
import { getServerUrl } from '@/lib/config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LastShotData {
  profile_name: string
  date: string
  filename: string
  timestamp: string
  final_weight: number | null
  total_time: number | null
}

export interface UseLastShotResult {
  /** The last shot data, or null if not loaded / no shots */
  lastShot: LastShotData | null
  /** Approximate number of minutes since the shot was pulled */
  minutesAgo: number | null
  /** Whether the user has dismissed this particular shot */
  dismissed: boolean
  /** Dismiss the current shot (persisted for this session) */
  dismiss: () => void
  /** Refresh the data */
  refresh: () => Promise<void>
  /** Loading state */
  loading: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'lastShotDismissed'
const POLL_INTERVAL_MS = 60_000 // re-check every minute to update minutesAgo

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLastShot(enabled: boolean): UseLastShotResult {
  const [lastShot, setLastShot] = useState<LastShotData | null>(null)
  const [minutesAgo, setMinutesAgo] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchLastShot = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const base = await getServerUrl()
      const res = await fetch(`${base}/api/last-shot`)
      if (!res.ok) {
        setLastShot(null)
        setMinutesAgo(null)
        return
      }
      const data: LastShotData = await res.json()
      setLastShot(data)

      // Calculate minutes ago
      if (data.timestamp) {
        const shotTime = new Date(data.timestamp).getTime()
        const diff = Date.now() - shotTime
        setMinutesAgo(Math.max(0, Math.round(diff / 60_000)))
      } else {
        setMinutesAgo(null)
      }

      // Check if this shot was already dismissed
      const dismissedId = sessionStorage.getItem(STORAGE_KEY)
      setDismissed(dismissedId === `${data.date}/${data.filename}`)
    } catch {
      setLastShot(null)
      setMinutesAgo(null)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  const dismiss = useCallback(() => {
    if (lastShot) {
      sessionStorage.setItem(STORAGE_KEY, `${lastShot.date}/${lastShot.filename}`)
      setDismissed(true)
    }
  }, [lastShot])

  // Initial fetch + periodic refresh
  useEffect(() => {
    if (!enabled) return
    fetchLastShot()
    const id = setInterval(() => {
      // Only update minutesAgo between full fetches
      setMinutesAgo(prev => (prev !== null ? prev + 1 : null))
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [enabled, fetchLastShot])

  return { lastShot, minutesAgo, dismissed, dismiss, refresh: fetchLastShot, loading }
}
