/**
 * Shared profile-source resolver.
 *
 * Turns an arbitrary "share" input into a Meticulous profile object, ready to
 * save to the machine. Used by both runtimes (the Bun server and the browser /
 * native app) so link-, file- and text-sharing behave identically everywhere:
 *
 *   - metprofiles.link/profile/{id}  → resolved via the site's public download
 *     endpoint (GET /api/profiles/{id}/download), which returns the raw profile
 *     JSON with no auth.
 *   - a direct link to a `.json` profile → fetched as-is.
 *   - a raw JSON string (e.g. text shared from an iOS share sheet) → parsed.
 *
 * Decent Espresso profiles are auto-detected and converted in every path.
 *
 * Network access is injected (the platform's `machine.fetch`, which fetches
 * absolute URLs directly) so this module stays pure and unit-testable.
 */

import { detectDecentFormat, convertDecentToMeticulous } from "./decentConverter";

/** How a share input was interpreted. */
export type ProfileSourceKind = "metprofiles" | "url" | "json";

/** Error codes surfaced by the resolver, mapped to i18n messages by callers. */
export type ProfileSourceErrorCode =
  | "empty"
  | "invalid_input"
  | "fetch_failed"
  | "invalid_json"
  | "not_a_profile";

export class ProfileSourceError extends Error {
  code: ProfileSourceErrorCode;
  constructor(code: ProfileSourceErrorCode, message: string) {
    super(message);
    this.name = "ProfileSourceError";
    this.code = code;
  }
}

/** The outcome of resolving a share input. */
export interface ResolvedProfileSource {
  /** The Meticulous profile object, ready to POST to /api/v1/profile/save. */
  profile: Record<string, unknown>;
  /** Whether the input was a Decent profile we converted. */
  convertedFromDecent: boolean;
  /** How the input was interpreted. */
  sourceKind: ProfileSourceKind;
}

const METPROFILES_HOSTS = new Set(["metprofiles.link", "www.metprofiles.link"]);
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Extract the profile UUID from a metprofiles.link URL, or `null` if the input
 * is not a metprofiles link. Accepts `/profile/{id}` and any path containing a
 * UUID (e.g. `/profile/{id}/json`).
 */
export function parseMetprofilesId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!METPROFILES_HOSTS.has(url.hostname.toLowerCase())) return null;
  const scoped = url.pathname.match(/\/profile\/([0-9a-f-]{36})/i);
  if (scoped) return scoped[1];
  const anyUuid = url.pathname.match(UUID_RE);
  return anyUuid ? anyUuid[0] : null;
}

/** The public download endpoint for a metprofiles profile id. */
export function metprofilesDownloadUrl(id: string): string {
  return `https://metprofiles.link/api/profiles/${id}/download`;
}

/** Classify a share input without performing any network access. */
export function classifyProfileSource(input: string): ProfileSourceKind {
  const trimmed = input.trim();
  if (parseMetprofilesId(trimmed)) return "metprofiles";
  if (/^https?:\/\//i.test(trimmed)) return "url";
  return "json";
}

/** A minimal fetch signature: only absolute URLs are passed in. */
export type SourceFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

function normalizeResolved(
  raw: unknown,
  sourceKind: ProfileSourceKind,
): ResolvedProfileSource {
  let profile = raw;
  let convertedFromDecent = false;

  if (detectDecentFormat(profile)) {
    profile = convertDecentToMeticulous(profile).profile as unknown;
    convertedFromDecent = true;
  }

  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    typeof (profile as Record<string, unknown>).name !== "string" ||
    !(profile as Record<string, unknown>).name
  ) {
    throw new ProfileSourceError(
      "not_a_profile",
      "The shared content is not a valid profile (missing a 'name' field)",
    );
  }

  return {
    profile: profile as Record<string, unknown>,
    convertedFromDecent,
    sourceKind,
  };
}

/**
 * Resolve a share input (metprofiles link, direct JSON link, or raw JSON text)
 * into a Meticulous profile. Throws {@link ProfileSourceError} with a code the
 * caller maps to a localized message.
 */
export async function resolveProfileFromSource(
  input: string,
  fetchFn: SourceFetch,
): Promise<ResolvedProfileSource> {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    throw new ProfileSourceError("empty", "No profile source provided");
  }

  const kind = classifyProfileSource(trimmed);

  if (kind === "json") {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new ProfileSourceError(
        "invalid_input",
        "The shared content is neither a valid link nor valid JSON",
      );
    }
    return normalizeResolved(raw, kind);
  }

  const fetchUrl =
    kind === "metprofiles"
      ? metprofilesDownloadUrl(parseMetprofilesId(trimmed) as string)
      : trimmed;

  let resp: Response;
  try {
    resp = await fetchFn(fetchUrl);
  } catch {
    throw new ProfileSourceError(
      "fetch_failed",
      "Could not reach the profile link",
    );
  }
  if (!resp.ok) {
    throw new ProfileSourceError(
      "fetch_failed",
      `The profile link returned an error (HTTP ${resp.status})`,
    );
  }
  let raw: unknown;
  try {
    raw = await resp.json();
  } catch {
    throw new ProfileSourceError(
      "invalid_json",
      "The link did not return a valid JSON profile",
    );
  }
  return normalizeResolved(raw, kind);
}
