import { useState, useCallback, useSyncExternalStore } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { STORAGE_KEYS } from '@/lib/constants'

const KONSTA_CHANGED = 'konsta-ui-changed'

function getStoredValue(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.USE_KONSTA_UI) === 'true'
  } catch {
    return false
  }
}

function getPlatformThemeIsNone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.PLATFORM_THEME) === 'none'
  } catch {
    return false
  }
}

// Shared subscription: single pair of global listeners fans out to all subscribers
const subscribers = new Set<() => void>()
let listening = false

function ensureListeners() {
  if (typeof window === 'undefined' || listening) return
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === STORAGE_KEYS.USE_KONSTA_UI || e.key === STORAGE_KEYS.PLATFORM_THEME) subscribers.forEach(cb => cb())
  })
  window.addEventListener(KONSTA_CHANGED, () => {
    subscribers.forEach(cb => cb())
  })
  listening = true
}

function subscribe(callback: () => void) {
  subscribers.add(callback)
  ensureListeners()
  return () => { subscribers.delete(callback) }
}

/**
 * Returns true if Konsta UI components should render.
 *
 * TEMPORARILY DISABLED — always returns false while Konsta layout conflicts
 * are resolved. See https://github.com/hessius/MeticAI/issues/336
 * Original logic preserved below for when this is re-enabled.
 */
export function useKonstaOverride() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _isMobile = useIsMobile()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _forced = useSyncExternalStore(subscribe, getStoredValue, () => false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _themeIsNone = useSyncExternalStore(subscribe, getPlatformThemeIsNone, () => false)
  // Original: if (themeIsNone) return false; return isMobile || forced;
  return false
}

/**
 * Hook to read/write the Konsta UI forced toggle (for Settings UI).
 */
export function useKonstaToggle() {
  const [enabled, setEnabledState] = useState(getStoredValue)

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value)
    try {
      localStorage.setItem(STORAGE_KEYS.USE_KONSTA_UI, String(value))
      window.dispatchEvent(new Event(KONSTA_CHANGED))
    } catch { /* noop */ }
  }, [])

  return { enabled, setEnabled } as const
}
