import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { handle } from "@metic/core";
import { getDB, getSetting } from "@/services/storage/AppDatabase";
import type { AIProvider } from "@/services/ai/providers/AIProvider";
import { createBrowserPlatform } from "./browserPlatform";

/**
 * Integration tests for the browser Platform: they run the SHARED
 * `@metic/core` `handle()` against the real IndexedDB-backed platform (over
 * fake-indexeddb) with a fake machine fetch and a scripted AI provider. This
 * proves the platform correctly bridges core to browser storage / machine / AI,
 * complementing the core contract tests (which assert the route logic itself).
 */

async function clearAllStores() {
  const db = await getDB();
  for (const name of [
    "settings",
    "shot-annotations",
    "ai-cache",
    "pour-over-state",
    "dial-in-sessions",
    "profile-images",
  ] as const) {
    const tx = db.transaction(name, "readwrite");
    await tx.store.clear();
    await tx.done;
  }
}

const MACHINE_BASE = "http://machine.test:8080";

const PROFILES = [
  {
    name: "Fruity Turbo",
    temperature: 94,
    final_weight: 40,
    stages: [
      { name: "Preinfusion", type: "flow", dynamics: { points: [[0, 4]], over: "time" } },
      { name: "Infusion", type: "pressure", dynamics: { points: [[0, 6], [10, 6]], over: "time" } },
    ],
  },
  {
    name: "Classic Lever",
    temperature: 92,
    final_weight: 36,
    stages: [
      { name: "Preinfusion", type: "flow", dynamics: { points: [[0, 3]], over: "time" } },
      { name: "Ramp", type: "pressure", dynamics: { points: [[0, 9], [20, 5]], over: "time" } },
    ],
  },
];

/** A fake machine returning the profile catalogue; records the URLs it received. */
function fakeMachine() {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    const path = new URL(url).pathname;
    if (path === "/api/v1/profile/list") {
      return new Response(JSON.stringify(PROFILES), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function makePlatform(overrides: Parameters<typeof createBrowserPlatform>[0] = {}) {
  return createBrowserPlatform({
    machineBaseUrl: () => MACHINE_BASE,
    clock: () => 1_700_000_000_000,
    aiConfigured: () => false,
    ...overrides,
  });
}

beforeEach(async () => {
  localStorage.clear();
  await clearAllStores();
});

describe("browser Platform: annotations (map repo)", () => {
  const ANNOT = "/api/shots/2024-01-15/shot_001.json/annotation";

  it("PATCH persists to IndexedDB and GET round-trips through core", async () => {
    const p = makePlatform();
    const patched = await handle(
      new Request(`http://x${ANNOT}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annotation: "great shot", rating: 4 }),
      }),
      p,
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({
      status: "success",
      annotation: "great shot",
      rating: 4,
      updated_at: new Date(1_700_000_000_000).toISOString(),
    });

    // The document is stored verbatim under the core-namespaced settings key.
    const stored = await getSetting<Record<string, unknown>>("core:annotations");
    expect(stored).toBeTruthy();
    expect(Object.keys(stored!)).toEqual(["2024-01-15/shot_001.json"]);

    const fetched = await handle(new Request(`http://x${ANNOT}`), p);
    expect(await fetched.json()).toMatchObject({ annotation: "great shot", rating: 4 });
  });

  it("DELETE removes the annotation", async () => {
    const p = makePlatform();
    await handle(
      new Request(`http://x${ANNOT}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annotation: "temp", rating: 2 }),
      }),
      p,
    );
    const del = await handle(new Request(`http://x${ANNOT}`, { method: "DELETE" }), p);
    expect(await del.json()).toEqual({ status: "success", deleted: true });
    const after = await handle(new Request(`http://x${ANNOT}`), p);
    expect(await after.json()).toMatchObject({ annotation: null, rating: null });
  });
});

describe("browser Platform: dial-in sessions (map repo)", () => {
  const SESSIONS = "/api/dialin/sessions";
  const COFFEE = { roast_level: "medium", origin: "Ethiopia", process: "washed" };

  it("creates a session, persists it, and reads it back through core", async () => {
    const p = makePlatform();
    const created = await handle(
      new Request(`http://x${SESSIONS}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coffee: COFFEE, profile_name: "Blossom" }),
      }),
      p,
    );
    expect(created.status).toBe(201);
    const session = (await created.json()) as Record<string, unknown>;
    expect(typeof session.id).toBe("string");
    expect(session.coffee).toEqual(COFFEE);

    const stored = await getSetting<Record<string, unknown>>("core:dialin_sessions");
    expect(Object.keys(stored!)).toEqual([session.id]);

    const got = await handle(new Request(`http://x${SESSIONS}/${session.id}`), p);
    expect(got.status).toBe(200);
    expect((await got.json()).id).toBe(session.id);
  });
});

describe("browser Platform: pour-over preferences (singleton repo)", () => {
  const PATH = "/api/pour-over/preferences";

  it("PUT persists a single document and GET round-trips it", async () => {
    const p = makePlatform();
    const putRes = await handle(new Request(`http://x${PATH}`), p);
    const defaults = await putRes.json();
    defaults.free.autoStart = false;
    defaults.free.doseGrams = 20;

    const saved = await handle(
      new Request(`http://x${PATH}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(defaults),
      }),
      p,
    );
    expect(saved.status).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody.free.autoStart).toBe(false);
    expect(savedBody.free.doseGrams).toBe(20);

    const fetched = await handle(new Request(`http://x${PATH}`), p);
    expect(await fetched.json()).toEqual(savedBody);
  });
});

describe("browser Platform: machine fetch bridging", () => {
  it("joins core's machine path onto the resolved base URL", async () => {
    const machine = fakeMachine();
    const p = makePlatform({ fetchImpl: machine.fetchImpl });
    const form = new FormData();
    form.append("tags", "fruity");
    const res = await handle(
      new Request("http://core.test/api/profiles/recommend", { method: "POST", body: form }),
      p,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.recommendations)).toBe(true);
    // Core asked for the catalogue; the platform reached the machine at its base URL.
    expect(machine.urls.some((u) => u.startsWith(`${MACHINE_BASE}/api/v1/profile/list`))).toBe(true);
  });

  it("rejects when no machine base URL is configured", async () => {
    const machine = fakeMachine();
    const p = makePlatform({ fetchImpl: machine.fetchImpl, machineBaseUrl: () => "" });
    await expect(p.machine.fetch("/api/v1/profile/list")).rejects.toThrow(
      /not configured/,
    );
  });
});

describe("browser Platform: AI seam bridging", () => {
  it("delegates generateText to the active provider", async () => {
    const generateText = vi.fn().mockResolvedValue({ text: "hello from provider" });
    const provider = {
      id: "gemini",
      label: "Gemini",
      capabilities: { imageGen: false },
      isConfigured: () => true,
      detectFromKey: () => true,
      generateText,
      listModels: async () => [],
    };
    const p = makePlatform({
      aiConfigured: () => true,
      aiProvider: () => provider as unknown as AIProvider,
    });
    expect(p.ai.isConfigured()).toBe(true);
    const out = await p.ai.generateText({ contents: "hi" });
    expect(out.text).toBe("hello from provider");
    expect(generateText).toHaveBeenCalledWith({ contents: "hi" });
  });
});
