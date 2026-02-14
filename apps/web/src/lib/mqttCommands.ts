/**
 * MQTT command helpers — thin wrappers around the machine-command
 * REST endpoints that publish to the Mosquitto MQTT broker.
 */
import { getServerUrl } from '@/lib/config'

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function postCommand(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ success: boolean; message?: string }> {
  const base = await getServerUrl()
  const res = await fetch(`${base}/api/machine/command${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { success: false, message: (err as Record<string, string>).detail ?? res.statusText }
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Brewing commands
// ---------------------------------------------------------------------------

/** Start a shot (machine must be idle) */
export const startShot = () => postCommand('/start')

/** Stop a shot gracefully (machine must be brewing) */
export const stopShot = () => postCommand('/stop')

/** Abort a shot immediately (machine must be brewing) */
export const abortShot = () => postCommand('/abort')

/** Continue past a prompt / hold stage */
export const continueShot = () => postCommand('/continue')

// ---------------------------------------------------------------------------
// Machine commands
// ---------------------------------------------------------------------------

/** Start pre-heating (machine must be idle) */
export const preheat = () => postCommand('/preheat')

/** Tare the scale */
export const tareScale = () => postCommand('/tare')

/** Home the plunger */
export const homePlunger = () => postCommand('/home-plunger')

/** Run a purge cycle (machine must be idle) */
export const purge = () => postCommand('/purge')

// ---------------------------------------------------------------------------
// Configuration commands
// ---------------------------------------------------------------------------

/** Load a profile by name */
export const loadProfile = (name: string) =>
  postCommand('/load-profile', { name })

/** Set display brightness (0–100) */
export const setBrightness = (value: number) =>
  postCommand('/brightness', { value })

/** Enable or disable sounds */
export const enableSounds = (enabled: boolean) =>
  postCommand('/sounds', { enabled })
