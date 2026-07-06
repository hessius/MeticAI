/**
 * Regenerate-description route.
 *
 * Regenerates a profile's human-readable description, preferring an AI write-up
 * and falling back to a deterministic static summary. Port of the two parity
 * oracles:
 *   - server: apps/server/api/routes/profiles.py (regenerate_profile_description)
 *   - native: apps/web/src/services/interceptor/DirectModeInterceptor.ts
 *             (POST /api/profile/{id}/regenerate-description)
 *
 * The two oracles resolve the target profile from runtime-specific caches
 * (server: profile-generation history; native: machine shot history + in-memory
 * profile caches). Those caches do not exist host-independently, so this core
 * port resolves the profile through the machine client instead, which is the
 * one path available on every host: treat the identifier first as a machine
 * profile id, then as a profile name. The browser Platform will map the
 * description/ai-tags storage repos onto its existing native caches in Phase 3.
 *
 * Route (also served under the bare `/profile/{id}/...` alias):
 *   POST /api/profile/{id}/regenerate-description
 *     -> { status: "success", description } | { status: "error", detail }
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import { AI_TAGS_PROMPT, parseAiTags, stripTagsLine } from "../logic/tags";
import {
  buildStaticProfileDescription,
  resolveDescriptionPlaceholders,
  type ProfileVariable,
} from "../logic/profileDescription";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve the profile JSON from the machine by id, then by name. */
async function resolveProfile(
  platform: Platform,
  identifier: string,
): Promise<Record<string, unknown> | null> {
  // Strategy 1: treat the identifier as a machine profile id directly.
  try {
    const byId = await platform.machine.fetch(`/api/v1/profile/get/${identifier}`);
    if (byId.ok) {
      const data: unknown = await byId.json();
      if (isRecord(data) && data.id) return data;
    }
  } catch {
    // fall through to name resolution
  }

  // Strategy 2: treat the identifier as a profile name via the catalogue.
  try {
    const listResp = await platform.machine.fetch("/api/v1/profile/list");
    if (listResp.ok) {
      const raw: unknown = await listResp.json();
      const list = Array.isArray(raw)
        ? raw
        : isRecord(raw) && Array.isArray(raw.profiles)
          ? raw.profiles
          : [];
      const match = list.find(
        (entry) => isRecord(entry) && String(entry.name ?? "") === identifier,
      );
      if (isRecord(match) && match.id) {
        const byName = await platform.machine.fetch(`/api/v1/profile/get/${match.id}`);
        if (byName.ok) {
          const data: unknown = await byName.json();
          if (isRecord(data) && data.id) return data;
        }
      }
    }
  } catch {
    // fall through to not-found
  }

  return null;
}

export async function handleRegenerateDescriptionRoute(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const match = pathname.match(/^(?:\/api)?\/profile\/([^/]+)\/regenerate-description$/);
  if (!match || req.method !== "POST") return null;

  const entryId = decodeURIComponent(match[1]);
  try {
    const profileJson = await resolveProfile(platform, entryId);
    if (!profileJson) {
      return jsonResponse({ status: "error", detail: "History entry not found" }, 404);
    }
    const profileName = String(profileJson.name ?? "") || entryId;

    if (platform.ai.isConfigured()) {
      try {
        const resolvedName =
          String(profileJson.name ?? "") || profileName || "Unknown Profile";
        const prompt = `You are a specialty coffee expert. Analyze this espresso machine profile JSON and write a detailed description.\n\nProfile name: ${resolvedName}\nProfile JSON:\n${JSON.stringify(profileJson, null, 2)}\n\nWrite the description in this exact format:\nProfile Created: [name]\nDescription: [1-2 sentence overview]\nPreparation: [brewing guidance]\nWhy This Works: [technical explanation]\nSpecial Notes: [any notable aspects]\n\nUse concrete numeric values with units (for example 9 bar, 2.0 ml/s, 30 s). Never output raw variable placeholders such as $name$ and never mention internal stage keys.${AI_TAGS_PROMPT}`;
        const response = await platform.ai.generateText({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        const rawText = response.text?.trim();
        if (rawText && !rawText.includes("generated without AI")) {
          const aiTags = parseAiTags(rawText);
          const profileVars = (Array.isArray(profileJson.variables)
            ? profileJson.variables
            : []) as ProfileVariable[];
          const description = resolveDescriptionPlaceholders(
            stripTagsLine(rawText),
            profileVars,
          );
          await platform.storage.descriptions.write(profileName, description);
          if (aiTags.length) {
            await platform.storage.aiTags.write(profileName, aiTags);
          }
          return jsonResponse({ status: "success", description });
        }
      } catch {
        // AI failure -> fall back to the static description below.
      }
    }

    const description = buildStaticProfileDescription(profileJson);
    await platform.storage.descriptions.write(profileName, description);
    return jsonResponse({ status: "success", description });
  } catch {
    return jsonResponse(
      { status: "error", detail: "Failed to regenerate description" },
      500,
    );
  }
}
