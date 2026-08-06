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
// Discovery event log — shared with UI for on-screen debugging
// ---------------------------------------------------------------------------

type DiscoveryLogListener = (entry: string) => void
const _logListeners: DiscoveryLogListener[] = []

/** Subscribe to real-time discovery log entries (for on-screen debug panel). */
export function onDiscoveryLog(listener: DiscoveryLogListener): () => void {
  _logListeners.push(listener)
  return () => {
    const idx = _logListeners.indexOf(listener)
    if (idx >= 0) _logListeners.splice(idx, 1)
  }
}

function dlog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23)
  const entry = `[${ts}] ${msg}`
  // Use console.log (not console.error): these are diagnostics, and on the
  // Android WebView console.error is bridged/heavier, adding main-thread jank.
  console.log(`[Discovery] ${entry}`)
  _logListeners.forEach(fn => { try { fn(entry) } catch { /* ignore */ } })
}

// ---------------------------------------------------------------------------
// Zeroconf mDNS discovery (capacitor-zeroconf plugin)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HTTP probe helpers
// ---------------------------------------------------------------------------

/** A 2xx (or legacy 404) response means the machine API answered. */
function isReachableStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 404
}

/**
 * GET a URL and return its HTTP status, or null on a network/timeout error.
 * Uses CapacitorHttp on native to bypass CORS, regular fetch on web.
 */
async function fetchStatus(probeUrl: string, timeoutMs: number): Promise<number | null> {
  try {
    if (isNativePlatform()) {
      const resp = await CapacitorHttp.get({
        url: probeUrl,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      })
      return resp.status
    }
    const resp = await fetch(probeUrl, { signal: AbortSignal.timeout(timeoutMs) })
    return resp.status
  } catch {
    return null
  }
}

/**
 * Build the ordered list of base URLs to try for a machine, most-likely first.
 *
 * Firmware quirk: current firmware exposes the machine API on port 8080 (and
 * also proxies it on port 80 via nginx), so we default to 8080. Older /
 * downgraded firmware serves the API ONLY on the default HTTP port (80). When a
 * URL assumes an explicit non-default HTTP port, we therefore add a port-80
 * (no explicit port) fallback so those machines remain reachable.
 */
export function machineUrlCandidates(rawUrl: string): string[] {
  const candidates: string[] = []
  const push = (u: string) => {
    const trimmed = u.replace(/\/+$/, '')
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed)
  }
  push(rawUrl)
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'http:' && url.port && url.port !== '80') {
      url.port = ''
      push(url.toString())
    }
  } catch {
    // Not a parseable URL — only the raw value is a candidate.
  }
  return candidates
}

/**
 * Resolve the first reachable base URL for a machine, trying the given port and
 * then a port-80 fallback (see {@link machineUrlCandidates}). Returns the base
 * URL that actually answered so callers persist the WORKING url (with the
 * correct port), or null if none responded. Demo mode always resolves to 'demo'.
 */
export async function resolveReachableMachineUrl(url: string): Promise<string | null> {
  if (url.toLowerCase() === 'demo') return 'demo'
  for (const candidate of machineUrlCandidates(url)) {
    const status = await fetchStatus(`${candidate}/api/v1/settings`, 5000)
    if (status !== null) {
      console.info(`[Discovery] Probe ${candidate}/api/v1/settings → status ${status}`)
      if (isReachableStatus(status)) return candidate
    }
  }
  return null
}

/**
 * Probe a single address to check if a Meticulous machine lives there.
 * Uses CapacitorHttp on native to bypass CORS, regular fetch on web.
 * Verifies via /api/v1/settings — the machine's liveness endpoint.
 */
async function probeMachine(baseUrl: string): Promise<DiscoveredMachine | null> {
  const reachable = await resolveReachableMachineUrl(baseUrl)
  if (!reachable || reachable === 'demo') return null
  const url = new URL(reachable)
  return {
    name: url.hostname,
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 80,
    url: reachable,
  }
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
  dlog('STEP 0: discoverMachines() called')

  // Step 1: Try Zeroconf mDNS service browsing (native only)
  if (isNativePlatform()) {
    dlog('STEP 1: isNativePlatform=true, attempting Zeroconf')

    // The capacitor-zeroconf web stub creates a module-level rejected promise
    // on import, so it is loaded lazily here (native branch only) to keep that
    // floating rejection out of the web bundle and test environment.
    const { ZeroConf } = await import('capacitor-zeroconf')

    // Step 2: Smoke-test plugin with getHostname()
    try {
      dlog('STEP 2: calling getHostname() smoke test...')
      const hostnameResult = await Promise.race([
        ZeroConf.getHostname(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getHostname timeout 5s')), 5000)),
      ])
      dlog(`STEP 2: getHostname() OK: ${JSON.stringify(hostnameResult)}`)
    } catch (e) {
      dlog(`STEP 2: getHostname() FAILED: ${e} — plugin may not be registered natively`)
    }

    // Step 3: Set up discovery state
    const discovered: DiscoveredMachine[] = []
    let resolveWatch!: () => void
    let resolved = false
    const watchDone = new Promise<void>((resolve) => {
      resolveWatch = () => { if (!resolved) { resolved = true; resolve() } }
    })
    dlog('STEP 3: discovery state ready')

    // Step 5: Start main _meticulous._tcp browse.
    //
    // IMPORTANT (Android): the capacitor-zeroconf JmDNS backend only registers
    // a browser on the FIRST watch() call (ZeroConf.java guards on
    // `browserManager == null`). Any second concurrent watch() — e.g. a
    // diagnostic `_http._tcp` browse — is silently ignored, so the real
    // `_meticulous._tcp` browse would never start and auto-detection would
    // always fail. We therefore watch ONLY `_meticulous._tcp`. Browsing a
    // single low-traffic service type also avoids flooding the WebView main
    // thread with a callback per LAN HTTP service (which caused input focus
    // difficulty and typing freezes during onboarding).
    try {
      dlog('STEP 5: starting _meticulous._tcp browse...')
      ZeroConf.watch(
        { type: '_meticulous._tcp', domain: 'local.' },
        (result) => {
          const svc = result?.service
          dlog(`Zeroconf event: action=${result?.action} name=${svc?.name} host=${svc?.hostname} ipv4=${JSON.stringify(svc?.ipv4Addresses)} ipv6=${JSON.stringify(svc?.ipv6Addresses)} port=${svc?.port} type=${svc?.type} domain=${svc?.domain} txt=${JSON.stringify(svc?.txtRecord)}`)

          if (svc && (result.action === 'added' || result.action === 'resolved')) {
            const host = svc.ipv4Addresses?.[0] || svc.hostname || `${svc.name}.local`
            // Use mDNS port; the machine's nginx proxies port 80 to the API on 8080
            const port = svc.port > 0 ? svc.port : 8080
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
            dlog(`Matched machine: ${svc.name} → ${host}:${port}`)
            if (result.action === 'resolved' && discovered.length === 1) {
              setTimeout(() => resolveWatch(), 2000)
            }
          }
        },
      ).then(() => {
        dlog('STEP 5: _meticulous._tcp watch() promise resolved')
      }).catch((e: unknown) => {
        dlog(`STEP 5: _meticulous._tcp watch() REJECTED: ${e}`)
        resolveWatch()
      })
      dlog('STEP 5: _meticulous._tcp watch() call returned (fire-and-forget)')
    } catch (e) {
      dlog(`STEP 5: _meticulous._tcp watch() THREW: ${e}`)
      resolveWatch()
    }

    // Step 6: Set timeout and wait
    dlog('STEP 6: setting 10s timeout, awaiting watchDone...')
    const timer = setTimeout(() => {
      dlog('STEP 6: timeout fired after 10s')
      resolveWatch()
    }, 10000)
    await watchDone
    clearTimeout(timer)
    dlog(`STEP 7: watchDone resolved, discovered=${discovered.length} machines in ${Date.now() - startTime}ms`)

    // Step 8: Cleanup (fire-and-forget — DO NOT await; unwatch/close can hang)
    ZeroConf.unwatch({ type: '_meticulous._tcp', domain: 'local.' }).catch(() => {})
    ZeroConf.close().catch(() => {})
    dlog('STEP 8: cleanup dispatched (non-blocking)')

    if (discovered.length > 0) {
      dlog(`DONE: found ${discovered.length} machine(s): ${discovered.map(m => m.name).join(', ')}`)
      return discovered
    }

    dlog('No machines found via Zeroconf, falling back to hostname probe')
  } else {
    dlog('STEP 1: isNativePlatform=false, skipping Zeroconf')
  }

  // Step 10: Fallback — probe known hostnames
  dlog('STEP 10: probing known hostnames...')
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

  dlog(`DONE: probes finished in ${Date.now() - startTime}ms — found ${machines.length} machine(s)`)
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
 * Test if a machine is reachable at the given URL. Tries the given port and a
 * port-80 fallback (older firmware serves the API on port 80 only). Uses
 * CapacitorHttp on native to bypass CORS. Same verification as the server's
 * machine proxy. Demo mode always succeeds.
 *
 * Prefer {@link resolveReachableMachineUrl} when you need the working URL to
 * persist; this boolean wrapper is kept for callers that only need liveness.
 */
export async function testMachineConnection(url: string): Promise<boolean> {
  return (await resolveReachableMachineUrl(url)) !== null
}
