/**
 * Pour-over preferences route family.
 *
 * Per-mode (free / ratio / recipe) pour-over UI preferences persisted so they
 * survive reloads and sync across devices. Straight port of the two existing
 * implementations kept at parity:
 *   - server: apps/server/services/pour_over_preferences.py (+ pour_over.py)
 *   - native: apps/web/src/services/interceptor/directModeStorage.ts
 *             (+ dispatch in DirectModeInterceptor.ts)
 *
 * Persistence goes through `platform.storage.pourOverPrefs` (a singleton Repo).
 * Validation mirrors the native runtime, which is strict (wrong types throw)
 * and defaults ratio mode to dose 18g / ratio 15 (a pre-existing, deliberate
 * divergence from the Python nulls that this unification adopts, since the
 * native/browser runtime is the target the frontend already relies on).
 *
 * Routes:
 *   GET /api/pour-over/preferences -> stored preferences (defaults if unset)
 *   PUT /api/pour-over/preferences -> normalize + persist, returns normalized
 */

import type { Platform, Repo } from "../platform";
import { jsonResponse } from "../http";
import { adaptPourOverProfile, adaptRecipeToProfile } from "../logic/pourOverAdapter";
import { POUR_OVER_RECIPES } from "../data/recipes";

export interface ModePreferences {
  autoStart: boolean;
  bloomEnabled: boolean;
  bloomSeconds: number;
  bloomWeightMultiplier: number;
  machineIntegration: boolean;
  doseGrams: number | null;
  brewRatio: number | null;
}

export interface RecipeModePreferences {
  machineIntegration: boolean;
  autoStart: boolean;
  progressionMode: "weight" | "time";
}

export interface PourOverPreferences {
  free: ModePreferences;
  ratio: ModePreferences;
  recipe: RecipeModePreferences;
}

/** Thrown for malformed preferences; mapped to HTTP 400. */
export class PourOverValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PourOverValidationError";
  }
}

const MODE_DEFAULTS: ModePreferences = {
  autoStart: true,
  bloomEnabled: true,
  bloomSeconds: 30,
  bloomWeightMultiplier: 2,
  machineIntegration: false,
  doseGrams: null,
  brewRatio: null,
};

const RECIPE_DEFAULTS: RecipeModePreferences = {
  machineIntegration: false,
  autoStart: true,
  progressionMode: "weight",
};

function createDefaultPreferences(): PourOverPreferences {
  return {
    free: { ...MODE_DEFAULTS },
    ratio: { ...MODE_DEFAULTS, doseGrams: 18, brewRatio: 15 },
    recipe: { ...RECIPE_DEFAULTS },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PourOverValidationError(`${label} must be an object`);
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new PourOverValidationError(`${key} must be a boolean`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PourOverValidationError(`${key} must be a finite number`);
  }
  return value;
}

function readNullableNumber(record: Record<string, unknown>, key: string, fallback: number | null): number | null {
  const value = record[key];
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PourOverValidationError(`${key} must be a finite number or null`);
  }
  return value;
}

function normalizeModePreferences(value: unknown, defaults: ModePreferences, label: string): ModePreferences {
  const record = requireRecord(value === undefined ? {} : value, label);
  return {
    autoStart: readBoolean(record, "autoStart", defaults.autoStart),
    bloomEnabled: readBoolean(record, "bloomEnabled", defaults.bloomEnabled),
    bloomSeconds: readNumber(record, "bloomSeconds", defaults.bloomSeconds),
    bloomWeightMultiplier: readNumber(record, "bloomWeightMultiplier", defaults.bloomWeightMultiplier),
    machineIntegration: readBoolean(record, "machineIntegration", defaults.machineIntegration),
    doseGrams: readNullableNumber(record, "doseGrams", defaults.doseGrams),
    brewRatio: readNullableNumber(record, "brewRatio", defaults.brewRatio),
  };
}

function normalizeRecipePreferences(value: unknown): RecipeModePreferences {
  const record = requireRecord(value === undefined ? {} : value, "recipe");
  const progressionMode = record.progressionMode ?? RECIPE_DEFAULTS.progressionMode;
  if (progressionMode !== "weight" && progressionMode !== "time") {
    throw new PourOverValidationError("progressionMode must be weight or time");
  }
  return {
    machineIntegration: readBoolean(record, "machineIntegration", RECIPE_DEFAULTS.machineIntegration),
    autoStart: readBoolean(record, "autoStart", RECIPE_DEFAULTS.autoStart),
    progressionMode,
  };
}

export function normalizePourOverPreferences(value: unknown): PourOverPreferences {
  const defaults = createDefaultPreferences();
  if (value === undefined || value === null) return defaults;
  const record = requireRecord(value, "pour-over preferences");
  return {
    free: normalizeModePreferences(record.free, defaults.free, "free"),
    ratio: normalizeModePreferences(record.ratio, defaults.ratio, "ratio"),
    recipe: normalizeRecipePreferences(record.recipe),
  };
}

const PREFS_KEY = "preferences";

function prefsRepo(platform: Platform): Repo<PourOverPreferences> {
  return platform.storage.pourOverPrefs as Repo<PourOverPreferences>;
}

export async function getPreferences(platform: Platform): Promise<PourOverPreferences> {
  const stored = await prefsRepo(platform).read(PREFS_KEY);
  return normalizePourOverPreferences(stored ?? undefined);
}

export async function savePreferences(platform: Platform, value: unknown): Promise<PourOverPreferences> {
  const normalized = normalizePourOverPreferences(value);
  await prefsRepo(platform).write(PREFS_KEY, normalized);
  return normalized;
}

/**
 * Route dispatcher. Returns a Response for a pour-over preferences route, or
 * `null` if the request is not one (so the main handler can try other families).
 */
export async function handlePourOverRoutes(req: Request, platform: Platform): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/pour-over/preferences") {
    if (req.method === "GET") {
      try {
        return jsonResponse(await getPreferences(platform));
      } catch (err) {
        const message = err instanceof PourOverValidationError ? err.message : "Failed to load pour-over preferences";
        return jsonResponse({ detail: message }, 500);
      }
    }

    if (req.method === "PUT") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ detail: "Invalid preferences" }, 400);
      }
      try {
        return jsonResponse(await savePreferences(platform, body));
      } catch (err) {
        if (err instanceof PourOverValidationError) {
          return jsonResponse({ detail: "Invalid preferences" }, 400);
        }
        return jsonResponse({ detail: "Failed to save preferences" }, 500);
      }
    }

    return null;
  }

  // POST /api/pour-over/prepare -> build an adapted ratio/bloom profile and load it on the machine.
  if (pathname === "/api/pour-over/prepare" && req.method === "POST") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        target_weight?: number;
        bloom_enabled?: boolean;
        bloom_seconds?: number;
        dose_grams?: number | null;
        brew_ratio?: number | null;
      };
      const profile = adaptPourOverProfile({
        targetWeight: body.target_weight ?? 300,
        bloomEnabled: body.bloom_enabled ?? true,
        bloomSeconds: body.bloom_seconds ?? 30,
        doseGrams: body.dose_grams ?? null,
        brewRatio: body.brew_ratio ?? null,
      });
      return await loadPourOverProfile(platform, profile, "Failed to load pour-over profile");
    } catch (e) {
      return jsonResponse({ status: "error", detail: (e as Error).message }, 500);
    }
  }

  // POST /api/pour-over/prepare-recipe -> convert an OPOS recipe to a profile and load it on the machine.
  if (pathname === "/api/pour-over/prepare-recipe" && req.method === "POST") {
    try {
      const body = (await req.json().catch(() => ({}))) as { recipe_slug?: string };
      const recipe = POUR_OVER_RECIPES.find((r) => r.slug === body.recipe_slug);
      if (!recipe) {
        return jsonResponse({ status: "error", detail: `Recipe '${body.recipe_slug}' not found` }, 404);
      }
      const profile = adaptRecipeToProfile(recipe);
      return await loadPourOverProfile(platform, profile, "Failed to load recipe profile");
    } catch (e) {
      return jsonResponse({ status: "error", detail: (e as Error).message }, 500);
    }
  }

  // POST /api/pour-over/cleanup, force-cleanup -> server-side no-op success.
  // (The browser runtime additionally restores the previously-active profile
  //  from session state before this handler runs; see the browser native shim.)
  if ((pathname === "/api/pour-over/cleanup" || pathname === "/api/pour-over/force-cleanup") && req.method === "POST") {
    return jsonResponse({ status: "ok" });
  }

  // GET /api/pour-over/active -> no active-session tracking in direct/server mode.
  if (pathname === "/api/pour-over/active" && req.method === "GET") {
    return jsonResponse({ active: false });
  }

  return null;
}

/** Load an adapted pour-over profile onto the machine and return the standard response. */
async function loadPourOverProfile(
  platform: Platform,
  profile: Record<string, unknown>,
  failureDetail: string,
): Promise<Response> {
  const loadResponse = await platform.machine.fetch("/api/v1/profile/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!loadResponse.ok) {
    return jsonResponse({ status: "error", detail: failureDetail }, 502);
  }
  return jsonResponse({ profile_id: profile.id, profile_name: profile.name });
}
