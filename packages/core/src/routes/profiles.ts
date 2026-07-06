/**
 * Profile recommendation route family.
 *
 * Deterministic (no AI) structural recommendations over the machine's profile
 * catalogue. Port of the two existing implementations kept at parity:
 *   - server: apps/server/api/routes/profiles.py (+ profile_recommendation_service.py)
 *   - native: apps/web/src/services/interceptor/DirectModeInterceptor.ts
 *
 * Scoring is shared via @metic/core's profileRecommendation module (itself a
 * port of the Python recommendation service). Profiles are read from the
 * machine with `?full=true` so stages are included for structural scoring,
 * matching the server's canonical behavior in a single request.
 *
 * Routes (also served under the bare `/profiles/...` alias):
 *   POST /api/profiles/recommend      -> { status, recommendations, count }
 *   POST /api/profiles/find-similar   -> { status, recommendations, count }
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import {
  getRecommendations,
  findSimilarProfiles,
  type Recommendation,
} from "../logic/profileRecommendation";
import type { AnalyzableProfile } from "../logic/profileAnalysis";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Fetch the full profile catalogue (with stages) from the machine. */
async function loadFullProfiles(platform: Platform): Promise<AnalyzableProfile[]> {
  const response = await platform.machine.fetch("/api/v1/profile/list?full=true");
  if (!response.ok) return [];
  const raw: unknown = await response.json();
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.profiles)
      ? raw.profiles
      : [];
  return list as AnalyzableProfile[];
}

function recommendationResponse(recommendations: Recommendation[]): Response {
  return jsonResponse({
    status: "success",
    recommendations,
    count: recommendations.length,
  });
}

export async function handleProfileRecommendationRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const normalized = pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
  if (req.method !== "POST") return null;

  if (normalized === "/profiles/recommend") {
    try {
      const form = await req.formData();
      const tags = form.getAll("tags").map((t) => String(t)).filter(Boolean);
      const limit = Math.max(1, toNumber(form.get("limit"), 5));
      const profiles = await loadFullProfiles(platform);
      return recommendationResponse(getRecommendations(tags, profiles, limit));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get recommendations";
      return jsonResponse({ detail: message }, 500);
    }
  }

  if (normalized === "/profiles/find-similar") {
    try {
      const form = await req.formData();
      const profileName = String(form.get("profile_name") ?? "");
      const limit = Math.max(1, toNumber(form.get("limit"), 10));
      const profiles = await loadFullProfiles(platform);
      const source = profiles.find((p) => (p.name ?? "") === profileName);
      const recommendations = source
        ? findSimilarProfiles(source, profiles, limit)
        : [];
      return recommendationResponse(recommendations);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to find similar profiles";
      return jsonResponse({ detail: message }, 500);
    }
  }

  return null;
}
