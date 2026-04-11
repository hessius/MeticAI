/**
 * useWakeLock — prevents screen dimming during active brewing or pour over.
 *
 * Uses @capacitor-community/keep-awake on native platforms,
 * falls back to the Web Wake Lock API on web.
 *
 * Usage:
 *   const { request, release, isActive } = useWakeLock()
 *   useEffect(() => { request(); return () => { release() } }, [])
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { Capacitor } from '@capacitor/core'

interface WakeLockHandle {
  request: () => Promise<void>
  release: () => Promise<void>
  isActive: boolean
}

export function useWakeLock(): WakeLockHandle {
  const [isActive, setIsActive] = useState(false)
  const sentinelRef = useRef<WakeLockSentinel | null>(null)
  const isNative = Capacitor.isNativePlatform()

  const request = useCallback(async () => {
    if (isNative) {
      try {
        await KeepAwake.keepAwake()
        setIsActive(true)
      } catch {
        // Plugin call failed — fall through
      }
      return
    }

    // Web Wake Lock API fallback
    if ('wakeLock' in navigator) {
      try {
        sentinelRef.current = await navigator.wakeLock.request('screen')
        sentinelRef.current.addEventListener('release', () => setIsActive(false))
        setIsActive(true)
      } catch {
        // Wake lock request can fail (e.g. low battery, background tab)
      }
    }
  }, [isNative])

  const release = useCallback(async () => {
    if (isNative) {
      try {
        await KeepAwake.allowSleep()
      } catch {
        // Plugin call failed
      }
      setIsActive(false)
      return
    }

    // Web Wake Lock API
    if (sentinelRef.current) {
      try {
        await sentinelRef.current.release()
      } catch { /* already released */ }
      sentinelRef.current = null
      setIsActive(false)
    }
  }, [isNative])

  // Re-acquire wake lock on visibility change (browser releases on tab hide)
  useEffect(() => {
    if (!isActive) return

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isActive && !sentinelRef.current) {
        request()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isActive, request])

  return { request, release, isActive }
}
