/**
 * CapacitorStorage — native key-value storage for Capacitor apps.
 *
 * Wraps @capacitor/preferences (UserDefaults on iOS, SharedPreferences on
 * Android) for settings that must persist reliably across app updates.
 *
 * Usage: import { capacitorStorage } from this module, then use get/set/remove.
 * Falls back to localStorage when not running in Capacitor.
 *
 * NOTE: This is for simple key-value settings (machine URL, API keys, prefs).
 * Structured data (profiles, images, annotations) stays in IndexedDB via
 * AppDatabase — that works fine in WKWebView for reasonable data sizes.
 */

import { isNativePlatform } from '@/lib/machineMode'

interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Capacitor Preferences adapter (lazy-loaded to avoid import errors on web)
// ---------------------------------------------------------------------------

let _preferencesModule: typeof import('@capacitor/preferences') | null = null

async function getPreferences() {
  if (!_preferencesModule) {
    _preferencesModule = await import('@capacitor/preferences')
  }
  return _preferencesModule.Preferences
}

const capacitorAdapter: StorageAdapter = {
  async get(key: string) {
    const Preferences = await getPreferences()
    const { value } = await Preferences.get({ key })
    return value
  },
  async set(key: string, value: string) {
    const Preferences = await getPreferences()
    await Preferences.set({ key, value })
  },
  async remove(key: string) {
    const Preferences = await getPreferences()
    await Preferences.remove({ key })
  },
}

// ---------------------------------------------------------------------------
// localStorage fallback (web/PWA)
// ---------------------------------------------------------------------------

const localStorageAdapter: StorageAdapter = {
  async get(key: string) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  async set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch { /* quota exceeded or unavailable */ }
  },
  async remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch { /* noop */ }
  },
}

// ---------------------------------------------------------------------------
// Unified export
// ---------------------------------------------------------------------------

/**
 * Platform-aware key-value storage.
 * Uses Capacitor Preferences on native, localStorage on web.
 */
export const capacitorStorage: StorageAdapter = {
  get: (key) => isNativePlatform()
    ? capacitorAdapter.get(key)
    : localStorageAdapter.get(key),
  set: (key, value) => isNativePlatform()
    ? capacitorAdapter.set(key, value)
    : localStorageAdapter.set(key, value),
  remove: (key) => isNativePlatform()
    ? capacitorAdapter.remove(key)
    : localStorageAdapter.remove(key),
}
