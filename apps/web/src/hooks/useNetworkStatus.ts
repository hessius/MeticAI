/**
 * useNetworkStatus — monitors network connectivity.
 *
 * Uses @capacitor/network on native, navigator.onLine on web.
 */

import { useEffect, useState } from 'react'
import { Network } from '@capacitor/network'
import { Capacitor } from '@capacitor/core'

interface NetworkStatus {
  isConnected: boolean
  connectionType: 'wifi' | 'cellular' | 'none' | 'unknown'
  isWifi: boolean
}

export function useNetworkStatus(): NetworkStatus {
  const isNative = Capacitor.isNativePlatform()
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    connectionType: 'unknown',
    isWifi: false,
  })

  useEffect(() => {
    if (isNative) {
      // Initial status
      Network.getStatus()
        .then(({ connected, connectionType }) => {
          setStatus({
            isConnected: connected,
            connectionType: connectionType as NetworkStatus['connectionType'],
            isWifi: connectionType === 'wifi',
          })
        })
        .catch(() => {
          // Keep defaults
        })

      // Listen for changes
      const handle = Network.addListener('networkStatusChange', ({ connected, connectionType }) => {
        setStatus({
          isConnected: connected,
          connectionType: connectionType as NetworkStatus['connectionType'],
          isWifi: connectionType === 'wifi',
        })
      })

      return () => {
        handle.then((h) => h.remove())
      }
    }

    // Web fallback
    const update = () =>
      setStatus({
        isConnected: navigator.onLine,
        connectionType: navigator.onLine ? 'unknown' : 'none',
        isWifi: false,
      })

    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)

    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [isNative])

  return status
}
