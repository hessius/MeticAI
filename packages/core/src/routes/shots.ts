/**
 * Shot-analysis route family.
 *
 * Analyze a completed shot against its profile. This is a port of the two
 * existing implementations kept at parity:
 *   - server: apps/server/api/routes/shots.py (analyze / analyze-llm /
 *     analyze-recommendations)
 *   - native: apps/web/src/services/interceptor/DirectModeInterceptor.ts
 *
 * Shot telemetry and profiles are read from the machine through
 * `platform.machine.fetch`; AI analysis goes through `platform.ai`. The
 * structured local analysis, prompt building and recommendation parsing all
 * reuse the shared pure modules in @metic/core so both runtimes behave
 * identically.
 *
 * Routes (also served under the bare `/shots/...` alias):
 *   POST /api/shots/analyze                  -> { status, analysis } | { status:'error', message }
 *   POST /api/shots/analyze-llm              -> { status, llm_analysis, cached } | { status:'error', message }
 *   POST /api/shots/analyze-recommendations  -> { status, recommendations, ... } | 404 { detail }
 */

import type { Platform, Cache } from "../platform";
import { jsonResponse } from "../http";
import { computeRichLocalAnalysis, type HistEntry } from "../logic/shotAnalysis";
import { buildShotFacts } from "../logic/shotFacts";
import { buildTasteContext } from "../ai/prompts";
import { buildAnalyzeLlmPrompt } from "./analyzeLlmPrompt";
import { needsCompactPrompt } from "../ai/contextWindow";
import {
  lintShotAnalysis,
  validateAgainstFacts,
  checkStructure,
  repairShotAnalysis,
} from "../logic/analysisLint";
import {
  parseRecommendationsJson,
  isRecommendationPatchable,
} from "../logic/recommendationsParse";

interface ProfileListEntry {
  id?: string;
  name?: string;
  variables?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mirror of the native getHistoryEntryDate: seconds epoch -> YYYY-MM-DD. */
function historyEntryDate(entry: HistEntry): string {
  return new Date(entry.time * 1000).toISOString().split("T")[0];
}

/** Mirror of the native getHistoryEntryFilename: file field or `${id}.json`. */
function historyEntryFilename(entry: HistEntry): string {
  return entry.file ?? `${entry.id}.json`;
}

/** Fetch the full shot history (telemetry + embedded profile) from the machine. */
async function loadHistory(platform: Platform): Promise<HistEntry[]> {
  const response = await platform.machine.fetch("/api/v1/history");
  if (!response.ok) return [];
  const raw: unknown = await response.json();
  if (Array.isArray(raw)) return raw as HistEntry[];
  if (isRecord(raw) && Array.isArray(raw.history)) return raw.history as HistEntry[];
  return [];
}

/** Find a shot by its date (YYYY-MM-DD) and filename, matching the native lookup. */
async function findShot(
  platform: Platform,
  date: string,
  filename: string,
): Promise<HistEntry | null> {
  const history = await loadHistory(platform);
  return (
    history.find(
      (entry) =>
        historyEntryDate(entry) === date && historyEntryFilename(entry) === filename,
    ) ?? null
  );
}

/** Fetch the profile list from the machine (includes variables, no stages). */
async function loadProfileList(platform: Platform): Promise<ProfileListEntry[]> {
  const response = await platform.machine.fetch("/api/v1/profile/list");
  if (!response.ok) return [];
  const raw: unknown = await response.json();
  if (Array.isArray(raw)) return raw as ProfileListEntry[];
  if (isRecord(raw) && Array.isArray(raw.profiles)) return raw.profiles as ProfileListEntry[];
  return [];
}

function analysisCacheKey(profileName: string, shotFilename: string): string {
  return `analysis:${profileName}::${shotFilename}`;
}

async function readCachedAnalysis(
  cache: Cache,
  profileName: string,
  shotFilename: string,
): Promise<string | null> {
  const hit = await cache.get<string>(analysisCacheKey(profileName, shotFilename));
  return typeof hit === "string" ? hit : null;
}

export async function handleShotAnalysisRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const normalized = pathname.startsWith("/api/") ? pathname.slice(4) : pathname;
  if (req.method !== "POST") return null;

  // POST /api/shots/analyze -> structured local analysis.
  if (normalized === "/shots/analyze") {
    try {
      const form = await req.formData();
      const profileName = String(form.get("profile_name") ?? "") || "Unknown";
      const shotDate = String(form.get("shot_date") ?? "");
      const shotFilename = String(form.get("shot_filename") ?? "");

      const entry = await findShot(platform, shotDate, shotFilename);
      if (!entry) return jsonResponse({ status: "error", message: "Shot not found" });

      const analysis = computeRichLocalAnalysis(entry, profileName);
      return jsonResponse({ status: "success", analysis });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      return jsonResponse({ status: "error", message });
    }
  }

  // POST /api/shots/analyze-llm -> full AI analysis over the shot data.
  if (normalized === "/shots/analyze-llm") {
    try {
      if (!platform.ai.isConfigured()) {
        return jsonResponse({ status: "error", message: "AI provider is not configured" });
      }
      const form = await req.formData();
      const profileName = String(form.get("profile_name") ?? "") || "Unknown";
      const shotDate = String(form.get("shot_date") ?? "");
      const shotFilename = String(form.get("shot_filename") ?? "");
      const profileDescription = String(form.get("profile_description") ?? "");

      const entry = await findShot(platform, shotDate, shotFilename);
      if (!entry) return jsonResponse({ status: "error", message: "Shot not found" });
      if (!(entry.data ?? []).length) {
        return jsonResponse({ status: "error", message: "Shot has no telemetry data" });
      }

      const richAnalysis = computeRichLocalAnalysis(entry, profileName);

      const shotProfile = entry.profile;
      const profileStages = shotProfile?.stages ?? [];
      const profileVars = shotProfile?.variables ?? [];
      const cleanStages = profileStages.map((s) => ({
        name: s.name,
        type: s.type,
        key: s.key,
        dynamics_points: s.dynamics_points,
        dynamics_over: s.dynamics_over,
        exit_triggers: s.exit_triggers,
        limits: s.limits,
      }));

      const tasteXRaw = form.get("taste_x");
      const tasteYRaw = form.get("taste_y");
      const tasteX = tasteXRaw != null ? Number(tasteXRaw) : null;
      const tasteY = tasteYRaw != null ? Number(tasteYRaw) : null;
      const tasteDescriptors = String(form.get("taste_descriptors") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const tasteContext =
        tasteX != null && tasteY != null
          ? buildTasteContext(tasteX, tasteY, tasteDescriptors)
          : "";

      const facts = buildShotFacts(richAnalysis as Parameters<typeof buildShotFacts>[0]);
      const prompt = buildAnalyzeLlmPrompt({
        profileName,
        temperature: shotProfile?.temperature ?? null,
        targetWeight: shotProfile?.final_weight ?? null,
        profileDescription,
        profileVars,
        cleanStages,
        facts,
        tasteContext,
        compact: needsCompactPrompt(platform.ai),
      });

      const generate = async (): Promise<string> => {
        const result = await platform.ai.generateText({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        return result.text ?? "";
      };

      const isValid = (text: string): boolean =>
        lintShotAnalysis(text).valid &&
        validateAgainstFacts(text, facts).valid &&
        checkStructure(text).valid;

      let analysisText = await generate();
      if (!isValid(analysisText)) {
        const retry = await generate();
        if (isValid(retry)) analysisText = retry;
      }
      if (!lintShotAnalysis(analysisText).valid) {
        analysisText = repairShotAnalysis(analysisText);
      }

      await platform.storage.aiCache.set(
        analysisCacheKey(profileName, shotFilename),
        analysisText,
      );

      return jsonResponse({ status: "success", llm_analysis: analysisText, cached: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      return jsonResponse({ status: "error", message });
    }
  }

  // POST /api/shots/analyze-recommendations -> parse RECOMMENDATIONS_JSON locally.
  if (normalized === "/shots/analyze-recommendations") {
    try {
      const form = await req.formData();
      const profileName = String(form.get("profile_name") ?? "");
      const shotFilename = String(form.get("shot_filename") ?? "");
      const analysisText =
        String(form.get("analysis") ?? "") ||
        (await readCachedAnalysis(platform.storage.aiCache, profileName, shotFilename)) ||
        "";
      if (!analysisText) {
        return jsonResponse(
          {
            detail: {
              status: "no_analysis",
              message: "No cached analysis found. Run a full analysis first.",
            },
          },
          404,
        );
      }

      const profiles = await loadProfileList(platform);
      const profile = profiles.find(
        (p) => String(p.name ?? "").toLowerCase() === profileName.toLowerCase(),
      );
      const variables = profile?.variables ?? [];

      const recommendations = parseRecommendationsJson(analysisText).map((recommendation) => ({
        ...recommendation,
        is_patchable: isRecommendationPatchable(recommendation, variables),
      }));

      return jsonResponse({
        status: "success",
        profile_name: profileName,
        recommendations,
        total: recommendations.length,
        patchable_count: recommendations.filter((r) => r.is_patchable).length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to extract recommendations";
      return jsonResponse({ detail: message }, 500);
    }
  }

  return null;
}
