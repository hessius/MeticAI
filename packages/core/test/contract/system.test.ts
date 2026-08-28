import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedAI } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { Platform } from "../../src/platform";

function get(path: string): Request {
  return new Request(`http://x${path}`);
}

function post(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("system: GET /api/settings", () => {
  test("reports configured AI + machine host, defaults for the rest", async () => {
    const p = makeMockPlatform({ ai: scriptedAI("") });
    const res = await handle(get("/api/settings"), p);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.geminiApiKeyConfigured).toBe(true);
    expect(body.geminiApiKeyMasked).toBe(true);
    // The raw key is never returned.
    expect(body.geminiApiKey).toBe("********");
    expect(body.meticulousIp).toBe("machine.test");
    expect(body.authorName).toBe("");
    expect(body.geminiModel).toBe("gemini-2.5-flash");
    expect(body.mqttEnabled).toBe(true);
    expect(body.aiProvider).toBe("gemini");
  });

  test("reports not-configured when AI is unavailable and never leaks a key", async () => {
    const p = makeMockPlatform(); // default unconfiguredAI
    const res = await handle(get("/api/settings"), p);
    const body = await res.json();
    expect(body.geminiApiKeyConfigured).toBe(false);
    expect(body.geminiApiKeyMasked).toBe(false);
    expect(body.geminiApiKey).toBe("");
  });

  test("reflects the resolved provider model when set", async () => {
    const p = makeMockPlatform({
      ai: scriptedAI(""),
      secrets: { getAIConfig: () => ({ provider: "gemini", apiKey: "k", model: "gemini-3.1-pro" }) },
    });
    const body = await (await handle(get("/api/settings"), p)).json();
    expect(body.geminiModel).toBe("gemini-3.1-pro");
  });
});

describe("system: POST /api/settings", () => {
  test("persists author/model/mqtt and round-trips on GET", async () => {
    const p = makeMockPlatform({ ai: scriptedAI("") });
    const save = await handle(
      post("/api/settings", { authorName: "Jesper", geminiModel: "gemini-3.1-flash", mqttEnabled: false }),
      p,
    );
    expect(save.status).toBe(200);
    expect(await save.json()).toEqual({ status: "ok" });

    const body = await (await handle(get("/api/settings"), p)).json();
    expect(body.authorName).toBe("Jesper");
    // getAIConfig().model (unset here) falls back to the stored model.
    expect(body.geminiModel).toBe("gemini-3.1-flash");
    expect(body.mqttEnabled).toBe(false);
  });

  test("stored key never surfaces raw; only the configured flag changes", async () => {
    // Provider stays unconfigured (env-managed), but a UI-entered key is stored.
    const p = makeMockPlatform();
    await handle(post("/api/settings", { geminiApiKey: "super-secret" }), p);
    const body = await (await handle(get("/api/settings"), p)).json();
    expect(body.geminiApiKey).not.toBe("super-secret");
  });

  test("rejects a malformed JSON body", async () => {
    const p = makeMockPlatform();
    const res = await handle(post("/api/settings", "not json{"), p);
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe("error");
  });
});

describe("system: GET /api/network-ip", () => {
  test("returns the machine host", async () => {
    const res = await handle(get("/api/network-ip"), makeMockPlatform());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ip: "machine.test" });
  });
});

describe("system: GET /api/version", () => {
  test("returns the platform appVersion and server mode", async () => {
    const p: Platform = makeMockPlatform({ appVersion: "3.0.0-test" });
    const res = await handle(get("/api/version"), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "3.0.0-test", mode: "server" });
  });

  test("falls back to 'unknown' when no appVersion is provided", async () => {
    const body = await (await handle(get("/api/version"), makeMockPlatform())).json();
    expect(body.version).toBe("unknown");
  });
});

describe("system: GET /api/available-models", () => {
  test("returns discovered models with the current model when configured", async () => {
    const p = makeMockPlatform({
      ai: {
        isConfigured: () => true,
        generateText: async () => ({ text: "" }),
        listModels: async () => [
          { id: "gemini-3.1-pro", display_name: "Gemini 3.1 Pro", description: "" },
        ],
        currentModel: () => "gemini-3.1-pro",
      },
    });
    const body = await (await handle(get("/api/available-models"), p)).json();
    expect(body.current).toBe("gemini-3.1-pro");
    expect(body.models).toEqual([
      { id: "gemini-3.1-pro", display_name: "Gemini 3.1 Pro", description: "" },
    ]);
  });

  test("falls back to the static list when unconfigured", async () => {
    const body = await (await handle(get("/api/available-models"), makeMockPlatform())).json();
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0].id).toContain("gemini");
  });

  test("falls back to the static list when discovery throws", async () => {
    const p = makeMockPlatform({
      ai: {
        isConfigured: () => true,
        generateText: async () => ({ text: "" }),
        listModels: async () => {
          throw new Error("boom");
        },
      },
    });
    const body = await (await handle(get("/api/available-models"), p)).json();
    expect(body.models.length).toBeGreaterThan(0);
  });
});

describe("system: admin stubs", () => {
  test("update-method reports manual with no self-update", async () => {
    const body = await (await handle(get("/api/update-method"), makeMockPlatform())).json();
    expect(body).toEqual({ method: "manual", can_trigger_update: false });
  });

  test("tailscale-status reports disabled/uninstalled", async () => {
    const body = await (await handle(get("/api/tailscale-status"), makeMockPlatform())).json();
    expect(body).toEqual({ enabled: false, installed: false });
  });

  test("restart is not available (501)", async () => {
    const res = await handle(post("/api/restart", {}), makeMockPlatform());
    expect(res.status).toBe(501);
  });
});

describe("system: update status", () => {
  const RELEASES = [
    { tag_name: "v9.9.9", prerelease: false, html_url: "https://gh/9.9.9" },
    { tag_name: "v9.9.9-beta.1", prerelease: true, html_url: "https://gh/beta" },
  ];

  function withStubbedFetch<T>(releases: unknown, run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(releases), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    return run().finally(() => {
      globalThis.fetch = original;
    });
  }

  test("GET /api/status reports an available update when GitHub is ahead", async () => {
    const p = makeMockPlatform({ appVersion: "1.0.0" });
    const body = await withStubbedFetch(RELEASES, async () =>
      (await handle(get("/api/status"), p)).json(),
    );
    expect(body.update_available).toBe(true);
    expect(body.current_version).toBe("1.0.0");
    expect(body.latest_stable_version).toBe("9.9.9");
    expect(body.latest_beta_version).toBe("9.9.9-beta.1");
    expect(body.release_url).toBe("https://gh/9.9.9");
  });

  test("GET /api/status reports no update when current is newest", async () => {
    const p = makeMockPlatform({ appVersion: "99.0.0" });
    const body = await withStubbedFetch(RELEASES, async () =>
      (await handle(get("/api/status"), p)).json(),
    );
    expect(body.update_available).toBe(false);
  });

  test("POST /api/check-updates sets fresh_check", async () => {
    const p = makeMockPlatform({ appVersion: "1.0.0" });
    const body = await withStubbedFetch(RELEASES, async () =>
      (await handle(post("/api/check-updates", {}), p)).json(),
    );
    expect(body.fresh_check).toBe(true);
    expect(body.update_available).toBe(true);
  });

  test("GET /api/status degrades safely when GitHub is unreachable", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const body = await (await handle(get("/api/status"), makeMockPlatform({ appVersion: "1.0.0" }))).json();
      expect(body.update_available).toBe(false);
      expect(body.error).toBeDefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("POST /api/trigger-update returns 503 (no Watchtower)", async () => {
    const res = await handle(post("/api/trigger-update", {}), makeMockPlatform());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("docker compose");
  });

  test("POST /api/tailscale/configure is 501 (bring-up not on this server)", async () => {
    const res = await handle(post("/api/tailscale/configure", { enabled: true }), makeMockPlatform());
    expect(res.status).toBe(501);
  });
});
