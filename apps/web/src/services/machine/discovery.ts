/**
 * Machine discovery — find Meticulous espresso machines on the local network.
 *
 * Discovery methods (tried in order):
 *  1. Probe known Meticulous hostnames/IPs via HTTP
 *  2. QR code scan (native only — future)
 *  3. Manual IP entry (all platforms)
 *
 * The machine advertises _meticulous._tcp on the local network.
 * On iOS, mDNS resolution happens natively so we can probe hostnames.
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
// Network discovery
// ---------------------------------------------------------------------------

/**
 * Probe a single address to check if a Meticulous machine lives there.
 * Verifies via /api/getLastShotProfileJSON — the same endpoint used by
 * the backend's machine_discovery_service.py verify_machine().
 * A 200 or 404 means the Meticulous API is responding.
 */
async function probeMachine(baseUrl: string): Promise<DiscoveredMachine | null> {
  try {
    const resp = await fetch(`${baseUrl}/api/getLastShotProfileJSON`, {
      signal: AbortSignal.timeout(3000),
    })
    // 200 = has data, 404 = API responding but no shot yet — both valid
    if (resp.status === 200 || resp.status === 404) {
      const url = new URL(baseUrl)
      return {
        name: url.hostname,
        host: url.hostname,
        port: parseInt(url.port, 10) || 8080,
        url: baseUrl,
      }
    }
  } catch { /* unreachable */ }
  return null
}

/**
 * Browse the local network for Meticulous machines.
 *
 * Probes known Meticulous hostnames that iOS resolves natively via
 * Bonjour (the machine advertises _meticulous._tcp).
 * The backend uses the same approach: mDNS → hostname → env fallback.
 *
 * Unlike the Python backend which has zeroconf, the WebView can't do
 * raw mDNS service browsing. Instead we probe common hostnames that
 * the OS mDNS resolver handles transparently.
 */
export async function discoverMachines(): Promise<DiscoveredMachine[]> {
  // Probe common Meticulous hostnames in parallel.
  // The machine's mDNS hostname varies (e.g. meticulous-XXXX.local)
  // but most resolve as "meticulous.local" or the hostname set by the user.
  const probeUrls = [
    'http://meticulous.local:8080',
  ]

  // On native, also try the .local variant without subdomain
  if (isNativePlatform()) {
    probeUrls.push('http://meticulous:8080')
  }

  const results = await Promise.all(probeUrls.map(probeMachine))
  // Deduplicate by URL
  const seen = new Set<string>()
  return results.filter((m): m is DiscoveredMachine => {
    if (!m || seen.has(m.url)) return false
    seen.add(m.url)
    return true
  })
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

/**
 * Ping a machine to verify it's reachable. Uses the same endpoint as
 * the backend's verify_machine() — /api/getLastShotProfileJSON.
 * Demo mode always succeeds.
 */
export async function testMachineConnection(url: string): Promise<boolean> {
  if (url.toLowerCase() === 'demo') return true
  try {
    const resp = await fetch(`${url}/api/getLastShotProfileJSON`, {
      signal: AbortSignal.timeout(5000),
    })
    // 200 = has shot data, 404 = API responding but no shot — both valid
    return resp.status === 200 || resp.status === 404
  } catch {
    return false
  }
}
