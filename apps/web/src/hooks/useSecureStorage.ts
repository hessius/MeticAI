/**
 * useSecureStorage — secure key-value storage.
 *
 * Uses @aparajita/capacitor-secure-storage (Keychain) on native,
 * falls back to localStorage on web.
 */

import { useCallback } from 'react'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { Capacitor } from '@capacitor/core'

export function useSecureStorage() {
  const isNative = Capacitor.isNativePlatform()

  const getItem = useCallback(
    async (key: string): Promise<string | null> => {
      if (!isNative) {
        return localStorage.getItem(key)
      }
      try {
        const value = await SecureStorage.getItem(key)
        return value ?? null
      } catch {
        return null
      }
    },
    [isNative],
  )

  const setItem = useCallback(
    async (key: string, value: string): Promise<void> => {
      if (!isNative) {
        localStorage.setItem(key, value)
        return
      }
      try {
        await SecureStorage.setItem(key, value)
      } catch {
        // Storage write failed — non-critical
      }
    },
    [isNative],
  )

  const removeItem = useCallback(
    async (key: string): Promise<void> => {
      if (!isNative) {
        localStorage.removeItem(key)
        return
      }
      try {
        await SecureStorage.removeItem(key)
      } catch {
        // Storage removal failed — non-critical
      }
    },
    [isNative],
  )

  return { getItem, setItem, removeItem }
}
