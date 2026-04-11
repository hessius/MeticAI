/**
 * Machine discovery — find Meticulous espresso machines on the local network.
 *
 * Discovery methods (tried in order):
 *  1. mDNS probe — try meticulous.local:8080 (iOS resolves .local via Bonjour)
 *  2. QR code scan (native only — machine exposes /api/v1/wifi/config/qr.png)
 *  3. Manual IP entry (all platforms)
 *
 * On web/PWA, only manual entry is available unless the browser resolves .local.
 */

import { isNativePlatform } from '@/lib/machineMode'

export interface DiscoveredMachine {
  /** Human-readable name (e.g. "meticulous-a3f7") */
  name: string
  /** Resolved IP or hostname */
  host: string
  /** Port (typically 8080) */
  port: number
  /** Full base URL for API calls */
  url: string
}

// ---------------------------------------------------------------------------
// mDNS / Bonjour discovery
// ---------------------------------------------------------------------------

/** Well-known addresses to probe for a Meticulous machine */
const PROBE_ADDRESSES = [
  'http://meticulous.local:8080',
]

/**
 * Probe a single address to check if a Meticulous machine lives there.
 * Returns a DiscoveredMachine if reachable, null otherwise.
 */
async function probeMachine(baseUrl: string): Promise<DiscoveredMachine | null> {
  try {
    const resp = await fetch(`${baseUrl}/api/v1/profile/list`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    if (!Array.isArray(data)) return null
    const url = new URL(baseUrl)
    return {
      name: url.hostname,
      host: url.hostname,
      port: parseInt(url.port, 10) || 8080,
      url: baseUrl,
    }
  } catch { /* unreachable */ }
  return null
}

/**
 * Browse the local network for Meticulous machines.
 *
 * Probes meticulous.local:8080 which iOS resolves natively via Bonjour
 * (the machine advertises _meticulous._tcp). Returns found machines.
 */
export async function discoverMachines(): Promise<DiscoveredMachine[]> {
  const results = await Promise.all(PROBE_ADDRESSES.map(probeMachine))
  return results.filter((m): m is DiscoveredMachine => m !== null)
}

// ---------------------------------------------------------------------------
// QR code scanning
// ---------------------------------------------------------------------------

/**
 * Scan a QR code to discover a machine's IP address.
 *
 * The machine exposes GET /api/v1/wifi/config/qr.png containing connection
 * info. This method opens the camera, scans the QR, and parses the result.
 *
 * TODO: Integrate a barcode scanner plugin (e.g. @capacitor-mlkit/barcode-scanning
 * or a JS-based decoder with @capacitor/camera capture).
 */
export async function scanMachineQR(): Promise<DiscoveredMachine | null> {
  if (!isNativePlatform()) return null

  // QR scanning placeholder — requires barcode scanner plugin
  console.info('[Discovery] QR scanning not yet implemented')
  return null
}

// ---------------------------------------------------------------------------
// Manual entry helper
// ---------------------------------------------------------------------------

/**
 * Parse a user-entered IP/hostname into a DiscoveredMachine.
 * Accepts: "192.168.1.42", "meticulous-a3f7.local", "http://192.168.1.42:8080"
 */
export function parseMachineInput(input: string): DiscoveredMachine | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // "demo" activates demo mode — no real machine needed
  if (trimmed.toLowerCase() === 'demo') {
    return { name: 'Demo Machine', host: 'demo', port: 0, url: 'demo' }
  }

  try {
    // If it looks like a full URL, parse it
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed)
      const port = url.port ? parseInt(url.port, 10) : 8080
      return {
        name: url.hostname,
        host: url.hostname,
        port,
        url: `${url.protocol}//${url.hostname}:${port}`,
      }
    }

    // Otherwise treat as hostname or IP, possibly with :port
    const [hostPart, portPart] = trimmed.split(':')
    const port = portPart ? parseInt(portPart, 10) : 8080
    return {
      name: hostPart,
      host: hostPart,
      port,
      url: `http://${hostPart}:${port}`,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

/** Ping a machine to verify it's reachable. Demo mode always succeeds. */
export async function testMachineConnection(url: string): Promise<boolean> {
  if (url.toLowerCase() === 'demo') return true
  try {
    const resp = await fetch(`${url}/api/v1/profile/list`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return false
    // Validate response is a JSON array (Meticulous machine signature)
    const data = await resp.json()
    return Array.isArray(data)
  } catch {
    return false
  }
}
