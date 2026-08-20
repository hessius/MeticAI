/**
 * Machine auto-detection — server-side discovery of a Meticulous espresso
 * machine on the local network. Powers `POST /api/machine/detect`.
 *
 * Strategy (first hit wins):
 *   1. Configured machine URL — verify it answers at /api/v1/settings.
 *   2. Subnet scan — via the optional `platform.netScan` capability, probe the
 *      host's own /24 for a machine (server hosts only; native runs its own
 *      client-side discovery in apps/web/src/services/machine/discovery.ts).
 *
 * Note: the machine's mDNS/hostname is randomized (always starts with
 * "Meticulous", e.g. Meticulous-a3f7.local), so fixed-hostname resolution is
 * unreliable and intentionally not attempted here — the subnet scan is the
 * robust network-level fallback.
 */

import type { Platform, PlatformNetScan } from "../platform";

export interface DetectResult {
  found: boolean;
  ip?: string;
  hostname?: string;
  method?: "configured" | "scan";
  verified?: boolean;
  guidance_key?: string;
  guidance_hints?: string[];
}

/** The machine API port. Current firmware serves the API on 8080. */
const MACHINE_PORT = 8080;
/** Per-host probe timeout during a subnet scan (ms). */
const PROBE_TIMEOUT_MS = 800;
/** Verify timeout for the already-configured machine (ms). */
const CONFIGURED_TIMEOUT_MS = 4000;
/** Concurrent probes during a subnet scan. */
const SCAN_CONCURRENCY = 32;

/** A 2xx — or a legacy 404 — means the machine API answered. */
function isReachableStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 404;
}

function hostFromBase(base: string): string | null {
  try {
    const host = new URL(base).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/** RFC 1918 private IPv4 ranges (plus none else — public/link-local excluded). */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Scan the /24 that `localIp` belongs to for a reachable machine, skipping the
 * network/broadcast addresses and the scanner's own address. Returns the first
 * responding host's IP, or null.
 */
async function scanSubnet(localIp: string, netScan: PlatformNetScan): Promise<string | null> {
  const parts = localIp.split(".");
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const self = Number(parts[3]);

  const targets: string[] = [];
  for (let host = 1; host <= 254; host++) {
    if (host === self) continue;
    targets.push(`${prefix}.${host}`);
  }

  let found: string | null = null;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < targets.length && found === null) {
      const ip = targets[cursor++];
      const status = await netScan.probe(
        `http://${ip}:${MACHINE_PORT}/api/v1/settings`,
        PROBE_TIMEOUT_MS,
      );
      if (status !== null && isReachableStatus(status) && found === null) {
        found = ip;
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return found;
}

/** Detect a Meticulous machine on the local network (server-side). */
export async function detectMachine(platform: Platform): Promise<DetectResult> {
  // 1. Verify the already-configured machine URL.
  const host = hostFromBase(platform.machine.getBaseUrl());
  if (host) {
    try {
      const resp = await platform.machine.fetch("/api/v1/settings", {
        signal: AbortSignal.timeout(CONFIGURED_TIMEOUT_MS),
      });
      if (isReachableStatus(resp.status)) {
        return { found: true, ip: host, hostname: host, method: "configured", verified: true };
      }
    } catch {
      // Not reachable — fall through to a subnet scan.
    }
  }

  // 2. Subnet scan (server hosts only).
  const netScan = platform.netScan;
  if (netScan) {
    const locals = netScan.localIPv4s().filter(isPrivateIPv4);
    for (const localIp of locals) {
      const hit = await scanSubnet(localIp, netScan);
      if (hit) {
        return { found: true, ip: hit, hostname: hit, method: "scan", verified: true };
      }
    }
  }

  return {
    found: false,
    guidance_key: "notFound",
    guidance_hints: ["checkPower", "checkNetwork", "enterManually"],
  };
}
