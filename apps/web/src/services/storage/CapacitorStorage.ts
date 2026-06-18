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

interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

function isCapacitorNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!cap?.isNativePlatform?.()
}

// ---------------------------------------------------------------------------
// Capacitor Preferences adapter (lazy-loaded to avoid import errors on web)
// ---------------------------------------------------------------------------

let _preferencesModule: typeof import('@capacitor/preferences') | null = null

async function getPreferences() {
  if (!_preferencesModule) {
    _preferencesModule = await import('@capacitor/preferences')
  }
  // Return the module namespace and let callers read `.Preferences` from it.
  // Returning the Preferences proxy directly from an async function is unsafe:
  // on Android the proxy is "thenable" (accessing `.then` yields a function),
  // so `await getPreferences()` would follow it and reject with
  // "Preferences.then() is not implemented on android". The module namespace
  // has no `then` export, so awaiting it is safe on every platform.
  return _preferencesModule
}

const capacitorAdapter: StorageAdapter = {
  async get(key: string) {
    try {
      const { Preferences } = await getPreferences()
      // Race against a timeout — Capacitor bridge can occasionally stall
      const result = await Promise.race([
        Preferences.get({ key }),
        new Promise<{ value: null }>((resolve) =>
          setTimeout(() => resolve({ value: null }), 3000)
        ),
      ])
      if (result.value !== null) return result.value
      // Preferences returned null or timed out — check localStorage mirror
      try {
        return localStorage.getItem(key)
      } catch { return null }
    } catch {
      // Plugin failed entirely — fall back to localStorage
      try {
        return localStorage.getItem(key)
      } catch { return null }
    }
  },
  async set(key: string, value: string) {
    const { Preferences } = await getPreferences()
    await Preferences.set({ key, value })
    // Mirror to localStorage so the get() fallback always has fresh data
    try { localStorage.setItem(key, value) } catch { /* quota exceeded */ }
  },
  async remove(key: string) {
    const { Preferences } = await getPreferences()
    await Preferences.remove({ key })
    try { localStorage.removeItem(key) } catch { /* noop */ }
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
  get: (key) => isCapacitorNativePlatform()
    ? capacitorAdapter.get(key)
    : localStorageAdapter.get(key),
  set: (key, value) => isCapacitorNativePlatform()
    ? capacitorAdapter.set(key, value)
    : localStorageAdapter.set(key, value),
  remove: (key) => isCapacitorNativePlatform()
    ? capacitorAdapter.remove(key)
    : localStorageAdapter.remove(key),
}
