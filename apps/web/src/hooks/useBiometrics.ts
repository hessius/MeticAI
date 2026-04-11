/**
 * useBiometrics — biometric authentication on native platforms, no-op on web.
 *
 * Wraps @aparajita/capacitor-biometric-auth with silent error handling.
 * On web: authenticate() always resolves true (no gating).
 * Uses dynamic import to avoid crashing the host chunk if the plugin fails to load.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'

export interface BiometryInfo {
  isAvailable: boolean
  biometryType: number
}

// Lazy-load the plugin to prevent module-level errors from crashing the host chunk
let _pluginPromise: Promise<typeof import('@aparajita/capacitor-biometric-auth')> | null = null
function getPlugin() {
  if (!_pluginPromise) {
    _pluginPromise = import('@aparajita/capacitor-biometric-auth').catch(() => null)
  }
  return _pluginPromise
}

export function useBiometrics() {
  const isNative = Capacitor.isNativePlatform()
  const [biometry, setBiometry] = useState<BiometryInfo>({
    isAvailable: false,
    biometryType: 0,
  })
  const listenerRef = useRef<{ remove: () => void } | null>(null)

  useEffect(() => {
    if (!isNative) return

    let cancelled = false

    ;(async () => {
      try {
        const plugin = await getPlugin()
        if (!plugin || cancelled) return

        const result = await plugin.BiometricAuth.checkBiometry()
        if (!cancelled) {
          setBiometry({
            isAvailable: result.isAvailable,
            biometryType: result.biometryType,
          })
        }

        const handle = await plugin.BiometricAuth.addResumeListener((info) => {
          if (!cancelled) {
            setBiometry({
              isAvailable: info.isAvailable,
              biometryType: info.biometryType,
            })
          }
        })
        if (!cancelled) {
          listenerRef.current = handle
        } else {
          handle.remove()
        }
      } catch {
        // Plugin failed to initialize — biometrics simply won't be available
      }
    })()

    return () => {
      cancelled = true
      listenerRef.current?.remove()
      listenerRef.current = null
    }
  }, [isNative])

  const authenticate = useCallback(
    async (reason = 'Please authenticate'): Promise<boolean> => {
      if (!isNative) return true

      try {
        const plugin = await getPlugin()
        if (!plugin) return true // fail open if plugin unavailable

        await plugin.BiometricAuth.authenticate({
          reason,
          cancelTitle: 'Cancel',
          allowDeviceCredential: true,
          iosFallbackTitle: 'Use passcode',
          androidTitle: 'Authentication required',
          androidSubtitle: reason,
          androidConfirmationRequired: false,
        })
        return true
      } catch {
        // Biometry unavailable, user cancelled, or plugin error — fail open
        return false
      }
    },
    [isNative],
  )

  return { biometry, authenticate, isNative }
}
