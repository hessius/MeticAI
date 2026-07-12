/**
 * Tailscale remote-access routes for the Bun server host (Phase 5).
 *
 * These are host-specific (they read the tailscaled LocalAPI over a unix socket
 * and persist user preferences), so they live in the server rather than in the
 * host-agnostic `@metic/core`. The response shapes match the frozen 2.x
 * `/api/tailscale-status` and `/api/tailscale/configure` contracts.
 *
 * Unlike the Python server, the distroless single binary has no `subprocess`,
 * `docker` or `curl`: status is read purely via Bun's `fetch(..., { unix })`
 * against the shared `/var/run/tailscale/tailscaled.sock` (mounted from the
 * Tailscale sidecar). There is no `.env`/compose rewriting; enabling/disabling
 * only persists the preference (the sidecar itself is controlled by compose).
 */

import type { Platform } from "@metic/core/platform";

const TAILSCALE_SOCKET = "/var/run/tailscale/tailscaled.sock";
const LOCALAPI_STATUS_URL = "http://local-tailscaled.sock/localapi/v0/status";
const LOGIN_URL = "https://login.tailscale.com/admin/settings/keys";

export interface TailscaleStatus {
  enabled: boolean;
  auth_key_configured: boolean;
  installed: boolean;
  connected: boolean;
  hostname: string | null;
  dns_name: string | null;
  ip: string | null;
  external_url: string | null;
  auth_key_expired: boolean;
  login_url: string | null;
}

function baseStatus(enabled: boolean, authKeyConfigured: boolean): TailscaleStatus {
  return {
    enabled,
    auth_key_configured: authKeyConfigured,
    installed: false,
    connected: false,
    hostname: null,
    dns_name: null,
    ip: null,
    external_url: null,
    auth_key_expired: false,
    login_url: null,
  };
}

interface TailscaleSelf {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
}
interface TailscaleStatusJson {
  BackendState?: string;
  Self?: TailscaleSelf;
}

/** Fold a tailscaled LocalAPI status document into the API status shape. */
export function parseTailscaleStatus(
  status: TailscaleStatus,
  data: TailscaleStatusJson,
): TailscaleStatus {
  status.installed = true;
  const backendState = data.BackendState ?? "";
  status.connected = backendState === "Running";
  const self = data.Self ?? {};
  status.hostname = self.HostName ?? null;
  const dnsName = self.DNSName ?? "";
  if (dnsName) {
    status.dns_name = dnsName.replace(/\.+$/, "");
    status.external_url = `https://${status.dns_name}`;
  }
  const ips = self.TailscaleIPs ?? [];
  if (ips.length > 0) status.ip = ips[0] ?? null;
  if (backendState === "NeedsLogin") {
    status.auth_key_expired = true;
    status.connected = false;
    status.login_url = LOGIN_URL;
  }
  return status;
}

function readSettings(platform: Platform): Promise<Record<string, unknown> | null> {
  return platform.storage.settings.read("settings");
}

function resolveAuthKey(settings: Record<string, unknown> | null): string {
  const stored = typeof settings?.tailscaleAuthKey === "string" ? settings.tailscaleAuthKey : "";
  return stored || (process.env.TAILSCALE_AUTHKEY ?? "");
}

/** Query the tailscaled LocalAPI over the shared unix socket. Returns the status shape. */
export async function getTailscaleStatus(platform: Platform): Promise<TailscaleStatus> {
  const settings = await readSettings(platform);
  const enabled = settings?.tailscaleEnabled === true;
  const authKey = resolveAuthKey(settings);
  const status = baseStatus(enabled, Boolean(authKey));

  try {
    const res = await fetch(LOCALAPI_STATUS_URL, {
      // Bun-native unix-socket fetch; no curl/subprocess needed.
      unix: TAILSCALE_SOCKET,
      signal: AbortSignal.timeout(5_000),
    } as RequestInit);
    if (res.ok) {
      parseTailscaleStatus(status, (await res.json()) as TailscaleStatusJson);
    }
  } catch (err) {
    // Socket absent or tailscaled unreachable: report not-installed (not an error).
    platform.logger.debug("tailscale status probe failed", err);
  }

  return status;
}

function isMaskedKey(value: string): boolean {
  return value.includes("*") || value.includes("...");
}

interface ConfigureBody {
  enabled?: unknown;
  authKey?: unknown;
}

/** Persist Tailscale preferences into settings.json (merged, not replaced). */
export async function configureTailscale(
  platform: Platform,
  body: ConfigureBody,
): Promise<{
  status: string;
  message: string;
  enabled: boolean;
  auth_key_configured: boolean;
  restart_required: boolean;
  restart_signaled: boolean;
}> {
  const settings: Record<string, unknown> = { ...((await readSettings(platform)) ?? {}) };
  const prevEnabled = settings.tailscaleEnabled === true;

  let changed = false;
  let enabledChanged = false;

  if ("enabled" in body) {
    const newEnabled = Boolean(body.enabled);
    settings.tailscaleEnabled = newEnabled;
    changed = true;
    enabledChanged = newEnabled !== prevEnabled;
  }

  if ("authKey" in body) {
    const raw = typeof body.authKey === "string" ? body.authKey.trim() : "";
    if (raw && !isMaskedKey(raw)) {
      settings.tailscaleAuthKey = raw;
      changed = true;
    } else if (!raw) {
      settings.tailscaleAuthKey = "";
      changed = true;
    }
    // A masked value is ignored (the UI echoes the stored key masked).
  }

  if (!changed) {
    return {
      status: "success",
      message: "No changes to apply",
      enabled: prevEnabled,
      auth_key_configured: Boolean(resolveAuthKey(settings)),
      restart_required: false,
      restart_signaled: false,
    };
  }

  await platform.storage.settings.write("settings", settings);

  const enabled = settings.tailscaleEnabled === true;
  const authKeyConfigured = Boolean(resolveAuthKey(settings));
  const action = enabled ? "enabled" : "disabled";
  platform.logger.info(`Tailscale configuration updated: ${action}`, {
    tailscale_enabled: enabled,
    auth_key_configured: authKeyConfigured,
  });

  return {
    status: "success",
    message: `Tailscale ${action}`,
    enabled,
    auth_key_configured: authKeyConfigured,
    // The sidecar is brought up/down by compose profiles, not this process, so
    // an enable/disable toggle asks the operator to recreate the stack.
    restart_required: enabledChanged,
    restart_signaled: false,
  };
}

/**
 * Dispatch the two Tailscale routes. Returns a Response when owned, else null so
 * the caller can fall through to `@metic/core`.
 */
export async function handleTailscaleRoutes(
  request: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  if (pathname === "/api/tailscale-status" && request.method === "GET") {
    return json(await getTailscaleStatus(platform));
  }

  if (pathname === "/api/tailscale/configure" && request.method === "POST") {
    let body: ConfigureBody = {};
    try {
      body = (await request.json()) as ConfigureBody;
    } catch {
      return json({ status: "error", detail: "Invalid JSON body" }, 400);
    }
    return json(await configureTailscale(platform, body));
  }

  return null;
}
