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
        // Keychain read failed — fall back to localStorage mirror
        return localStorage.getItem(key)
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
      // On native: write to Keychain AND mirror to localStorage
      // so synchronous readers (BrowserAIService, App.tsx) can find it.
      try {
        await SecureStorage.setItem(key, value)
      } catch {
        // Keychain write failed — non-critical
      }
      try {
        localStorage.setItem(key, value)
      } catch {
        // localStorage fallback — non-critical
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
      // On native: remove from both Keychain and localStorage mirror
      try {
        await SecureStorage.removeItem(key)
      } catch {
        // Removal failed — non-critical
      }
      try {
        localStorage.removeItem(key)
      } catch {
        // localStorage cleanup — non-critical
      }
    },
    [isNative],
  )

  return { getItem, setItem, removeItem }
}
