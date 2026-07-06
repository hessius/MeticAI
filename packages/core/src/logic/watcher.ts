/**
 * Watcher-service response transform (pure, host-free).
 *
 * The espresso machine runs a watcher service on port 3000 whose `/status`
 * payload is reshaped into what the MeticAI status view expects. Ported
 * verbatim from apps/web/src/services/interceptor/DirectModeInterceptor.ts to
 * keep both runtimes byte-identical.
 */

export function parseSizeToMB(sizeStr: string): number {
  const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();
  if (unit === "TB") return value * 1024 * 1024;
  if (unit === "GB") return value * 1024;
  if (unit === "KB") return value / 1024;
  return value;
}

export function parseUptimeToSeconds(uptimeStr: string): number {
  let total = 0;
  const re = /(\d+)\s*(days?|hours?|minutes?|seconds?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(uptimeStr)) !== null) {
    const val = parseInt(m[1]!, 10);
    const unit = m[2]!.toLowerCase();
    if (unit.startsWith("day")) total += val * 86400;
    else if (unit.startsWith("hour")) total += val * 3600;
    else if (unit.startsWith("minute")) total += val * 60;
    else total += val;
  }
  return total;
}

/**
 * Coerce a per-service uptime (string like "0 hours 41 minutes" or numeric
 * seconds) into integer seconds, or null when unavailable.
 */
export function coerceServiceUptime(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) return parseUptimeToSeconds(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  return null;
}

/** Transform a raw watcher `/status` response into the status-view shape. */
export function transformWatcherResponse(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const rawServices = raw.services;
  let services: { name: string; status: string; uptime: number | null }[] = [];
  if (rawServices && typeof rawServices === "object" && !Array.isArray(rawServices)) {
    services = Object.entries(
      rawServices as Record<string, { status?: string; uptime?: string | number }>,
    ).map(([name, info]) => ({
      name,
      status: info?.status ?? "unknown",
      uptime: coerceServiceUptime(info?.uptime),
    }));
  } else if (Array.isArray(rawServices)) {
    services = rawServices as typeof services;
  }

  const mem = raw.memoryUsage as Record<string, string> | undefined;
  const discs = raw.discs as
    | Array<{ mountpoint: string; usage: Record<string, string> }>
    | undefined;
  const uptimeStr = typeof raw.uptime === "string" ? raw.uptime : "";

  const memTotal = mem ? parseSizeToMB(mem.total ?? "") : 0;
  const memUsed = mem ? parseSizeToMB(mem.used ?? "") : 0;

  let diskTotal = 0;
  let diskUsed = 0;
  if (Array.isArray(discs)) {
    const rootDisc = discs.find((d) => d.mountpoint === "/");
    if (rootDisc?.usage) {
      diskTotal = parseSizeToMB(rootDisc.usage.total ?? "") / 1024; // GB
      diskUsed = parseSizeToMB(rootDisc.usage.used ?? "") / 1024;
    }
  }

  const uptimeSecs = uptimeStr ? parseUptimeToSeconds(uptimeStr) : null;
  let system: Record<string, unknown> | null = null;
  if (memTotal || diskTotal || uptimeSecs) {
    system = {
      memory_total: memTotal ? Math.round(memTotal) : null,
      memory_used: memUsed ? Math.round(memUsed) : null,
      disk_total: diskTotal ? Math.round(diskTotal * 100) / 100 : null,
      disk_used: diskUsed ? Math.round(diskUsed * 100) / 100 : null,
      cpu_temperature: null,
      uptime: uptimeSecs,
    };
  }

  return { services, system };
}

/** Derive the watcher `/status` URL (port 3000) from the machine base URL. */
export function watcherStatusUrl(machineBaseUrl: string): string | null {
  try {
    const parsed = new URL(machineBaseUrl);
    parsed.port = "3000";
    return `${parsed.origin}/status`;
  } catch {
    return null;
  }
}
