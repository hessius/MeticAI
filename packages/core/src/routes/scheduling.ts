/**
 * Machine scheduling routes (recurring schedules + one-off scheduled shots).
 *
 * The unified server does not yet run a background shot-firing scheduler:
 * auto-firing espresso shots requires time-based on-device verification and is
 * scoped to a later phase. Reads return empty result sets so the scheduling UI
 * loads cleanly (no console errors, no core notFound leak), while mutations
 * return an honest 501 rather than silently failing to fire, which would be a
 * real-world hazard. This mirrors the native runtime, where scheduled shots are
 * explicitly unsupported (DirectModeInterceptor returns 501 for schedule-shot).
 *
 * Routes:
 *   GET    /api/machine/recurring-schedules
 *   POST   /api/machine/recurring-schedules
 *   PUT    /api/machine/recurring-schedules/{id}
 *   DELETE /api/machine/recurring-schedules/{id}
 *   GET    /api/machine/scheduled-shots
 *   DELETE /api/machine/schedule-shot/{id}
 *
 * (POST /api/machine/schedule-shot is owned by the machine-commands family.)
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";

const UNSUPPORTED_MESSAGE =
  "Scheduled shots are not yet available on this server. Use the machine UI to schedule shots.";

function unsupported(): Response {
  return jsonResponse({ status: "error", detail: UNSUPPORTED_MESSAGE }, 501);
}

export async function handleSchedulingRoutes(
  req: Request,
  _platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const method = req.method;

  if (pathname === "/api/machine/recurring-schedules") {
    if (method === "GET") {
      return jsonResponse({ status: "success", recurring_schedules: [] });
    }
    if (method === "POST") return unsupported();
  }

  const recurringByIdMatch = pathname.match(/^\/api\/machine\/recurring-schedules\/([^/]+)$/);
  if (recurringByIdMatch && (method === "PUT" || method === "DELETE")) {
    return unsupported();
  }

  if (pathname === "/api/machine/scheduled-shots" && method === "GET") {
    return jsonResponse({ status: "success", scheduled_shots: [] });
  }

  const scheduleShotByIdMatch = pathname.match(/^\/api\/machine\/schedule-shot\/([^/]+)$/);
  if (scheduleShotByIdMatch && method === "DELETE") {
    return unsupported();
  }

  return null;
}
