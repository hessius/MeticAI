/**
 * useBiometrics — biometric authentication on native platforms, no-op on web.
 *
 * Wraps @aparajita/capacitor-biometric-auth with silent error handling.
 * On web: authenticate() always resolves true (no gating).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  BiometricAuth,
  BiometryError,
  BiometryErrorType,
  BiometryType,
  type CheckBiometryResult,
} from '@aparajita/capacitor-biometric-auth'
import { Capacitor } from '@capacitor/core'

export interface BiometryInfo {
  isAvailable: boolean
  biometryType: BiometryType
}

export function useBiometrics() {
  const isNative = Capacitor.isNativePlatform()
  const [biometry, setBiometry] = useState<BiometryInfo>({
    isAvailable: false,
    biometryType: BiometryType.none,
  })

  useEffect(() => {
    if (!isNative) return

    let listenerHandle: Awaited<ReturnType<typeof BiometricAuth.addResumeListener>> | null = null

    const update = (result: CheckBiometryResult) => {
      setBiometry({
        isAvailable: result.isAvailable,
        biometryType: result.biometryType,
      })
    }

    BiometricAuth.checkBiometry().then(update).catch(() => {})

    BiometricAuth.addResumeListener(update)
      .then((handle) => { listenerHandle = handle })
      .catch(() => {})

    return () => {
      listenerHandle?.remove()
    }
  }, [isNative])

  const authenticate = useCallback(
    async (reason = 'Please authenticate'): Promise<boolean> => {
      if (!isNative) return true

      try {
        await BiometricAuth.authenticate({
          reason,
          cancelTitle: 'Cancel',
          allowDeviceCredential: true,
          iosFallbackTitle: 'Use passcode',
          androidTitle: 'Authentication required',
          androidSubtitle: reason,
          androidConfirmationRequired: false,
        })
        return true
      } catch (error) {
        if (error instanceof BiometryError && error.code === BiometryErrorType.userCancel) {
          return false
        }
        // Biometry unavailable or other error — fail open on non-critical path
        return false
      }
    },
    [isNative],
  )

  return { biometry, authenticate, isNative }
}
