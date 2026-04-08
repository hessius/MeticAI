/**
 * Machine discovery — find Meticulous espresso machines on the local network.
 *
 * Discovery methods (tried in order):
 *  1. mDNS/Bonjour browse for _meticulous._tcp (native only)
 *  2. QR code scan (native only — machine exposes /api/v1/wifi/config/qr.png)
 *  3. Manual IP entry (all platforms)
 *
 * On web/PWA, only manual entry is available. mDNS and QR require native
 * Capacitor plugins that are not yet installed — this module provides the
 * interface and graceful web fallbacks.
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

/**
 * Browse the local network for Meticulous machines via mDNS.
 *
 * Requires a native Capacitor plugin for Bonjour browsing.
 * Returns an empty array on web where mDNS is not available.
 *
 * TODO: Integrate a Bonjour/mDNS Capacitor plugin when available.
 * Candidates: custom native Swift plugin using NWBrowser (iOS 13+).
 */
export async function discoverMachines(): Promise<DiscoveredMachine[]> {
  if (!isNativePlatform()) return []

  // Native mDNS discovery placeholder — requires Capacitor plugin
  // The machine advertises _meticulous._tcp on the local network.
  // NWBrowser (iOS) or NsdManager (Android) can browse for this service.
  console.info('[Discovery] mDNS discovery not yet implemented — use manual IP or QR')
  return []
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

/** Ping a machine to verify it's reachable */
export async function testMachineConnection(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/api/v1/system/info`, {
      signal: AbortSignal.timeout(5000),
    })
    return resp.ok
  } catch {
    return false
  }
}
