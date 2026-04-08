/**
 * Machine mode detection — determines how the frontend communicates and
 * what runtime platform it's running on.
 *
 * Transport mode (how we talk to the machine):
 *  - 'direct': REST + Socket.IO directly to the machine
 *  - 'proxy':  via MeticAI FastAPI backend
 *
 * Runtime platform (where the app is hosted):
 *  - 'web':            standard browser, MeticAI Docker
 *  - 'machine-hosted': PWA served from the machine itself
 *  - 'native':         Capacitor iOS/Android app
 *
 * Selection priority for transport mode:
 *  1. Build-time: VITE_MACHINE_MODE env var ('direct' | 'proxy' | 'capacitor')
 *  2. Runtime: Capacitor native → direct
 *  3. Runtime: port 8080 → direct (served from machine)
 *  4. Fallback: proxy
 */

import { STORAGE_KEYS } from '@/lib/constants'

export type MachineMode = 'direct' | 'proxy'
export type RuntimePlatform = 'web' | 'machine-hosted' | 'native'

// ---------------------------------------------------------------------------
// Runtime platform detection
// ---------------------------------------------------------------------------

/** Detect whether we're running inside a Capacitor native shell */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  // Capacitor injects window.Capacitor at boot
  const cap = (window as Record<string, unknown>).Capacitor as
    | { isNativePlatform?: () => boolean }
    | undefined
  return !!cap?.isNativePlatform?.()
}

export function getRuntimePlatform(): RuntimePlatform {
  if (isNativePlatform()) return 'native'
  if (typeof window !== 'undefined' && window.location.port === '8080') return 'machine-hosted'
  return 'web'
}

// ---------------------------------------------------------------------------
// Transport mode detection
// ---------------------------------------------------------------------------

export function getMachineMode(): MachineMode {
  // Build-time override
  const envMode = import.meta.env.VITE_MACHINE_MODE
  if (envMode === 'direct' || envMode === 'capacitor') return 'direct'
  if (envMode === 'proxy') return 'proxy'

  // Native apps always use direct transport
  if (isNativePlatform()) return 'direct'

  // Machine-hosted PWA (port 8080)
  if (typeof window !== 'undefined' && window.location.port === '8080') {
    return 'direct'
  }

  return 'proxy'
}

// ---------------------------------------------------------------------------
// Machine URL resolution
// ---------------------------------------------------------------------------

/**
 * Returns the machine base URL for direct-mode communication.
 *
 * Priority:
 *  1. VITE_DEFAULT_MACHINE_URL env var
 *  2. Stored machine URL (native/user-configured)
 *  3. Same-origin inference (machine-hosted PWA only)
 *  4. Fallback: meticulous.local:8080
 */
export function getDefaultMachineUrl(): string {
  const envUrl = import.meta.env.VITE_DEFAULT_MACHINE_URL
  if (envUrl) return envUrl

  // Check user-stored machine URL (from discovery, QR, or manual entry)
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.MACHINE_URL)
      if (stored) return stored
    } catch { /* localStorage unavailable */ }
  }

  // Machine-hosted PWA: derive from current origin
  if (typeof window !== 'undefined') {
    const platform = getRuntimePlatform()
    if (platform === 'machine-hosted') {
      return `${window.location.protocol}//${window.location.hostname}:8080`
    }
  }

  // Fallback — user needs to configure via settings or discovery
  return 'http://meticulous.local:8080'
}

/**
 * Persist the machine URL for future sessions.
 * Used by machine discovery, QR scanning, and manual IP entry.
 */
export function setMachineUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MACHINE_URL, url)
  } catch { /* noop */ }
}

export function isDirectMode(): boolean {
  return getMachineMode() === 'direct'
}
