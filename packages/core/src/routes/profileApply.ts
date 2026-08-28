/**
 * Apply-recommendations route.
 *
 * Patches selected AI recommendations onto a machine profile and saves it back
 * to the machine. Deterministic (no AI). Port of the two parity oracles:
 *   - server: apps/server/api/routes/profiles.py (apply_recommendations)
 *   - native: apps/web/src/services/interceptor/DirectModeInterceptor.ts
 *             (POST /api/profile/{name}/apply-recommendations)
 *
 * The two oracles are structurally identical (global temperature/final_weight,
 * profile variables, stage exit_triggers, stage limits, then a fuzzy fallback
 * that recovers model-invented positional ids like "pressure_2"). This port
 * additionally keeps the server's defensive bounds guards (temperature <= 100
 * C, final_weight > 0) so invalid values are skipped rather than written to the
 * machine.
 *
 * Route (also served under the bare `/profile/{name}/...` alias):
 *   POST /api/profile/{name}/apply-recommendations
 *     -> { status: "success"|"no_changes", profile?, applied, skipped }
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";

const KNOWN_VARIABLE_TYPES = [
  "pressure",
  "flow",
  "temperature",
  "weight",
  "time",
  "volume",
] as const;

const EXIT_TRIGGER_TYPE_MAP: Record<string, string> = {
  exit_weight: "weight",
  exit_time: "time",
  exit_pressure: "pressure",
  exit_flow: "flow",
  exit_volume: "volume",
};

const LIMIT_TYPE_MAP: Record<string, string> = {
  limit_pressure: "pressure",
  limit_flow: "flow",
  limit_weight: "weight",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function variableTypeOf(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  for (const type of KNOWN_VARIABLE_TYPES) {
    if (lower === type || lower.startsWith(`${type}_`)) return type;
  }
  return null;
}

/** Strip client-only metadata so the machine accepts the /profile/save body. */
function cloneProfileForSave(profile: Record<string, unknown>): Record<string, unknown> {
  const machineProfile: Record<string, unknown> = { ...profile };
  delete machineProfile.change_id;
  delete machineProfile.in_history;
  delete machineProfile.has_description;
  return JSON.parse(JSON.stringify(machineProfile)) as Record<string, unknown>;
}

function updateStageValue(
  stages: Array<Record<string, unknown>> | undefined,
  stageName: string,
  collectionKey: "exit_triggers" | "limits",
  typeMap: Record<string, string>,
  variable: string,
  value: number,
): { applied: boolean; reason?: string } {
  const targetType = typeMap[variable];
  if (!targetType || !stages) return { applied: false };
  const stage = stages.find(
    (item) => String(item.name ?? "").toLowerCase() === stageName.toLowerCase(),
  );
  if (!stage) return { applied: false };
  const collection = Array.isArray(stage[collectionKey])
    ? (stage[collectionKey] as Array<Record<string, unknown>>)
    : [];
  const target = collection.find((item) => item.type === targetType);
  if (!target) {
    return {
      applied: false,
      reason: `no ${targetType} ${collectionKey === "limits" ? "limit" : "exit trigger"} in stage '${stageName}'`,
    };
  }
  target.value = value;
  return { applied: true };
}

function resolveFuzzyVariable(
  variables: Array<Record<string, unknown>> | undefined,
  rawVariable: string,
  currentValue: unknown,
  stage: string,
): Record<string, unknown> | null {
  if (!Array.isArray(variables) || variables.length === 0) return null;
  const type = variableTypeOf(rawVariable);
  if (!type) return null;

  const adjustable = variables.filter((item) => {
    const key = String(item.key ?? "");
    if (key.startsWith("info_") || item.adjustable === false) return false;
    const itemType = String(item.type ?? "").toLowerCase() || variableTypeOf(key);
    return itemType === type;
  });
  if (adjustable.length === 0) return null;
  if (adjustable.length === 1) return adjustable[0];

  const cur = optionalNumber(currentValue);
  if (cur !== null) {
    const byValue = adjustable.filter((item) => optionalNumber(item.value) === cur);
    if (byValue.length === 1) return byValue[0];
  }

  const stageLower = stage.trim().toLowerCase();
  if (stageLower && stageLower !== "global") {
    const byStage = adjustable.filter(
      (item) =>
        String(item.name ?? "").toLowerCase().includes(stageLower) ||
        String(item.key ?? "").toLowerCase().includes(stageLower),
    );
    if (byStage.length === 1) return byStage[0];
  }
  return null;
}

async function findProfileByName(
  platform: Platform,
  name: string,
): Promise<Record<string, unknown> | null> {
  const response = await platform.machine.fetch("/api/v1/profile/list");
  if (!response.ok) return null;
  const raw: unknown = await response.json();
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.profiles)
      ? raw.profiles
      : [];
  for (const entry of list) {
    if (isRecord(entry) && String(entry.name ?? "") === name) return entry;
  }
  return null;
}

async function loadFullProfile(
  platform: Platform,
  id: string,
  fallback: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await platform.machine.fetch(`/api/v1/profile/get/${id}`);
    if (response.ok) {
      const data: unknown = await response.json();
      if (isRecord(data) && data.id) return data;
    }
  } catch {
    // fall through to the cached list entry
  }
  return fallback;
}

export async function handleApplyRecommendationsRoute(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const match = pathname.match(/^(?:\/api)?\/profile\/([^/]+)\/apply-recommendations$/);
  if (!match || req.method !== "POST") return null;

  const name = decodeURIComponent(match[1]);
  try {
    const form = await req.formData();
    const rawRecommendations = String(form.get("recommendations") ?? "[]");

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawRecommendations);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse({ detail: `Invalid recommendations JSON: ${message}` }, 400);
    }
    if (!Array.isArray(parsed)) {
      return jsonResponse({ detail: "recommendations must be a JSON array" }, 400);
    }

    const profile = await findProfileByName(platform, name);
    if (!profile) {
      return jsonResponse({ detail: `Profile '${name}' not found on machine` }, 404);
    }

    const fullProfile = await loadFullProfile(platform, String(profile.id ?? ""), profile);
    const updated = cloneProfileForSave(fullProfile);
    const variables = Array.isArray(updated.variables)
      ? (updated.variables as Array<Record<string, unknown>>)
      : undefined;
    const stages = Array.isArray(updated.stages)
      ? (updated.stages as Array<Record<string, unknown>>)
      : undefined;

    const applied: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const recommendation of parsed) {
      if (!isRecord(recommendation)) {
        skipped.push({ variable: "?", reason: "invalid entry (not an object)" });
        continue;
      }
      const variable = String(recommendation.variable ?? "");
      const stage = String(recommendation.stage ?? "");
      const recommendedValue = optionalNumber(recommendation.recommended_value);
      if (recommendedValue === null) {
        skipped.push({ variable, reason: "invalid recommended_value" });
        continue;
      }

      if (stage === "global" && variable === "temperature") {
        if (recommendedValue > 100) {
          skipped.push({ variable, reason: "exceeds 100 °C" });
          continue;
        }
        updated.temperature = recommendedValue;
        applied.push({ variable, stage, value: recommendedValue });
        continue;
      }
      if (stage === "global" && variable === "final_weight") {
        if (recommendedValue <= 0) {
          skipped.push({ variable, reason: "must be > 0" });
          continue;
        }
        updated.final_weight = recommendedValue;
        applied.push({ variable, stage, value: recommendedValue });
        continue;
      }

      const profileVariable = variables?.find((item) => item.key === variable);
      if (profileVariable) {
        if (
          String(profileVariable.key ?? "").startsWith("info_") ||
          profileVariable.adjustable === false
        ) {
          skipped.push({ variable, reason: "info-only / not adjustable" });
        } else {
          profileVariable.value = recommendedValue;
          applied.push({ variable, stage, value: recommendedValue });
        }
        continue;
      }

      const exitTriggerResult = updateStageValue(
        stages,
        stage,
        "exit_triggers",
        EXIT_TRIGGER_TYPE_MAP,
        variable,
        recommendedValue,
      );
      if (exitTriggerResult.applied) {
        applied.push({ variable, stage, value: recommendedValue });
        continue;
      }
      if (exitTriggerResult.reason) {
        skipped.push({ variable, reason: exitTriggerResult.reason });
        continue;
      }

      const limitResult = updateStageValue(
        stages,
        stage,
        "limits",
        LIMIT_TYPE_MAP,
        variable,
        recommendedValue,
      );
      if (limitResult.applied) {
        applied.push({ variable, stage, value: recommendedValue });
        continue;
      }
      if (limitResult.reason) {
        skipped.push({ variable, reason: limitResult.reason });
        continue;
      }

      const fuzzyVariable = resolveFuzzyVariable(
        variables,
        variable,
        recommendation.current_value,
        stage,
      );
      if (fuzzyVariable) {
        fuzzyVariable.value = recommendedValue;
        applied.push({
          variable: String(fuzzyVariable.key ?? variable),
          stage,
          value: recommendedValue,
          matched_from: variable,
        });
        continue;
      }

      skipped.push({ variable, reason: "variable not found in profile" });
    }

    if (applied.length === 0) {
      return jsonResponse({
        status: "no_changes",
        message: "No applicable recommendations to apply",
        applied,
        skipped,
      });
    }

    const saveResponse = await platform.machine.fetch("/api/v1/profile/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!saveResponse.ok) {
      return jsonResponse({ detail: "Failed to save profile to machine" }, 502);
    }

    return jsonResponse({ status: "success", profile: updated, applied, skipped });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Failed to apply recommendations";
    return jsonResponse({ detail }, 500);
  }
}
