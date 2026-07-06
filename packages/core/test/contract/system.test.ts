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
