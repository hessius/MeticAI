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

// Shared subscription: single pair of global listeners fans out to all subscribers
const subscribers = new Set<() => void>()
let listening = false

function ensureListeners() {
  if (typeof window === 'undefined' || listening) return
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === STORAGE_KEYS.USE_KONSTA_UI) subscribers.forEach(cb => cb())
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
 * True when: viewport is mobile OR the settings toggle is forced on.
 */
export function useKonstaOverride() {
  const isMobile = useIsMobile()
  const forced = useSyncExternalStore(subscribe, getStoredValue, () => false)
  return isMobile || forced
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
