/**
 * Machine command + status route family (unified, native semantics).
 *
 * Actuation and status routes that the frontend calls on the espresso machine.
 * Straight port of the direct-mode oracle
 * (apps/web/src/services/interceptor/DirectModeInterceptor.ts), kept at parity
 * with the server (apps/server/api/routes/commands.py + system.py).
 *
 * Routes:
 *   POST /api/machine/command/start         -> GET /api/v1/action/start
 *   POST /api/machine/command/stop          -> GET /api/v1/action/stop
 *   POST /api/machine/command/load-profile  -> resolve name -> GET load/{id}
 *   POST /api/machine/preheat               -> GET /api/v1/action/preheat
 *   GET  /api/machine/status/health         -> watcher /status (port 3000)
 *   GET  /api/machine/system-info           -> firmware/network/hostname
 *   GET  /api/machine/status                -> synthetic idle status
 *   GET  /api/machine/detect                -> 501 (not applicable)
 *   POST /api/machine/schedule-shot         -> 501 (no scheduler)
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import { transformWatcherResponse, watcherStatusUrl } from "../logic/watcher";

interface MachineProfileListEntry {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadMachineProfiles(platform: Platform): Promise<MachineProfileListEntry[]> {
  const res = await platform.machine.fetch("/api/v1/profile/list");
  if (!res.ok) return [];
  const raw: unknown = await res.json();
  if (Array.isArray(raw)) return raw as MachineProfileListEntry[];
  if (isRecord(raw) && Array.isArray(raw.profiles)) return raw.profiles as MachineProfileListEntry[];
  return [];
}

async function actionOk(platform: Platform, path: string): Promise<boolean> {
  try {
    const res = await platform.machine.fetch(path);
    return res.ok;
  } catch {
    return false;
  }
}

export async function handleMachineCommandRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const method = req.method;

  // POST /api/machine/command/start
  if (pathname === "/api/machine/command/start" && method === "POST") {
    const ok = await actionOk(platform, "/api/v1/action/start");
    return jsonResponse({ success: ok }, ok ? 200 : 502);
  }

  // POST /api/machine/command/stop
  if (pathname === "/api/machine/command/stop" && method === "POST") {
    const ok = await actionOk(platform, "/api/v1/action/stop");
    return jsonResponse({ success: ok }, ok ? 200 : 502);
  }

  // POST /api/machine/command/load-profile
  if (pathname === "/api/machine/command/load-profile" && method === "POST") {
    try {
      const body = (await req.json().catch(() => ({}))) as { name?: string };
      if (!body.name) {
        return jsonResponse({ success: false, message: "No profile name" }, 400);
      }
      const profiles = await loadMachineProfiles(platform);
      const match = profiles.find((p) => p.name === body.name);
      if (!match?.id) {
        return jsonResponse({ success: false, message: "Profile not found" }, 404);
      }
      const ok = await actionOk(platform, `/api/v1/profile/load/${match.id}`);
      return jsonResponse({ success: ok }, ok ? 200 : 502);
    } catch {
      return jsonResponse({ success: false }, 502);
    }
  }

  // POST /api/machine/preheat
  if (pathname === "/api/machine/preheat" && method === "POST") {
    const ok = await actionOk(platform, "/api/v1/action/preheat");
    return ok
      ? jsonResponse({ status: "success", message: "Preheat started" })
      : jsonResponse({ status: "error", detail: "Preheat failed" }, 502);
  }

  // POST /api/machine/schedule-shot -> not supported without a scheduler
  if (pathname === "/api/machine/schedule-shot" && method === "POST") {
    return jsonResponse(
      {
        status: "error",
        detail:
          "Scheduled shots are not supported in direct mode. Use the machine UI or MeticAI Docker mode.",
      },
      501,
    );
  }

  // GET /api/machine/detect -> not applicable
  if (pathname === "/api/machine/detect" && method === "GET") {
    return jsonResponse({ detail: "Machine detection not available in direct mode" }, 501);
  }

  // GET /api/machine/status/health -> watcher service (port 3000)
  if (pathname === "/api/machine/status/health" && method === "GET") {
    const fallback = { error: "Watcher service unavailable", services: [], system: null };
    try {
      const watcherUrl = watcherStatusUrl(platform.machine.getBaseUrl());
      if (!watcherUrl) return jsonResponse(fallback);
      const resp = await platform.machine.fetch(watcherUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return jsonResponse(fallback);
      const data = (await resp.json()) as Record<string, unknown>;
      return jsonResponse(transformWatcherResponse(data));
    } catch {
      return jsonResponse(fallback);
    }
  }

  // GET /api/machine/system-info -> aggregate firmware/network/hostname
  if (pathname === "/api/machine/system-info" && method === "GET") {
    const info: Record<string, unknown> = {};
    const endpoints: Array<[string, string]> = [
      ["firmware", "/api/v1/system/firmware"],
      ["network", "/api/v1/wifi/status"],
      ["hostname", "/api/v1/wifi/hostname"],
    ];
    for (const [key, path] of endpoints) {
      try {
        const resp = await platform.machine.fetch(path);
        info[key] = resp.ok ? await resp.json() : null;
      } catch {
        info[key] = null;
      }
    }
    return jsonResponse(info);
  }

  // GET /api/machine/status -> synthetic (live state comes over the telemetry socket)
  if (pathname === "/api/machine/status" && method === "GET") {
    return jsonResponse({ machine_status: { state: "idle" }, scheduled_shots: [] });
  }

  return null;
}
