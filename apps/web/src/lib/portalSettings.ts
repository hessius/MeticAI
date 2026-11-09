/**
 * Belka Portal settings — per-browser preferences for the conductivity sensor.
 *
 * Kept in localStorage (like the Live Activity settings): they describe this
 * browser's Bluetooth pairing and timing, which is not shared state. The
 * recordings themselves go through the shared core (`/api/portal/*`).
 */

import { STORAGE_KEYS } from '@/lib/constants'

export interface PortalSettings {
  /** Master switch: show Portal controls and record during shots. */
  enabled: boolean
  /** Keep capturing this long after the pump stops (drips). */
  settleSec: number
  /** Seconds the Portal leads (+) or lags (−) the cup on the scale. */
  lagSec: number
  /** Switch the Portal's own screen to its graph during a shot and back after. */
  autoGraph: boolean
  /** Last coffee label used, offered as the default for the next shot. */
  lastCoffee: string
  /** Last dose entered, offered as the default for the next shot. */
  lastDoseG: number | null
}

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  enabled: false,
  settleSec: 6,
  lagSec: 0,
  autoGraph: true,
  lastCoffee: '',
  lastDoseG: null,
}

const LIMITS = {
  settleSec: { min: 0, max: 60 },
  lagSec: { min: -2, max: 3 },
} as const

function clamp(v: unknown, { min, max }: { min: number; max: number }, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

type Listener = () => void
const listeners = new Set<Listener>()
let cached: PortalSettings | null = null

export function loadPortalSettings(): PortalSettings {
  if (cached) return cached
  let parsed: Partial<PortalSettings> = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.PORTAL_SETTINGS) : null
    if (raw) parsed = JSON.parse(raw) as Partial<PortalSettings>
  } catch {
    // unreadable or unavailable storage — fall back to defaults
  }
  cached = {
    enabled: !!parsed.enabled,
    settleSec: clamp(parsed.settleSec, LIMITS.settleSec, DEFAULT_PORTAL_SETTINGS.settleSec),
    lagSec: clamp(parsed.lagSec, LIMITS.lagSec, DEFAULT_PORTAL_SETTINGS.lagSec),
    autoGraph: parsed.autoGraph ?? DEFAULT_PORTAL_SETTINGS.autoGraph,
    lastCoffee: typeof parsed.lastCoffee === 'string' ? parsed.lastCoffee.slice(0, 120) : '',
    lastDoseG: typeof parsed.lastDoseG === 'number' && Number.isFinite(parsed.lastDoseG) ? parsed.lastDoseG : null,
  }
  return cached
}

export function savePortalSettings(patch: Partial<PortalSettings>): PortalSettings {
  const next: PortalSettings = { ...loadPortalSettings(), ...patch }
  next.settleSec = clamp(next.settleSec, LIMITS.settleSec, DEFAULT_PORTAL_SETTINGS.settleSec)
  next.lagSec = clamp(next.lagSec, LIMITS.lagSec, DEFAULT_PORTAL_SETTINGS.lagSec)
  cached = next
  try {
    localStorage.setItem(STORAGE_KEYS.PORTAL_SETTINGS, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode / quota) — keep the in-memory value
  }
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* a broken listener must not block the others */
    }
  })
  return next
}

/** useSyncExternalStore-compatible subscription. */
export function subscribePortalSettings(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reset the in-memory cache (tests). */
export function __resetPortalSettings(): void {
  cached = null
  listeners.clear()
}
