/**
 * Machine shot-history read family (unified, native semantics).
 *
 * These GET routes translate the espresso machine's shot log (via the shared
 * visible-history loader, so local soft-deletes apply) into the MeticAI shapes
 * the frontend consumes. This is a straight port of the direct-mode oracle
 * (apps/web/src/services/interceptor/DirectModeInterceptor.ts), kept at parity
 * with the server (apps/server/api/routes/shots.py).
 *
 * Routes:
 *   GET /api/last-shot                        -> most-recent normalized shot
 *   GET /api/shots/dates                      -> distinct shot dates (desc)
 *   GET /api/shots/recent/by-profile          -> shots grouped by profile
 *   GET /api/shots/recent                     -> flat recent-shot list
 *   GET /api/shots/by-profile/{profile_name}  -> shots for one profile (paged)
 *   GET /api/shots/data/{date}/{filename}     -> full telemetry for one shot
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import {
  type MachineHistoryEntry,
  historyEntryDate,
  historyEntryFilename,
  historyMetrics,
  historyProfileId,
  historyProfileName,
  hasRecentShotAnnotation,
  normalizeLastShot,
} from "../logic/machineHistory";
import { loadVisibleHistory } from "../logic/historyStore";
import { getAnnotationSummaries } from "./annotations";

/** A telemetry sample as stored on a machine history entry. */
interface ShotSample {
  status?: string;
  time?: number;
  profile_time?: number;
  shot?: {
    pressure?: number;
    flow?: number;
    weight?: number;
    gravimetric_flow?: number;
  };
  sensors?: { external_1?: number };
}

interface ShotDataEntry extends MachineHistoryEntry {
  profile?: {
    name?: string;
    id?: string;
    final_weight?: number;
    temperature?: number;
    author?: string;
    stages?: Array<{ name: string; type: string; key?: string }>;
  } & Record<string, unknown>;
  data?: ShotSample[];
}

function safePositiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const BY_PROFILE_RE = /^\/api\/shots\/by-profile\/(.+)$/;
const DATA_RE = /^\/api\/shots\/data\/([^/]+)\/(.+)$/;

export async function handleShotsReadRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const url = new URL(req.url);
  const { pathname } = url;

  // GET /api/last-shot -> most-recent normalized shot.
  if (pathname === "/api/last-shot") {
    try {
      const { entries } = await loadVisibleHistory(platform);
      const entry = [...entries].sort((a, b) => b.time - a.time)[0];
      if (!entry) return jsonResponse({ detail: "No shots found" }, 404);
      return jsonResponse(normalizeLastShot(entry));
    } catch {
      return jsonResponse({ detail: "No shots found" }, 404);
    }
  }

  // GET /api/shots/dates -> distinct dates, newest first.
  if (pathname === "/api/shots/dates") {
    try {
      const { entries } = await loadVisibleHistory(platform);
      const dates = [...new Set(entries.map(historyEntryDate))].sort((a, b) => b.localeCompare(a));
      return jsonResponse({ dates });
    } catch {
      return jsonResponse({ dates: [] });
    }
  }

  // GET /api/shots/recent/by-profile -> shots grouped by profile.
  if (pathname === "/api/shots/recent/by-profile") {
    try {
      const { entries } = await loadVisibleHistory(platform);
      const annotations = await getAnnotationSummaries(platform);
      const groups = new Map<
        string,
        { profile_name: string; profile_id: string; shots: unknown[]; shot_count: number }
      >();
      for (const e of entries) {
        const pName = historyProfileName(e);
        const pId = historyProfileId(e);
        const shotDate = historyEntryDate(e);
        const shotFilename = historyEntryFilename(e);
        const metrics = historyMetrics(e);
        const annotation = annotations[`${shotDate}/${shotFilename}`];
        const shot = {
          profile_name: pName,
          profile_id: pId,
          date: shotDate,
          filename: shotFilename,
          timestamp: e.time,
          final_weight: metrics.final_weight,
          total_time: metrics.total_time,
          has_annotation: hasRecentShotAnnotation(annotation),
        };
        if (!groups.has(pName)) {
          groups.set(pName, { profile_name: pName, profile_id: pId, shots: [], shot_count: 0 });
        }
        const g = groups.get(pName)!;
        g.shots.push(shot);
        g.shot_count++;
      }
      return jsonResponse({ profiles: Array.from(groups.values()) });
    } catch {
      return jsonResponse({ profiles: [] });
    }
  }

  // GET /api/shots/recent -> flat recent-shot list.
  if (pathname === "/api/shots/recent") {
    try {
      const { entries } = await loadVisibleHistory(platform);
      const annotations = await getAnnotationSummaries(platform);
      const shots = entries.map((e) => {
        const shotDate = historyEntryDate(e);
        const shotFilename = historyEntryFilename(e);
        const metrics = historyMetrics(e);
        const annotation = annotations[`${shotDate}/${shotFilename}`];
        return {
          profile_name: historyProfileName(e),
          profile_id: historyProfileId(e),
          date: shotDate,
          filename: shotFilename,
          timestamp: e.time,
          final_weight: metrics.final_weight,
          total_time: metrics.total_time,
          has_annotation: hasRecentShotAnnotation(annotation),
        };
      });
      return jsonResponse({ shots });
    } catch {
      return jsonResponse({ shots: [] });
    }
  }

  // GET /api/shots/by-profile/{profile_name} -> shots for one profile (paged).
  const byProfileMatch = pathname.match(BY_PROFILE_RE);
  if (byProfileMatch) {
    const profileName = decodeURIComponent(byProfileMatch[1]!);
    const limit = safePositiveInt(url.searchParams.get("limit"), 20);
    try {
      const { entries } = await loadVisibleHistory(platform);
      const filtered = entries
        .filter((e) => historyProfileName(e) === profileName)
        .sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
      const shots = filtered.slice(0, limit).map((e) => {
        const metrics = historyMetrics(e);
        return {
          date: historyEntryDate(e),
          filename: historyEntryFilename(e),
          timestamp: String(e.time),
          profile_name: historyProfileName(e),
          final_weight: metrics.final_weight,
          total_time: metrics.total_time,
        };
      });
      return jsonResponse({ profile_name: profileName, shots, count: shots.length, limit });
    } catch {
      return jsonResponse({ profile_name: profileName, shots: [], count: 0, limit });
    }
  }

  // GET /api/shots/data/{date}/{filename} -> full telemetry for one shot.
  const dataMatch = pathname.match(DATA_RE);
  if (dataMatch) {
    const shotDate = decodeURIComponent(dataMatch[1]!);
    const shotFilename = decodeURIComponent(dataMatch[2]!);
    try {
      const { entries } = await loadVisibleHistory(platform);
      const entry = entries.find(
        (e) => historyEntryDate(e) === shotDate && historyEntryFilename(e) === shotFilename,
      ) as ShotDataEntry | undefined;
      if (!entry) return jsonResponse({ detail: "Shot not found" }, 404);

      const points = entry.data ?? [];
      const timeArr: number[] = [];
      const pressureArr: number[] = [];
      const flowArr: number[] = [];
      const weightArr: number[] = [];
      const gravFlowArr: number[] = [];
      const temperatureArr: number[] = [];
      const statusArr: string[] = [];
      for (const pt of points) {
        const status = String(pt.status ?? "");
        // During retraction, profile_time freezes -- use wall-clock time instead.
        const isRetracting = status.toLowerCase() === "retracting";
        const timeMs = isRetracting
          ? pt.time ?? pt.profile_time ?? 0
          : pt.profile_time ?? pt.time ?? 0;
        timeArr.push(timeMs / 1000);
        pressureArr.push(pt.shot?.pressure ?? 0);
        flowArr.push(pt.shot?.flow ?? 0);
        weightArr.push(pt.shot?.weight ?? 0);
        gravFlowArr.push(pt.shot?.gravimetric_flow ?? 0);
        temperatureArr.push(pt.sensors?.external_1 ?? 0);
        statusArr.push(status);
      }
      const lastPt = points[points.length - 1];
      const shotData = {
        date: shotDate,
        filename: shotFilename,
        data: {
          profile: {
            name: entry.profile?.name ?? entry.name ?? "Unknown",
            author: entry.profile?.author,
            temperature: entry.profile?.temperature,
            final_weight: entry.profile?.final_weight,
            stages: entry.profile?.stages?.map((s) => ({ name: s.name, type: s.type, key: s.key })),
          },
          start_time: new Date(entry.time * 1000).toISOString(),
          elapsed_time: lastPt ? (lastPt.time ?? lastPt.profile_time ?? 0) / 1000 : 0,
          final_weight: lastPt?.shot?.weight ?? entry.profile?.final_weight ?? null,
          data: {
            time: timeArr,
            pressure: pressureArr,
            flow: flowArr,
            weight: weightArr,
            gravimetric_flow: gravFlowArr,
            temperature: temperatureArr,
            status: statusArr,
          },
        },
      };
      return jsonResponse(shotData);
    } catch {
      return jsonResponse({ detail: "Failed to load shot data" }, 500);
    }
  }

  return null;
}
