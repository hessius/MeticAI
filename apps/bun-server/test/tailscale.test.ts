import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatform } from "../src/platform/node.ts";
import {
  parseTailscaleStatus,
  getTailscaleStatus,
  configureTailscale,
  handleTailscaleRoutes,
  type TailscaleStatus,
} from "../src/tailscale.ts";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "metic-tailscale-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

function blank(): TailscaleStatus {
  return {
    enabled: false,
    auth_key_configured: false,
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

describe("parseTailscaleStatus", () => {
  test("maps a Running status into hostname/dns/ip/external_url", () => {
    const s = parseTailscaleStatus(blank(), {
      BackendState: "Running",
      Self: {
        HostName: "meticai",
        DNSName: "meticai.tail1234.ts.net.",
        TailscaleIPs: ["100.64.0.1", "fd7a::1"],
      },
    });
    expect(s.installed).toBe(true);
    expect(s.connected).toBe(true);
    expect(s.hostname).toBe("meticai");
    expect(s.dns_name).toBe("meticai.tail1234.ts.net");
    expect(s.external_url).toBe("https://meticai.tail1234.ts.net");
    expect(s.ip).toBe("100.64.0.1");
    expect(s.auth_key_expired).toBe(false);
  });

  test("NeedsLogin marks the auth key expired and not connected", () => {
    const s = parseTailscaleStatus(blank(), { BackendState: "NeedsLogin", Self: {} });
    expect(s.installed).toBe(true);
    expect(s.connected).toBe(false);
    expect(s.auth_key_expired).toBe(true);
    expect(s.login_url).toContain("login.tailscale.com");
  });
});

describe("getTailscaleStatus", () => {
  test("reports not-installed when the socket is unreachable", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const status = await getTailscaleStatus(platform);
    expect(status.installed).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.enabled).toBe(false);
  });

  test("reflects persisted enabled + auth_key_configured", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    await platform.storage.settings.write("settings", {
      tailscaleEnabled: true,
      tailscaleAuthKey: "tskey-abc123",
    });
    const status = await getTailscaleStatus(platform);
    expect(status.enabled).toBe(true);
    expect(status.auth_key_configured).toBe(true);
  });
});

describe("configureTailscale", () => {
  test("persists enabled + auth key and reports restart_required on enable change", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const res = await configureTailscale(platform, { enabled: true, authKey: "tskey-xyz" });
    expect(res.status).toBe("success");
    expect(res.enabled).toBe(true);
    expect(res.auth_key_configured).toBe(true);
    expect(res.restart_required).toBe(true);

    const saved = await platform.storage.settings.read("settings");
    expect(saved).toMatchObject({ tailscaleEnabled: true, tailscaleAuthKey: "tskey-xyz" });
  });

  test("ignores masked auth key values", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    await platform.storage.settings.write("settings", { tailscaleAuthKey: "tskey-real" });
    const res = await configureTailscale(platform, { authKey: "tskey-****" });
    expect(res.auth_key_configured).toBe(true);
    const saved = await platform.storage.settings.read("settings");
    expect(saved).toMatchObject({ tailscaleAuthKey: "tskey-real" });
  });

  test("no-op body reports no changes and no restart", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const res = await configureTailscale(platform, {});
    expect(res.message).toBe("No changes to apply");
    expect(res.restart_required).toBe(false);
  });

  test("merges into existing settings without clobbering unrelated keys", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    await platform.storage.settings.write("settings", { meticulousIp: "1.2.3.4" });
    await configureTailscale(platform, { enabled: true });
    const saved = await platform.storage.settings.read("settings");
    expect(saved).toMatchObject({ meticulousIp: "1.2.3.4", tailscaleEnabled: true });
  });
});

describe("handleTailscaleRoutes", () => {
  test("GET /api/tailscale-status returns the status JSON", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const res = await handleTailscaleRoutes(
      new Request("http://localhost/api/tailscale-status"),
      platform,
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.json()).toMatchObject({ installed: false, enabled: false });
  });

  test("POST /api/tailscale/configure persists and returns success", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const res = await handleTailscaleRoutes(
      new Request("http://localhost/api/tailscale/configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      platform,
    );
    expect(res!.status).toBe(200);
    expect(await res!.json()).toMatchObject({ status: "success", enabled: true });
  });

  test("returns null for a non-tailscale route", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const res = await handleTailscaleRoutes(
      new Request("http://localhost/api/settings"),
      platform,
    );
    expect(res).toBeNull();
  });

  test("rejects malformed JSON on configure", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const res = await handleTailscaleRoutes(
      new Request("http://localhost/api/tailscale/configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      platform,
    );
    expect(res!.status).toBe(400);
  });
});
