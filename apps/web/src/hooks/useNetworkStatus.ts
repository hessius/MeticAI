/**
 * useNetworkStatus — monitors network connectivity.
 *
 * Uses @capacitor/network on native, navigator.onLine on web.
 * Polls periodically on native to catch missed events.
 */

import { useEffect, useRef, useState } from 'react'
import { Network } from '@capacitor/network'
import { Capacitor } from '@capacitor/core'

interface NetworkStatus {
  isConnected: boolean
  connectionType: 'wifi' | 'cellular' | 'none' | 'unknown'
  isWifi: boolean
}

function mapStatus(s: { connected: boolean; connectionType: string }): NetworkStatus {
  return {
    isConnected: s.connected,
    connectionType: s.connectionType as NetworkStatus['connectionType'],
    isWifi: s.connectionType === 'wifi',
  }
}

export function useNetworkStatus(): NetworkStatus {
  const isNative = Capacitor.isNativePlatform()
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    connectionType: 'unknown',
    isWifi: false,
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const poll = () => {
      if (isNative) {
        Network.getStatus()
          .then(s => { if (!cancelled) setStatus(mapStatus(s)) })
          .catch(() => {})
      } else {
        setStatus({
          isConnected: navigator.onLine,
          connectionType: navigator.onLine ? 'unknown' : 'none',
          isWifi: false,
        })
      }
    }

    // Initial check
    poll()

    if (isNative) {
      // Listen for changes
      const handle = Network.addListener('networkStatusChange', (s) => {
        if (!cancelled) setStatus(mapStatus(s))
      })

      // Poll every 10s as a safety net — events can be missed on iOS
      intervalRef.current = setInterval(poll, 10_000)

      return () => {
        cancelled = true
        handle.then(h => h.remove()).catch(() => {})
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }

    // Web fallback
    const onOnline = () => poll()
    const onOffline = () => poll()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    // Poll every 5s on web too — online/offline events can be missed
    intervalRef.current = setInterval(poll, 5_000)

    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isNative])

  return status
}
