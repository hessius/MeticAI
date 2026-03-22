/**
 * Machine mode detection — determines whether the frontend should
 * communicate via the MeticAI backend (proxy) or directly with the
 * Meticulous machine (direct).
 *
 * Selection priority:
 *  1. Build-time: VITE_MACHINE_MODE env var ('direct' | 'proxy')
 *  2. Runtime: port 8080 → direct (served from machine), else proxy
 */

export type MachineMode = 'direct' | 'proxy'

export function getMachineMode(): MachineMode {
  // Build-time override
  const envMode = import.meta.env.VITE_MACHINE_MODE
  if (envMode === 'direct' || envMode === 'proxy') return envMode

  // Runtime detection: if we're on port 8080 we're likely served from the machine
  if (typeof window !== 'undefined' && window.location.port === '8080') {
    return 'direct'
  }

  return 'proxy'
}

export function getDefaultMachineUrl(): string {
  const envUrl = import.meta.env.VITE_DEFAULT_MACHINE_URL
  if (envUrl) return envUrl

  // When served from the machine, use same origin
  if (typeof window !== 'undefined' && window.location.port === '8080') {
    return `${window.location.protocol}//${window.location.host}`
  }

  // Fallback for proxy mode — user needs to configure their machine URL
  return 'http://meticulous.local:8080'
}

export function isDirectMode(): boolean {
  return getMachineMode() === 'direct'
}
