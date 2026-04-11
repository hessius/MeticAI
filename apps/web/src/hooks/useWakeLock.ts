/**
 * useWakeLock — prevents screen dimming during active brewing or pour over.
 *
 * Uses the Web Wake Lock API (supported on modern browsers and WKWebView).
 * When the Capacitor @capacitor-community/keep-awake plugin is installed,
 * it will be used as a native fallback.
 *
 * Usage:
 *   const { request, release, isActive } = useWakeLock()
 *   useEffect(() => { request(); return () => { release() } }, [])
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isNativePlatform } from '@/lib/machineMode'

interface WakeLockHandle {
  request: () => Promise<void>
  release: () => Promise<void>
  isActive: boolean
}

async function tryCapacitorKeepAwake(action: 'keepAwake' | 'allowSleep'): Promise<boolean> {
  if (!isNativePlatform()) return false
  try {
    // Use globalThis to access the plugin — avoids import resolution errors
    // when @capacitor-community/keep-awake isn't installed
    const cap = (globalThis as Record<string, unknown>).Capacitor as
      | { Plugins?: Record<string, { keepAwake?: () => Promise<void>; allowSleep?: () => Promise<void> }> }
      | undefined
    const plugin = cap?.Plugins?.KeepAwake
    if (!plugin) return false
    if (action === 'keepAwake') await plugin.keepAwake?.()
    else await plugin.allowSleep?.()
    return true
  } catch {
    return false
  }
}

export function useWakeLock(): WakeLockHandle {
  const [isActive, setIsActive] = useState(false)
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  const request = useCallback(async () => {
    // Try Capacitor plugin first (native)
    if (await tryCapacitorKeepAwake('keepAwake')) {
      setIsActive(true)
      return
    }

    // Fall back to Web Wake Lock API
    if ('wakeLock' in navigator) {
      try {
        sentinelRef.current = await navigator.wakeLock.request('screen')
        sentinelRef.current.addEventListener('release', () => setIsActive(false))
        setIsActive(true)
      } catch {
        // Wake lock request can fail (e.g. low battery, background tab)
      }
    }
  }, [])

  const release = useCallback(async () => {
    // Try Capacitor plugin first
    if (await tryCapacitorKeepAwake('allowSleep')) {
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
  }, [])

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
