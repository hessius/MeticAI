/**
 * Pour-over API helpers — calls the backend pour-over endpoints
 * for temporary profile lifecycle management on the Meticulous machine.
 */
import { getServerUrl } from '@/lib/config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrepareRequest {
  target_weight: number
  bloom_enabled?: boolean
  bloom_seconds?: number
  dose_grams?: number
  brew_ratio?: number
}

export interface PrepareResponse {
  profile_id: string
  profile_name: string
  loaded: boolean
}

export interface CleanupResponse {
  deleted: boolean
  purged?: boolean
  message?: string
}

export interface ActiveResponse {
  active: boolean
  profile_id?: string
  profile_name?: string
  created_at?: string
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Prepare a temporary pour-over profile on the machine.
 * Adapts PourOverBase.json template with the given parameters,
 * creates the profile on the machine, and loads it.
 */
export async function preparePourOver(req: PrepareRequest): Promise<PrepareResponse> {
  const base = await getServerUrl()
  const res = await fetch(`${base}/api/pour-over/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).detail ?? `Prepare failed: ${res.statusText}`)
  }
  return res.json()
}

/**
 * Cleanup (purge + delete) the active temporary profile after a shot completes.
 */
export async function cleanupPourOver(): Promise<CleanupResponse> {
  const base = await getServerUrl()
  const res = await fetch(`${base}/api/pour-over/cleanup`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).detail ?? `Cleanup failed: ${res.statusText}`)
  }
  return res.json()
}

/**
 * Force-cleanup (delete without purge) the active temporary profile.
 * Used when a shot is aborted and purge is not needed.
 */
export async function forceCleanupPourOver(): Promise<CleanupResponse> {
  const base = await getServerUrl()
  const res = await fetch(`${base}/api/pour-over/force-cleanup`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).detail ?? `Force-cleanup failed: ${res.statusText}`)
  }
  return res.json()
}

/**
 * Check if there's an active temporary pour-over profile.
 */
export async function getActivePourOver(): Promise<ActiveResponse> {
  const base = await getServerUrl()
  const res = await fetch(`${base}/api/pour-over/active`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).detail ?? `Get active failed: ${res.statusText}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface ModePreferences {
  autoStart: boolean
  bloomEnabled: boolean
  bloomSeconds: number
  machineIntegration: boolean
}

export interface PourOverPreferences {
  free: ModePreferences
  ratio: ModePreferences
}

/**
 * Load stored per-mode pour-over preferences from the server.
 */
export async function getPourOverPreferences(): Promise<PourOverPreferences> {
  const base = await getServerUrl()
  const res = await fetch(`${base}/api/pour-over/preferences`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).detail ?? `Get preferences failed: ${res.statusText}`)
  }
  return res.json()
}

/**
 * Save per-mode pour-over preferences to the server.
 */
export async function savePourOverPreferences(prefs: PourOverPreferences): Promise<PourOverPreferences> {
  const base = await getServerUrl()
  const res = await fetch(`${base}/api/pour-over/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).detail ?? `Save preferences failed: ${res.statusText}`)
  }
  return res.json()
}
