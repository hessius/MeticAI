/**
 * Machine discovery — find Meticulous espresso machines on the local network.
 *
 * Discovery methods (tried in order):
 *  1. Native mDNS/Bonjour service browsing (_meticulous._tcp) — iOS only
 *  2. HTTP probe of known hostnames (meticulous.local)
 *  3. Manual IP/hostname entry (all platforms)
 *
 * The machine advertises _meticulous._tcp on the local network.
 * Its hostname is randomized but always contains "meticulous"
 * (e.g. meticulous-a3f7.local).
 *
 * On native (Capacitor), CapacitorHttp is used for HTTP probes to
 * bypass WKWebView CORS restrictions.
 */

import { CapacitorHttp } from '@capacitor/core'
import { registerPlugin } from '@capacitor/core'
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
// Native mDNS discovery plugin (iOS — registered in MeticulousViewController)
// ---------------------------------------------------------------------------

interface MeticulousDiscoveryPlugin {
  browse(options?: { timeout?: number }): Promise<{
    machines: Array<{ name: string; host: string; type: string; domain: string }>
    error?: string
  }>
}

const MeticulousDiscovery = registerPlugin<MeticulousDiscoveryPlugin>('MeticulousDiscovery')

// ---------------------------------------------------------------------------
// HTTP probe helpers
// ---------------------------------------------------------------------------

/**
 * Probe a single address to check if a Meticulous machine lives there.
 * Uses CapacitorHttp on native to bypass CORS, regular fetch on web.
 * Verifies via /api/getLastShotProfileJSON — same as backend's verify_machine().
 */
async function probeMachine(baseUrl: string): Promise<DiscoveredMachine | null> {
  const probeUrl = `${baseUrl}/api/getLastShotProfileJSON`

  try {
    let status: number

    if (isNativePlatform()) {
      // Native HTTP bypasses CORS
      const resp = await CapacitorHttp.get({
        url: probeUrl,
        connectTimeout: 4000,
        readTimeout: 4000,
      })
      status = resp.status
    } else {
      const resp = await fetch(probeUrl, {
        signal: AbortSignal.timeout(4000),
      })
      status = resp.status
    }

    // 200 = has data, 404 = API responding but no shot yet — both valid
    if (status === 200 || status === 404) {
      const url = new URL(baseUrl)
      return {
        name: url.hostname,
        host: url.hostname,
        port: parseInt(url.port, 10) || 8080,
        url: baseUrl,
      }
    }
  } catch {
    // Network error or timeout — machine not there
  }
  return null
}

// ---------------------------------------------------------------------------
// Network discovery
// ---------------------------------------------------------------------------

/**
 * Browse the local network for Meticulous machines.
 *
 * On iOS (Capacitor), uses a native NWBrowser plugin to do real mDNS
 * service discovery for _meticulous._tcp.local. — matching the backend's
 * zeroconf-based discovery in machine_discovery_service.py.
 *
 * Falls back to hostname probing if the native plugin isn't available.
 */
export async function discoverMachines(): Promise<DiscoveredMachine[]> {
  // Step 1: Try native mDNS service browsing (iOS)
  if (isNativePlatform()) {
    try {
      console.info('[Discovery] Starting native mDNS browse for _meticulous._tcp...')
      const result = await MeticulousDiscovery.browse({ timeout: 5 })

      if (result.error) {
        console.warn('[Discovery] mDNS browse error (local network permission may be denied):', result.error)
      }

      if (result.machines.length > 0) {
        console.info(`[Discovery] mDNS found ${result.machines.length} machine(s):`,
          result.machines.map(m => m.name).join(', '))

        // Probe each discovered host to verify it's responsive
        const probes = result.machines.map(async (m) => {
          const machine = await probeMachine(`http://${m.host}:8080`)
          if (machine) {
            machine.name = m.name // Use the friendly mDNS service name
          }
          return machine
        })

        const results = await Promise.all(probes)
        const verified = results.filter((m): m is DiscoveredMachine => m !== null)
        if (verified.length > 0) return verified
      }

      if (result.error) {
        console.warn('[Discovery] mDNS browse error:', result.error)
      }
    } catch (e) {
      console.warn('[Discovery] Native mDNS plugin not available, falling back to hostname probe:', e)
    }
  }

  // Step 2: Fallback — probe known hostnames
  console.info('[Discovery] Probing known hostnames...')
  const probeUrls = ['http://meticulous.local:8080']

  const results = await Promise.all(probeUrls.map(probeMachine))
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
 * TODO: Integrate a barcode scanner plugin (e.g. @capacitor-mlkit/barcode-scanning
 * or a JS-based decoder with @capacitor/camera capture).
 */
export async function scanMachineQR(): Promise<DiscoveredMachine | null> {
  if (!isNativePlatform()) return null

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
 * Test if a machine is reachable at the given URL. Uses CapacitorHttp on
 * native to bypass CORS. Same verification as backend's verify_machine().
 * Demo mode always succeeds.
 */
export async function testMachineConnection(url: string): Promise<boolean> {
  if (url.toLowerCase() === 'demo') return true
  try {
    const probeUrl = `${url}/api/getLastShotProfileJSON`

    if (isNativePlatform()) {
      const resp = await CapacitorHttp.get({
        url: probeUrl,
        connectTimeout: 5000,
        readTimeout: 5000,
      })
      return resp.status === 200 || resp.status === 404
    }

    const resp = await fetch(probeUrl, {
      signal: AbortSignal.timeout(5000),
    })
    return resp.status === 200 || resp.status === 404
  } catch {
    return false
  }
}
