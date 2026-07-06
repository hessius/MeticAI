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
 *   PUT    /api/profile/{name}/edit
 *   GET    /api/profile/{name}
 *   GET    /api/profiles/sync/status
 *   POST   /api/profiles/sync
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

  return null;
}
