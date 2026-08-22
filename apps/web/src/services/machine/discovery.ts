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
import { persistMachineUrl } from './machineUrl'

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
 * Resolve the machine URL to a currently-reachable base, self-healing when the
 * stored URL has gone stale (e.g. a firmware update moved the API from :8080 to
 * :80, or DHCP reassigned the machine a new IP). Order:
 *
 *  1. Probe the stored URL's port candidates (:8080 → :80). If one answers,
 *     adopt it — persisting when the port changed so the fix sticks.
 *  2. If nothing answers at the stored host, re-run discovery (mDNS + subnet
 *     scan on native) to find the machine's current address; adopt + persist it.
 *  3. If discovery finds nothing, keep the stored URL so a later retry recovers
 *     once the machine comes back online.
 *
 * This is the live-connection counterpart to the onboarding/settings detect
 * paths, and mirrors the server runtime's lazy self-heal in platform/node.ts.
 */
export async function resolveAndHealMachineUrl(stored: string): Promise<string> {
  if (stored.toLowerCase() === 'demo') return 'demo'

  const reachable = await resolveReachableMachineUrl(stored)
  if (reachable) {
    if (reachable !== stored) {
      dlog(`Healed machine URL: ${stored} → ${reachable}`)
      await persistMachineUrl(reachable)
    }
    return reachable
  }

  // Stored host/port is dead — rediscover the machine on the network.
  dlog(`Stored URL ${stored} unreachable; attempting rediscovery`)
  const found = await discoverMachines()
  const candidate = found[0]?.url
  if (candidate) {
    const healed = (await resolveReachableMachineUrl(candidate)) ?? candidate
    dlog(`Rediscovered machine at ${healed}`)
    await persistMachineUrl(healed)
    return healed
  }

  return stored
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
// Subnet-scan fallback (native)
//
// mDNS is the primary discovery path, but it fails when the machine service
// isn't resolved to an IPv4 (Android can't reach a randomized `.local` host) or
// when mDNS is unavailable entirely. As a fallback we derive the device's own
// LAN IPv4 via a WebRTC host ICE candidate, then probe that /24 for a machine.
// CapacitorHttp bypasses the WebView CORS restriction that blocks a browser
// from doing the same, so this runs on native only.
// ---------------------------------------------------------------------------

const SCAN_PORT = 8080
const SCAN_TIMEOUT_MS = 800
const SCAN_CONCURRENCY = 24

/** True for a dotted-quad IPv4 literal (not a hostname / `.local` name). */
function isIPv4Literal(host: string): boolean {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)
}

/** True for an RFC 1918 private IPv4 address. */
export function isPrivateIPv4(ip: string): boolean {
  if (!isIPv4Literal(ip)) return false
  const [a, b] = ip.split('.').map(Number)
  if ([a, b].some((n) => n < 0 || n > 255)) return false
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/**
 * Extract the first IPv4 address from a WebRTC ICE candidate line, but only for
 * `typ host` candidates (the device's own LAN address). Returns null for
 * server-reflexive candidates or mDNS-obfuscated (`.local`) candidates, which
 * carry no usable LAN IPv4.
 */
export function parseIPv4FromCandidate(candidate: string): string | null {
  if (!candidate || !candidate.includes('typ host')) return null
  const match = candidate.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/)
  return match ? match[1] : null
}

/**
 * Discover the device's own LAN IPv4 via a WebRTC host ICE candidate. Resolves
 * null when WebRTC is unavailable, times out, or only yields obfuscated
 * (`.local`) candidates (browser privacy hardening).
 */
export async function getLocalIPv4ViaWebRTC(timeoutMs = 2000): Promise<string | null> {
  const RTC = (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection
  if (typeof RTC !== 'function') return null

  return new Promise<string | null>((resolve) => {
    let settled = false
    let pc: RTCPeerConnection | null = null
    const finish = (ip: string | null) => {
      if (settled) return
      settled = true
      try {
        if (pc) {
          pc.onicecandidate = null
          pc.close()
        }
      } catch { /* ignore */ }
      resolve(ip)
    }

    try {
      pc = new (RTC as new (config?: RTCConfiguration) => RTCPeerConnection)({ iceServers: [] })
    } catch {
      finish(null)
      return
    }

    const timer = setTimeout(() => finish(null), timeoutMs)
    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      const cand = event.candidate?.candidate
      if (!cand) return
      const ip = parseIPv4FromCandidate(cand)
      if (ip && isPrivateIPv4(ip)) {
        clearTimeout(timer)
        finish(ip)
      }
    }

    try {
      pc.createDataChannel('discovery')
      pc.createOffer()
        .then((offer) => pc!.setLocalDescription(offer))
        .catch(() => finish(null))
    } catch {
      finish(null)
    }
  })
}

/**
 * Probe every host in the /24 that `localIp` belongs to for a Meticulous
 * machine, skipping the device's own address. Returns the first reachable
 * machine, or null. Uses {@link fetchStatus} (CapacitorHttp on native).
 */
export async function scanLocalSubnet(localIp: string): Promise<DiscoveredMachine | null> {
  if (!isPrivateIPv4(localIp)) return null
  const octets = localIp.split('.')
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`
  const self = Number(octets[3])

  const targets: string[] = []
  for (let host = 1; host <= 254; host++) {
    if (host === self) continue
    targets.push(`${prefix}.${host}`)
  }

  let found: DiscoveredMachine | null = null
  let cursor = 0
  const worker = async () => {
    while (cursor < targets.length && found === null) {
      const ip = targets[cursor++]
      const status = await fetchStatus(`http://${ip}:${SCAN_PORT}/api/v1/settings`, SCAN_TIMEOUT_MS)
      if (status !== null && isReachableStatus(status) && found === null) {
        found = { name: ip, host: ip, port: SCAN_PORT, url: `http://${ip}:${SCAN_PORT}` }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, () => worker()),
  )
  return found
}

/** WebRTC-derived device IP -> /24 subnet scan. Native fallback for mDNS. */
async function nativeSubnetScan(): Promise<DiscoveredMachine | null> {
  const localIp = await getLocalIPv4ViaWebRTC()
  if (!localIp) {
    dlog('SUBNET SCAN: no local IPv4 available (WebRTC unavailable or obfuscated)')
    return null
  }
  dlog(`SUBNET SCAN: local IPv4 ${localIp} → scanning /24 for a machine...`)
  const machine = await scanLocalSubnet(localIp)
  dlog(machine ? `SUBNET SCAN: found machine at ${machine.host}` : 'SUBNET SCAN: no machine found')
  return machine
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
            // Prefer a real (private) IPv4 — Android's HTTP resolver cannot
            // reach a randomized `.local` mDNS hostname, so a `.local`-only
            // sighting is not yet a usable machine. iOS/Bonjour can resolve
            // `.local`, so we still keep it as a lower-priority fallback.
            const ipv4 = svc.ipv4Addresses?.find(isPrivateIPv4) || svc.ipv4Addresses?.[0]
            const host = ipv4 || svc.hostname || `${svc.name}.local`
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
              // Never downgrade a resolved IPv4 host back to a `.local` name.
              if (ipv4 || !isIPv4Literal(discovered[existing].host)) {
                discovered[existing] = machine
              }
            } else {
              discovered.push(machine)
            }
            dlog(`Matched machine: ${svc.name} → ${host}:${port}${ipv4 ? '' : ' (no IPv4 yet)'}`)
            // Only settle early once we have a reachable IPv4 for a single hit;
            // otherwise keep waiting for the `resolved` event that carries it.
            if (ipv4 && discovered.filter(d => isIPv4Literal(d.host)).length === 1) {
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

    // Prefer machines resolved to a real IPv4 — those are reachable on every
    // platform (a randomized `.local` host is not reachable on Android).
    const withIp = discovered.filter(m => isIPv4Literal(m.host))
    if (withIp.length > 0) {
      dlog(`DONE: found ${withIp.length} IPv4 machine(s): ${withIp.map(m => m.host).join(', ')}`)
      return withIp
    }

    // Only `.local` (or nothing) from mDNS: try a subnet scan to obtain a
    // reachable IP (fixes Android, where `.local` can't be resolved).
    const scanned = await nativeSubnetScan()
    if (scanned) {
      dlog(`DONE: subnet scan found machine at ${scanned.host}`)
      return [scanned]
    }

    // Fall back to any `.local` sighting (works on iOS/Bonjour).
    if (discovered.length > 0) {
      dlog(`DONE: returning ${discovered.length} .local machine(s): ${discovered.map(m => m.name).join(', ')}`)
      return discovered
    }

    dlog('No machines found via Zeroconf or subnet scan, falling back to hostname probe')
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
