/**
 * System / meta route family.
 *
 * MeticAI application metadata and configuration that is not part of the
 * machine's native `/api/v1` surface. Ported to the unified core from the two
 * existing implementations kept at parity:
 *   - server: apps/server/api/routes/system.py
 *   - native: apps/web/src/services/interceptor/DirectModeInterceptor.ts
 *             (settings / version / network-ip handlers)
 *
 * The frontend reads a small, stable subset of the settings payload
 * (`geminiApiKeyConfigured`, `meticulousIp`, `authorName`, `geminiModel`,
 * `mqttEnabled`), which is the contract mirrored here. The raw AI key is never
 * returned; only whether one is configured.
 *
 * Routes:
 *   GET  /api/settings    -> effective settings (key masked)
 *   POST /api/settings    -> persist author/model/mqtt/key, returns { status }
 *   GET  /api/network-ip  -> configured machine host
 *   GET  /api/version     -> app version + runtime mode
 *   GET  /api/available-models -> served text models (live discovery + fallback)
 *   GET  /api/changelog   -> recent GitHub releases (best-effort)
 *   GET  /api/update-method / /api/tailscale-status -> admin stubs
 *   /api/check-updates | /restart | /beta-channel | /feedback -> 501
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import { STATIC_FALLBACK_MODELS } from "../ai/modelResolver";

const SETTINGS_KEY = "settings";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** Extract the bare host from a machine base URL (e.g. http://1.2.3.4:8080 -> 1.2.3.4). */
function machineHost(baseUrl: string): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
  }
}

async function readSettings(platform: Platform): Promise<Record<string, unknown>> {
  const stored = await platform.storage.settings.read(SETTINGS_KEY);
  return stored && typeof stored === "object" ? { ...stored } : {};
}

async function getSettingsPayload(platform: Platform): Promise<Record<string, unknown>> {
  const stored = await readSettings(platform);
  const aiConfig = platform.secrets.getAIConfig();
  const configured = platform.ai.isConfigured();
  const storedModel =
    typeof stored.geminiModel === "string" && stored.geminiModel.trim()
      ? (stored.geminiModel as string)
      : "";
  const mqttEnabled = stored.mqttEnabled !== false;

  return {
    // The raw key is never exposed; report the masked/configured state only.
    geminiApiKey: configured ? "********" : "",
    geminiApiKeyMasked: configured,
    geminiApiKeyConfigured: configured,
    aiProvider: aiConfig.provider || "gemini",
    meticulousIp: machineHost(platform.machine.getBaseUrl()),
    authorName: typeof stored.authorName === "string" ? stored.authorName : "",
    geminiModel: aiConfig.model || storedModel || DEFAULT_GEMINI_MODEL,
    mqttEnabled,
  };
}

async function saveSettings(
  platform: Platform,
  body: Record<string, unknown>,
): Promise<void> {
  const stored = await readSettings(platform);
  if (typeof body.geminiApiKey === "string") stored.geminiApiKey = body.geminiApiKey;
  if (typeof body.authorName === "string") stored.authorName = body.authorName;
  if (typeof body.geminiModel === "string") stored.geminiModel = body.geminiModel;
  if (typeof body.mqttEnabled === "boolean") stored.mqttEnabled = body.mqttEnabled;
  await platform.storage.settings.write(SETTINGS_KEY, stored);
}

/**
 * Dispatch system/meta routes. Returns `null` if the request is not one of
 * this family's routes so the next family can try it.
 */
export async function handleSystemRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/settings") {
    if (req.method === "GET") {
      return jsonResponse(await getSettingsPayload(platform));
    }
    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ status: "error", detail: "Invalid JSON body" }, 400);
      }
      if (!body || typeof body !== "object") {
        return jsonResponse({ status: "error", detail: "Invalid settings body" }, 400);
      }
      await saveSettings(platform, body);
      return jsonResponse({ status: "ok" });
    }
    return null;
  }

  if (pathname === "/api/network-ip" && req.method === "GET") {
    return jsonResponse({ ip: machineHost(platform.machine.getBaseUrl()) });
  }

  if (pathname === "/api/version" && req.method === "GET") {
    return jsonResponse({
      version: platform.appVersion || "unknown",
      mode: "server",
    });
  }

  // GET /api/available-models -> live discovery, static fallback when offline.
  if (pathname === "/api/available-models" && req.method === "GET") {
    const current =
      platform.ai.currentModel?.() ||
      platform.secrets.getAIConfig().model ||
      DEFAULT_GEMINI_MODEL;
    try {
      if (platform.ai.isConfigured() && platform.ai.listModels) {
        const models = await platform.ai.listModels();
        if (models.length) return jsonResponse({ models, current });
      }
    } catch {
      // fall through to the static fallback
    }
    return jsonResponse({ models: STATIC_FALLBACK_MODELS, current });
  }

  // GET /api/changelog -> recent GitHub releases (best-effort).
  if (pathname === "/api/changelog" && req.method === "GET") {
    try {
      const resp = await fetch(
        "https://api.github.com/repos/hessius/MeticAI/releases?per_page=5",
        { signal: AbortSignal.timeout(8000), headers: { Accept: "application/vnd.github+json" } },
      );
      if (resp.ok) {
        const releases = (await resp.json()) as Array<{
          tag_name: string;
          published_at: string;
          body: string;
        }>;
        return jsonResponse({
          releases: releases.map((r) => ({
            version: r.tag_name,
            date: r.published_at,
            body: r.body || "No release notes available.",
          })),
        });
      }
      return jsonResponse({ releases: [], error: "Failed to fetch releases" });
    } catch {
      return jsonResponse({ releases: [], error: "Failed to fetch releases" });
    }
  }

  // Backend-only admin routes -> sensible stubs (parity with native direct mode).
  if (pathname === "/api/update-method" && req.method === "GET") {
    return jsonResponse({ method: "manual", can_trigger_update: false });
  }
  if (pathname === "/api/tailscale-status" && req.method === "GET") {
    return jsonResponse({ enabled: false, installed: false });
  }
  if (
    (pathname === "/api/check-updates" ||
      pathname === "/api/restart" ||
      pathname === "/api/beta-channel" ||
      pathname === "/api/feedback") &&
    (req.method === "GET" || req.method === "POST")
  ) {
    return jsonResponse(
      { detail: "Server administration not available in direct/app mode" },
      501,
    );
  }

  return null;
}
