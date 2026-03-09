/**
 * MeticAIAdapter — default MachineService implementation.
 *
 * Delegates all machine commands to the MeticAI backend REST API endpoints,
 * which in turn publish MQTT messages to the Mosquitto broker.
 */

import type { MachineService, CommandResult } from './MachineService'
import { getServerUrl } from '@/lib/config'

// ---------------------------------------------------------------------------
// Internal Helper
// ---------------------------------------------------------------------------

async function postCommand(
  path: string,
  body?: Record<string, unknown>,
): Promise<CommandResult> {
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
  const data = await res.json()
  // Backend returns { success, status, command }; normalise to { success, message }
  return { success: data.success ?? data.status === 'ok', message: data.message }
}

// ---------------------------------------------------------------------------
// Adapter Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a MachineService instance that communicates via the MeticAI backend.
 */
export function createMeticAIAdapter(): MachineService {
  return {
    name: 'MeticAIAdapter',

    // Brewing commands
    startShot: () => postCommand('/start'),
    stopShot: () => postCommand('/stop'),
    abortShot: () => postCommand('/abort'),
    continueShot: () => postCommand('/continue'),

    // Machine commands
    preheat: () => postCommand('/preheat'),
    tareScale: () => postCommand('/tare'),
    homePlunger: () => postCommand('/home-plunger'),
    purge: () => postCommand('/purge'),

    // Configuration commands
    loadProfile: (name: string) => postCommand('/load-profile', { name }),
    setBrightness: (value: number) => postCommand('/brightness', { value }),
    enableSounds: (enabled: boolean) => postCommand('/sounds', { enabled }),
  }
}

// Default singleton instance
export const meticAIAdapter = createMeticAIAdapter()
