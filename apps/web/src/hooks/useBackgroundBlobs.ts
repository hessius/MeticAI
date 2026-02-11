import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'meticai-show-blobs'

/**
 * Manages the user's preference for showing/hiding the ambient
 * background blobs. Persisted in localStorage (client-side only).
 * Defaults to `true` (blobs visible).
 */
export function useBackgroundBlobs() {
  const [showBlobs, setShowBlobs] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored === null ? true : stored === 'true'
    } catch {
      return true
    }
  })

  // Keep localStorage in sync
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(showBlobs))
    } catch {
      // storage full or unavailable — silently ignore
    }
  }, [showBlobs])

  const toggleBlobs = useCallback(() => {
    setShowBlobs((prev) => !prev)
  }, [])

  return { showBlobs, setShowBlobs, toggleBlobs } as const
}
