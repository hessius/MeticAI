/**
 * Machine profile CRUD + actuation route family (unified, native semantics).
 *
 * Straight port of the direct-mode oracle
 * (apps/web/src/services/interceptor/DirectModeInterceptor.ts), kept at parity
 * with the server (apps/server/api/routes/profiles.py). Profiles live on the
 * machine; these routes read, edit, import, reorder, delete, run, and describe
 * them through the machine seam. AI descriptions/tags overlay through the
 * Platform storage.
 *
 * Routes:
 *   POST   /api/machine/run-profile/{id}
 *   POST   /api/machine/run-profile-with-overrides/{id}
 *   POST   /api/profile/import
 *   POST   /api/profile/import-all
 *   POST   /api/convert-decent
 *   POST   /api/import-from-url
 *   POST   /api/machine/profiles/order
 *   POST   /api/machine/profile/load
 *   PATCH  /api/machine/profile/{id}                 (rename)
 *   DELETE /api/machine/profile/{id}
 *   GET    /api/machine/profiles
 *   GET    /api/machine/profiles/orphaned
 *   GET    /api/machine/profile/{id}/json
 *   GET    /api/profile/{name}/target-curves
 *   GET    /api/profile/{name}/image-proxy
 *   PUT    /api/profile/{name}/edit
 *   GET    /api/profile/{name}
 *   GET    /api/profiles/sync/status
 *   POST   /api/profiles/sync
 *   POST   /api/profiles/auto-sync
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import { detectDecentFormat, convertDecentToMeticulous } from "../logic/decentConverter";
import { buildStaticProfileDescription } from "../logic/profileDescription";
import { generateEstimatedTargetCurves } from "../logic/targetCurves";
import {
  type MachineProfile,
  buildProfileListResult,
  normalizeProfileIdent,
  profileImagePath,
  stripProfileMetadata,
} from "../logic/profileList";

/**
 * The currently-running ephemeral override profile, so the live view's target
 * curves reflect the temporary variables actually being brewed rather than the
 * saved profile. Mirrors the native module-level `_activeOverrideProfile`.
 */
let activeOverrideProfile: { name: string; profile: MachineProfile } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Placeholder returned when a profile has no image (avoids console 404s). */
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256">
<rect width="256" height="256" fill="#2d2d2d"/>
<path fill="#6b5b47" d="M128 32c-53 0-96 43-96 96s43 96 96 96 96-43 96-96-43-96-96-96zm0 176c-44.2 0-80-35.8-80-80s35.8-80 80-80 80 35.8 80 80-35.8 80-80 80z"/>
<path fill="#8b7355" d="M128 56c-39.8 0-72 32.2-72 72s32.2 72 72 72 72-32.2 72-72-32.2-72-72-72zm0 128c-30.9 0-56-25.1-56-56s25.1-56 56-56 56 25.1 56 56-25.1 56-56 56z"/>
<ellipse cx="128" cy="128" rx="32" ry="40" fill="#6b5b47"/>
</svg>`;

function imageResponse(bytes: Uint8Array, contentType: string): Response {
  // Uint8Array is a valid Response body at runtime on every host, but the DOM
  // and Bun type libs disagree on the exact BodyInit shape; cast through the
  // Response constructor's own parameter type to stay lib-agnostic.
  type ResponseBody = ConstructorParameters<typeof Response>[0];
  return new Response(bytes as unknown as ResponseBody, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

function placeholderImageResponse(): Response {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: { "Content-Type": "image/svg+xml" },
  });
}

function base64Decode(encoded: string): Uint8Array | null {
  try {
    if (typeof atob === "function") {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    const buf = (globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer;
    if (buf) return new Uint8Array(buf.from(encoded, "base64"));
  } catch {
    /* fall through */
  }
  return null;
}

/** Decode a base64 `data:image/*;base64,...` URI. Returns null when malformed. */
function parseDataImageUri(uri: string): { mimeType: string; bytes: Uint8Array } | null {
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = uri.slice(0, commaIdx);
  const encoded = uri.slice(commaIdx + 1);
  if (!header.endsWith(";base64") || !header.startsWith("data:image/")) return null;
  const mimeType = header.slice(5, header.length - 7).trim().toLowerCase();
  if (!mimeType.startsWith("image/")) return null;
  const bytes = base64Decode(encoded);
  return bytes ? { mimeType, bytes } : null;
}

async function machineOk(platform: Platform, path: string, init?: RequestInit): Promise<boolean> {
  try {
    return (await platform.machine.fetch(path, init)).ok;
  } catch {
    return false;
  }
}

async function loadProfileList(platform: Platform): Promise<MachineProfile[]> {
  const res = await platform.machine.fetch("/api/v1/profile/list");
  if (!res.ok) return [];
  const raw: unknown = await res.json();
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.profiles) ? raw.profiles : [];
  return list
    .map(normalizeProfileIdent)
    .filter((p): p is MachineProfile => p !== null);
}

async function findProfileByName(platform: Platform, name: string): Promise<MachineProfile | null> {
  const profiles = await loadProfileList(platform);
  return profiles.find((p) => p.name === name) ?? null;
}

async function aiTagsFor(platform: Platform, name: string): Promise<string[]> {
  const tags = await platform.storage.aiTags.read(name);
  return Array.isArray(tags) ? tags : [];
}

function applyOverrides(
  profile: Record<string, unknown>,
  overrides: Record<string, number>,
): Record<string, unknown> {
  const modified = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
  if (!Object.keys(overrides).length) return modified;
  const topLevelKeys = new Set(["final_weight", "temperature"]);
  const variables = modified.variables as Array<Record<string, unknown>> | undefined;
  if (variables) {
    const adjustableKeys = new Set(
      variables
        .filter((v) => typeof v.key === "string" && !(v.key as string).startsWith("info_"))
        .map((v) => v.key as string),
    );
    for (const [key, value] of Object.entries(overrides)) {
      if (!adjustableKeys.has(key) && !topLevelKeys.has(key)) continue;
      if (adjustableKeys.has(key)) {
        for (const v of variables) {
          if (v.key === key) {
            v.value = value;
            break;
          }
        }
      }
    }
  }
  for (const key of ["final_weight", "temperature"]) {
    if (key in overrides) modified[key] = overrides[key];
  }
  return modified;
}

export async function handleProfilesCrudRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // POST /api/machine/run-profile/{id}
  const runMatch = pathname.match(/^\/api\/machine\/run-profile\/([^/?]+)$/);
  if (runMatch && method === "POST") {
    const profileId = decodeURIComponent(runMatch[1]!);
    activeOverrideProfile = null;
    let loadResp = await platform.machine.fetch(`/api/v1/profile/load/${profileId}`);
    if (!loadResp.ok) {
      await platform.machine.fetch("/api/v1/action/stop");
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(2000);
        loadResp = await platform.machine.fetch(`/api/v1/profile/load/${profileId}`);
        if (loadResp.ok) break;
        const body = (await loadResp.json().catch(() => ({}))) as { error?: string };
        if (body.error !== "machine is busy") {
          return jsonResponse({ status: "error", detail: body.error || "Load failed" }, 502);
        }
      }
      if (!loadResp.ok) {
        return jsonResponse({ status: "error", detail: "Machine busy — try again" }, 409);
      }
    }
    const started = await machineOk(platform, "/api/v1/action/start");
    return started
      ? jsonResponse({ status: "success", message: "Profile started" })
      : jsonResponse({ status: "error", detail: "Failed to start" }, 502);
  }

  // POST /api/machine/run-profile-with-overrides/{id}
  const runOverridesMatch = pathname.match(
    /^\/api\/machine\/run-profile-with-overrides\/([^/?]+)$/,
  );
  if (runOverridesMatch && method === "POST") {
    const profileId = decodeURIComponent(runOverridesMatch[1]!);
    try {
      const formData = await req.formData();
      const overridesRaw = formData.get("overrides_json");
      const saveMode = String(formData.get("save_mode") ?? "") || "none";
      const newName = String(formData.get("new_name") ?? "") || "";

      let overridesDict: Record<string, number>;
      try {
        overridesDict = overridesRaw ? JSON.parse(String(overridesRaw)) : {};
      } catch {
        return jsonResponse({ detail: "Invalid overrides JSON" }, 422);
      }
      if (!["none", "save_original", "save_new"].includes(saveMode)) {
        return jsonResponse({ detail: `Invalid save_mode: ${saveMode}` }, 422);
      }
      if (saveMode === "save_new" && !newName.trim()) {
        return jsonResponse({ detail: "new_name is required when save_mode is save_new" }, 422);
      }
      const infoKeys = Object.keys(overridesDict).filter((k) => k.startsWith("info_"));
      if (infoKeys.length > 0) {
        return jsonResponse({ detail: `Cannot override info variables: ${infoKeys.join(", ")}` }, 422);
      }

      const profileResp = await platform.machine.fetch(`/api/v1/profile/get/${profileId}`);
      if (!profileResp.ok) {
        return jsonResponse({ detail: `Profile ${profileId} not found` }, 404);
      }
      const profileData = (await profileResp.json()) as Record<string, unknown>;
      const originalName = (profileData.name as string) || "Unknown Profile";
      const hasOverrides = Object.keys(overridesDict).length > 0;

      if (saveMode === "save_new" && hasOverrides) {
        const newProfile = applyOverrides(profileData, overridesDict);
        delete newProfile.id;
        newProfile.name = newName.trim();
        const saveOk = await machineOk(platform, "/api/v1/profile/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newProfile),
        });
        if (!saveOk) return jsonResponse({ detail: "Failed to save new profile" }, 502);
      }

      if (hasOverrides) {
        const modified = applyOverrides(profileData, overridesDict);
        if (saveMode === "save_new") {
          modified.name = newName.trim();
          delete modified.id;
        }
        activeOverrideProfile = {
          name: (modified.name as string) || originalName,
          profile: modified as unknown as MachineProfile,
        };
        const loadOk = await machineOk(platform, "/api/v1/profile/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(modified),
        });
        if (!loadOk) return jsonResponse({ detail: "Failed to load modified profile" }, 502);
      } else {
        activeOverrideProfile = null;
        let loadResp = await platform.machine.fetch(`/api/v1/profile/load/${profileId}`);
        if (!loadResp.ok) {
          await platform.machine.fetch("/api/v1/action/stop");
          for (let attempt = 0; attempt < 10; attempt++) {
            await sleep(2000);
            loadResp = await platform.machine.fetch(`/api/v1/profile/load/${profileId}`);
            if (loadResp.ok) break;
          }
          if (!loadResp.ok) return jsonResponse({ detail: "Machine busy — try again" }, 409);
        }
      }

      const started = await machineOk(platform, "/api/v1/action/start");
      if (!started) return jsonResponse({ detail: "Failed to start profile" }, 502);

      if (saveMode === "save_original" && hasOverrides) {
        const saved = applyOverrides(profileData, overridesDict);
        saved.id = profileId;
        saved.name = originalName;
        void machineOk(platform, "/api/v1/profile/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(saved),
        });
      }

      return jsonResponse({
        status: "success",
        message: hasOverrides ? "Profile started with overrides" : "Profile started",
        profile_id: profileId,
        profile_name: saveMode === "save_new" ? newName.trim() : originalName,
        overrides_applied: Object.keys(overridesDict).length,
        save_mode: saveMode,
      });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to run profile with overrides" },
        500,
      );
    }
  }

  // POST /api/profile/import
  if (pathname === "/api/profile/import" && method === "POST") {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        profile?: Record<string, unknown>;
        source?: string;
      };
      const profileName = (body.profile as { name?: string })?.name || "Unknown";
      if (body.source === "file" && body.profile) {
        const saveOk = await machineOk(platform, "/api/v1/profile/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body.profile),
        });
        if (!saveOk) {
          return jsonResponse({ status: "error", detail: "Failed to save profile to machine" }, 502);
        }
      }
      return jsonResponse({
        status: "success",
        entry_id: "direct-" + platform.clock(),
        profile_name: profileName,
        has_description: false,
        uploaded_to_machine: true,
      });
    } catch {
      return jsonResponse({ status: "error", detail: "Import failed" }, 500);
    }
  }

  // POST /api/profile/import-all
  if (pathname === "/api/profile/import-all" && method === "POST") {
    return jsonResponse({
      status: "success",
      imported: 0,
      skipped: 0,
      message: "All profiles already on machine",
    });
  }

  // POST /api/convert-decent
  if (pathname === "/api/convert-decent" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (!detectDecentFormat(body)) {
        return jsonResponse({ detail: "Not a valid Decent Espresso profile format" }, 400);
      }
      return jsonResponse(convertDecentToMeticulous(body));
    } catch {
      return jsonResponse({ detail: "Decent profile conversion failed" }, 500);
    }
  }

  // POST /api/import-from-url
  if (pathname === "/api/import-from-url" && method === "POST") {
    try {
      const body = (await req.json().catch(() => ({}))) as { url?: string };
      const profileUrl = body.url?.trim();
      if (!profileUrl) return jsonResponse({ status: "error", detail: "No URL provided" }, 400);
      let profileResp: Response;
      try {
        profileResp = await platform.machine.fetch(profileUrl);
      } catch {
        return jsonResponse({ status: "error", detail: "Failed to fetch URL" }, 502);
      }
      let profileJson: Record<string, unknown>;
      try {
        profileJson = (await profileResp.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ status: "error", detail: "URL did not return valid JSON" }, 400);
      }
      let convertedFromDecent = false;
      if (detectDecentFormat(profileJson)) {
        const result = convertDecentToMeticulous(profileJson);
        profileJson = result.profile as unknown as Record<string, unknown>;
        convertedFromDecent = true;
      }
      if (typeof profileJson.name !== "string" || !profileJson.name) {
        return jsonResponse({ status: "error", detail: "Profile is missing a 'name' field" }, 400);
      }
      const saveOk = await machineOk(platform, "/api/v1/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileJson),
      });
      if (!saveOk) {
        return jsonResponse({ status: "error", detail: "Failed to save profile to machine" }, 502);
      }
      return jsonResponse({
        status: "success",
        entry_id: "direct-" + platform.clock(),
        profile_name: profileJson.name,
        has_description: false,
        uploaded_to_machine: true,
        converted_from_decent: convertedFromDecent,
      });
    } catch {
      return jsonResponse({ status: "error", detail: "Import from URL failed" }, 500);
    }
  }

  // POST /api/machine/profiles/order
  if (pathname === "/api/machine/profiles/order" && method === "POST") {
    try {
      const { order } = (await req.json().catch(() => ({}))) as { order?: unknown };
      if (
        !Array.isArray(order) ||
        order.length === 0 ||
        !order.every((id) => typeof id === "string" && id)
      ) {
        return jsonResponse(
          { status: "error", error: "order must be a non-empty list of profile IDs" },
          400,
        );
      }
      const resp = await platform.machine.fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_order: order }),
      });
      if (!resp.ok) {
        return jsonResponse(
          { status: "error", error: `Machine rejected order (HTTP ${resp.status})` },
          502,
        );
      }
      return jsonResponse({ status: "success", order });
    } catch (err) {
      return jsonResponse(
        { status: "error", error: err instanceof Error ? err.message : "Failed to reorder profiles" },
        500,
      );
    }
  }

  // GET /api/machine/profiles/orphaned
  if (pathname === "/api/machine/profiles/orphaned" && method === "GET") {
    return jsonResponse({ orphaned: [] });
  }

  // GET /api/machine/profiles
  if (pathname === "/api/machine/profiles" && method === "GET") {
    try {
      const res = await platform.machine.fetch("/api/v1/profile/list");
      if (!res.ok) return jsonResponse({ profiles: [] });
      const raw: unknown = await res.json();
      const result = buildProfileListResult(Array.isArray(raw) ? raw : [], () => []);
      // ai_tags come from the overlay, keyed by profile name.
      result.profiles = await Promise.all(
        result.profiles.map(async (p) => ({ ...p, ai_tags: await aiTagsFor(platform, p.name) })),
      );
      return jsonResponse(result);
    } catch {
      return jsonResponse({ profiles: [] });
    }
  }

  // POST /api/machine/profile/load
  if (pathname === "/api/machine/profile/load" && method === "POST") {
    try {
      const { profile_id } = (await req.json().catch(() => ({}))) as { profile_id?: string };
      if (!profile_id) return jsonResponse({ success: false, message: "No profile_id" }, 400);
      let loadResp = await platform.machine.fetch(`/api/v1/profile/load/${profile_id}`);
      if (!loadResp.ok) {
        await platform.machine.fetch("/api/v1/action/stop");
        await sleep(2000);
        loadResp = await platform.machine.fetch(`/api/v1/profile/load/${profile_id}`);
      }
      if (!loadResp.ok) return jsonResponse({ success: false }, 502);
      return jsonResponse({ success: true });
    } catch {
      return jsonResponse({ success: false }, 500);
    }
  }

  // GET /api/machine/profile/{id}/json
  const profileJsonMatch = pathname.match(/^\/api\/machine\/profile\/([^/]+)\/json$/);
  if (profileJsonMatch && method === "GET") {
    try {
      const r = await platform.machine.fetch(`/api/v1/profile/get/${profileJsonMatch[1]}`);
      if (!r.ok) return jsonResponse({});
      return jsonResponse({ profile: await r.json() });
    } catch {
      return jsonResponse({});
    }
  }

  // PATCH /api/machine/profile/{id} -> rename
  const idMatch = pathname.match(/^\/api\/machine\/profile\/([^/?]+)$/);
  if (idMatch && method === "PATCH") {
    const profileId = decodeURIComponent(idMatch[1]!);
    try {
      let body: { name?: unknown };
      try {
        body = (await req.json()) as { name?: unknown };
      } catch {
        return jsonResponse({ detail: "Invalid profile update body" }, 400);
      }
      const newName = typeof body.name === "string" ? body.name.trim() : "";
      if (!newName) {
        return jsonResponse(
          { detail: "At least one field to update is required (e.g., 'name')" },
          400,
        );
      }
      const profileResp = await platform.machine.fetch(
        `/api/v1/profile/get/${encodeURIComponent(profileId)}`,
      );
      if (!profileResp.ok) return jsonResponse({ detail: `Profile not found: ${profileId}` }, 404);
      const profileJson = (await profileResp.json()) as Record<string, unknown>;
      const oldName =
        typeof profileJson.name === "string" && profileJson.name ? profileJson.name : profileId;
      const updatedProfile = { ...profileJson, name: newName };
      const saveOk = await machineOk(platform, "/api/v1/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedProfile),
      });
      if (!saveOk) return jsonResponse({ detail: "Failed to save profile to machine" }, 502);
      return jsonResponse({
        status: "success",
        message: `Profile renamed from '${oldName}' to '${newName}'`,
        profile_id: profileId,
        old_name: oldName,
        new_name: newName,
      });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to rename profile" },
        500,
      );
    }
  }

  // DELETE /api/machine/profile/{id}
  if (idMatch && method === "DELETE") {
    const ok = await machineOk(platform, `/api/v1/profile/delete/${idMatch[1]}`, {
      method: "DELETE",
    });
    return jsonResponse({ success: ok }, ok ? 200 : 502);
  }

  // GET /api/profile/{name}/image-proxy → fetch the profile image from the
  // machine and return the bytes, so the SPA never needs the machine IP.
  // Mirrors apps/server/api/routes/profiles.py + the native interceptor: the
  // image path may be a data: URI or a machine-relative path; missing images
  // degrade to a placeholder SVG (avoids browser console errors).
  const imageProxyMatch = pathname.match(/^\/api\/profile\/([^/]+)\/image-proxy$/);
  if (imageProxyMatch && method === "GET") {
    const name = decodeURIComponent(imageProxyMatch[1]!);
    const forceRefresh = url.searchParams.get("force_refresh") === "true";
    const cacheKey = `image-proxy:${name}`;
    try {
      if (!forceRefresh) {
        const cached = await platform.storage.images.read(cacheKey);
        if (cached) return imageResponse(cached, "image/png");
      }

      let profile = await findProfileByName(platform, name);
      if (!profile) return placeholderImageResponse();

      // The list omits stages/display for some entries; fetch the full profile
      // so display.image is present.
      let imagePath = profileImagePath(profile);
      if (!imagePath) {
        try {
          const fullResp = await platform.machine.fetch(`/api/v1/profile/get/${profile.id}`);
          if (fullResp.ok) {
            const full = (await fullResp.json()) as MachineProfile;
            if (full && typeof full.id === "string") profile = full;
            imagePath = profileImagePath(profile);
          }
        } catch {
          /* fall through to placeholder */
        }
      }
      if (!imagePath) return placeholderImageResponse();

      if (imagePath.startsWith("data:image/")) {
        const parsed = parseDataImageUri(imagePath);
        if (!parsed) return placeholderImageResponse();
        await platform.storage.images.write(cacheKey, parsed.bytes);
        return imageResponse(parsed.bytes, parsed.mimeType);
      }

      // Absolute machine URLs are reduced to their path so machine.fetch can
      // join them onto the resolved base URL uniformly across hosts.
      let fetchPath = imagePath;
      if (/^https?:\/\//i.test(imagePath)) {
        try {
          const parsedUrl = new URL(imagePath);
          fetchPath = `${parsedUrl.pathname}${parsedUrl.search}`;
        } catch {
          return placeholderImageResponse();
        }
      }

      const imgResp = await platform.machine.fetch(fetchPath);
      if (!imgResp.ok) return placeholderImageResponse();
      const bytes = new Uint8Array(await imgResp.arrayBuffer());
      const rawType = imgResp.headers.get("content-type") ?? "";
      const mediaType = rawType.split(";", 1)[0]!.trim();
      const contentType = mediaType.startsWith("image/") ? mediaType : "image/png";
      await platform.storage.images.write(cacheKey, bytes);
      return imageResponse(bytes, contentType);
    } catch {
      return placeholderImageResponse();
    }
  }

  // GET /api/profile/{name}/target-curves
  const targetCurvesMatch = pathname.match(/^\/api\/profile\/([^/]+)\/target-curves$/);
  if (targetCurvesMatch && method === "GET") {
    try {
      const name = decodeURIComponent(targetCurvesMatch[1]!);
      let profile =
        activeOverrideProfile && activeOverrideProfile.name === name
          ? activeOverrideProfile.profile
          : await findProfileByName(platform, name);
      if (!profile) return jsonResponse({ detail: `Profile '${name}' not found` }, 404);
      // The machine's profile list omits stages; fetch the full profile so the
      // estimated curves are non-empty (the active override already has stages).
      if (!Array.isArray(profile.stages) || profile.stages.length === 0) {
        try {
          const fullResp = await platform.machine.fetch(`/api/v1/profile/get/${profile.id}`);
          if (fullResp.ok) {
            const full = (await fullResp.json()) as MachineProfile;
            if (Array.isArray(full?.stages)) profile = full;
          }
        } catch {
          /* fall back to the list profile */
        }
      }
      return jsonResponse({ status: "success", target_curves: generateEstimatedTargetCurves(profile) });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to get target curves" },
        500,
      );
    }
  }

  // PUT /api/profile/{name}/edit
  const editMatch = pathname.match(/^\/api\/profile\/([^/]+)\/edit$/);
  if (editMatch && method === "PUT") {
    try {
      const name = decodeURIComponent(editMatch[1]!);
      const profile = await findProfileByName(platform, name);
      if (!profile) return jsonResponse({ detail: `Profile '${name}' not found on machine` }, 404);
      let fullProfile: MachineProfile = profile;
      const fullResp = await platform.machine.fetch(`/api/v1/profile/get/${profile.id}`);
      if (fullResp.ok) {
        try {
          const parsed = (await fullResp.json()) as MachineProfile;
          if (typeof parsed?.id === "string") fullProfile = parsed;
        } catch {
          /* use the list profile */
        }
      }
      const body = (await req.json()) as {
        name?: string;
        temperature?: number;
        final_weight?: number;
        variables?: Array<{ key?: string; value?: unknown }>;
        author?: string;
      };
      const updated: MachineProfile = JSON.parse(JSON.stringify(fullProfile));
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          return jsonResponse({ detail: "Profile name must be a non-empty string" }, 400);
        }
        updated.name = body.name.trim();
      }
      if (body.temperature !== undefined) updated.temperature = Number(body.temperature);
      if (body.final_weight !== undefined) updated.final_weight = Number(body.final_weight);
      if (body.author !== undefined) updated.author = body.author;
      if (body.variables !== undefined && Array.isArray(updated.variables)) {
        const incoming = new Map(
          body.variables
            .filter((variable) => typeof variable.key === "string" && "value" in variable)
            .map((variable) => [variable.key as string, variable.value]),
        );
        updated.variables = (updated.variables as Array<Record<string, unknown>>).map((variable) => {
          const key = typeof variable.key === "string" ? variable.key : null;
          return key && incoming.has(key) ? { ...variable, value: incoming.get(key) } : variable;
        });
      }
      const machineProfile = stripProfileMetadata(updated as unknown as Record<string, unknown>);
      const saveOk = await machineOk(platform, "/api/v1/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(machineProfile),
      });
      if (!saveOk) return jsonResponse({ detail: "Failed to save profile to machine" }, 502);

      // Regenerate the static description for the edited profile (best-effort).
      try {
        const desc = buildStaticProfileDescription(
          machineProfile as Parameters<typeof buildStaticProfileDescription>[0],
        );
        await platform.storage.descriptions.write(updated.name, desc);
      } catch {
        /* non-critical */
      }

      return jsonResponse({ status: "success", profile: machineProfile });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to edit profile" },
        500,
      );
    }
  }

  // GET /api/profile/{name}
  const byNameMatch = pathname.match(/^\/api\/profile\/([^/]+)$/);
  if (byNameMatch && method === "GET") {
    const name = decodeURIComponent(byNameMatch[1]!);
    try {
      const profile = await findProfileByName(platform, name);
      if (!profile) {
        return jsonResponse({
          status: "not_found",
          profile: null,
          message: `Profile '${name}' not found on machine`,
        });
      }
      const includeStages = url.searchParams.get("include_stages") === "true";
      const responseProfile: Record<string, unknown> = {
        id: profile.id,
        name: profile.name,
        author: profile.author,
        temperature: profile.temperature,
        final_weight: profile.final_weight,
        image: profileImagePath(profile),
        accent_color: profile.display?.accentColor,
        display: profile.display,
      };
      if (includeStages) {
        let stages = Array.isArray(profile.stages) ? profile.stages : [];
        let variables = Array.isArray(profile.variables) ? profile.variables : [];
        if (stages.length === 0) {
          try {
            const fullResp = await platform.machine.fetch(`/api/v1/profile/get/${profile.id}`);
            if (fullResp.ok) {
              const full = (await fullResp.json()) as MachineProfile;
              if (Array.isArray(full?.stages)) stages = full.stages;
              if (Array.isArray(full?.variables)) variables = full.variables;
            }
          } catch {
            /* fall back to the list profile */
          }
        }
        responseProfile.stages = stages;
        responseProfile.variables = variables;
      }
      return jsonResponse({ status: "success", profile: responseProfile });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to get profile info" },
        500,
      );
    }
  }

  // GET /api/profiles/sync/status
  if (pathname === "/api/profiles/sync/status" && method === "GET") {
    return jsonResponse({ new_count: 0, updated_count: 0, orphaned_count: 0 });
  }

  // POST /api/profiles/sync
  if (pathname === "/api/profiles/sync" && method === "POST") {
    return jsonResponse({ status: "success", new: [], updated: [], orphaned: [] });
  }

  // POST /api/profiles/auto-sync
  // Profiles live on the machine and the SPA reads them directly, so there is
  // no separate library to import into: auto-sync is a no-op success. Prevents
  // a core notFound leak when the (opt-in, default-off) auto-sync preference is
  // enabled in proxy mode.
  if (pathname === "/api/profiles/auto-sync" && method === "POST") {
    return jsonResponse({
      status: "success",
      imported: [],
      updated: [],
      orphaned: [],
      imported_count: 0,
      updated_count: 0,
    });
  }

  return null;
}
