/**
 * Machine discovery — find Meticulous espresso machines on the local network.
 *
 * Discovery methods (tried in order):
 *  1. Zeroconf/Bonjour service browsing (_meticulous._tcp) — iOS via capacitor-zeroconf
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
// Zeroconf mDNS discovery (capacitor-zeroconf plugin)
// ---------------------------------------------------------------------------

let _zeroconfModule: typeof import('capacitor-zeroconf') | null = null

/** Lazy-load capacitor-zeroconf to avoid import errors on web. */
async function getZeroConf() {
  if (!_zeroconfModule) {
    _zeroconfModule = await import('capacitor-zeroconf')
  }
  return _zeroconfModule.ZeroConf
}

// ---------------------------------------------------------------------------
// HTTP probe helpers
// ---------------------------------------------------------------------------

/**
 * Probe a single address to check if a Meticulous machine lives there.
 * Uses CapacitorHttp on native to bypass CORS, regular fetch on web.
 * Verifies via /api/v1/settings — the machine's liveness endpoint.
 */
async function probeMachine(baseUrl: string): Promise<DiscoveredMachine | null> {
  const probeUrl = `${baseUrl}/api/v1/settings`

  try {
    let status: number

    console.info(`[Discovery] Probing machine at ${probeUrl}`)

    if (isNativePlatform()) {
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

    console.info(`[Discovery] Probe ${probeUrl} → status ${status}`)

    // Any 2xx means the machine is responding; 404 also accepted for
    // backward compatibility (old probe endpoint returned 404 when no data)
    if ((status >= 200 && status < 300) || status === 404) {
      const url = new URL(baseUrl)
      return {
        name: url.hostname,
        host: url.hostname,
        port: parseInt(url.port, 10) || 8080,
        url: baseUrl,
      }
    }
  } catch (e) {
    console.warn(`[Discovery] Probe failed for ${probeUrl}:`, e)
  }
  return null
}

// ---------------------------------------------------------------------------
// Network discovery
// ---------------------------------------------------------------------------

/**
 * Browse the local network for Meticulous machines.
 *
 * On iOS (Capacitor), uses the capacitor-zeroconf plugin for real
 * Bonjour/mDNS service discovery of _meticulous._tcp.local.
 *
 * Falls back to hostname probing if the plugin isn't available.
 */
export async function discoverMachines(): Promise<DiscoveredMachine[]> {
  const startTime = Date.now()
  console.info('[Discovery] discoverMachines() started')

  // Step 1: Try Zeroconf mDNS service browsing (native only)
  if (isNativePlatform()) {
    try {
      console.info('[Discovery] Starting Zeroconf browse for _meticulous._tcp...')
      const ZeroConf = await getZeroConf()

      const discovered: DiscoveredMachine[] = []
      let resolveWatch: () => void
      let resolved = false

      const watchDone = new Promise<void>((resolve) => {
        resolveWatch = () => { if (!resolved) { resolved = true; resolve() } }
      })

      // Fire-and-forget: do NOT await watch() — the native plugin only
      // resolves its promise on the first discovery event, so awaiting it
      // would hang indefinitely when no machines are on the network.
      ZeroConf.watch(
        { type: '_meticulous._tcp', domain: 'local.' },
        (result) => {
          // Log every event (including removed) so we can see all network traffic
          const svc = result.service
          console.info(
            `[Discovery] Zeroconf event: action=${result.action} name=${svc?.name} ` +
            `host=${svc?.hostname} ipv4=${JSON.stringify(svc?.ipv4Addresses)} ` +
            `ipv6=${JSON.stringify(svc?.ipv6Addresses)} port=${svc?.port} ` +
            `type=${svc?.type} domain=${svc?.domain} txt=${JSON.stringify(svc?.txtRecord)}`
          )

          if (svc && (result.action === 'added' || result.action === 'resolved')) {
            const host = svc.ipv4Addresses?.[0] || svc.hostname || `${svc.name}.local`
            const port = svc.port || 8080
            const existing = discovered.findIndex(d => d.name === svc.name)
            const machine = {
              name: svc.name,
              host,
              port,
              url: `http://${host}:${port}`,
            }
            if (existing >= 0) {
              discovered[existing] = machine
            } else {
              discovered.push(machine)
            }
            console.info(`[Discovery] Zeroconf matched: ${svc.name} → ${host}:${port}`)

            // On first resolved service, give 2s more for additional services then finish
            if (result.action === 'resolved' && discovered.length === 1) {
              setTimeout(() => resolveWatch(), 2000)
            }
          }
        },
      ).catch((e: unknown) => {
        console.warn('[Discovery] Zeroconf watch() rejected:', e)
        resolveWatch()
      })

      // Browse for up to 10s — mDNS resolution can take several seconds per service
      const timer = setTimeout(() => {
        console.info(`[Discovery] Zeroconf browse timed out after 10s`)
        resolveWatch()
      }, 10000)
      await watchDone
      clearTimeout(timer)

      try {
        await ZeroConf.unwatch({ type: '_meticulous._tcp', domain: 'local.' })
        await ZeroConf.close()
      } catch {
        // cleanup errors are non-fatal
      }

      if (discovered.length > 0) {
        console.info(
          `[Discovery] Zeroconf found ${discovered.length} machine(s) in ${Date.now() - startTime}ms:`,
          discovered.map((m) => m.name).join(', '),
        )
        return discovered
      }

      console.info(`[Discovery] Zeroconf browse found no machines after ${Date.now() - startTime}ms, falling back to hostname probe`)
    } catch (e) {
      console.warn('[Discovery] Zeroconf plugin not available, falling back to hostname probe:', e)
    }
  }

  // Step 2: Fallback — probe known hostnames in parallel.
  // The machine hostname is randomized (e.g. meticulous-a3f7.local) but
  // some installations use the default "meticulous.local".
  console.info('[Discovery] Probing known hostnames...')
  const probeUrls = [
    'http://meticulous.local:8080',
    'http://meticulous-home.local:8080',
  ]

  const results = await Promise.all(probeUrls.map(probeMachine))
  const seen = new Set<string>()
  const machines = results.filter((m): m is DiscoveredMachine => {
    if (!m || seen.has(m.url)) return false
    seen.add(m.url)
    return true
  })

  console.info(`[Discovery] discoverMachines() finished in ${Date.now() - startTime}ms — found ${machines.length} machine(s)`)
  return machines
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
  const probeUrl = `${url}/api/v1/settings`
  console.info(`[Discovery] Testing connection to ${probeUrl}`)
  try {
    let status: number

    if (isNativePlatform()) {
      const resp = await CapacitorHttp.get({
        url: probeUrl,
        connectTimeout: 5000,
        readTimeout: 5000,
      })
      status = resp.status
    } else {
      const resp = await fetch(probeUrl, {
        signal: AbortSignal.timeout(5000),
      })
      status = resp.status
    }

    const ok = (status >= 200 && status < 300) || status === 404
    console.info(`[Discovery] Connection test ${probeUrl} → status ${status}, ok=${ok}`)
    return ok
  } catch (e) {
    console.warn(`[Discovery] Connection test failed for ${probeUrl}:`, e)
    return false
  }
}
