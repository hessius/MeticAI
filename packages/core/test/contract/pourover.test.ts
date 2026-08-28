import { describe, test, expect } from "vitest";
import { makeMockPlatform } from "../mockPlatform";
import { handle } from "../../src/handler";

const PATH = "/api/pour-over/preferences";

function get(): Request {
  return new Request(`http://x${PATH}`);
}

function put(body: unknown): Request {
  return new Request(`http://x${PATH}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const DEFAULT_MODE = {
  autoStart: true,
  bloomEnabled: true,
  bloomSeconds: 30,
  bloomWeightMultiplier: 2,
  machineIntegration: false,
  doseGrams: null,
  brewRatio: null,
};

describe("pour-over preferences: GET defaults", () => {
  test("returns per-mode defaults when nothing is stored (ratio defaults to 18g/15)", async () => {
    const res = await handle(get(), makeMockPlatform());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      free: DEFAULT_MODE,
      ratio: { ...DEFAULT_MODE, doseGrams: 18, brewRatio: 15 },
      recipe: { machineIntegration: false, autoStart: true, progressionMode: "weight" },
    });
  });
});

describe("pour-over preferences: PUT + round-trip", () => {
  test("normalizes, persists, and echoes; GET returns the saved values", async () => {
    const p = makeMockPlatform();
    const saved = await handle(
      put({
        free: { autoStart: false, doseGrams: 20 },
        ratio: { brewRatio: 16 },
        recipe: { progressionMode: "time" },
      }),
      p,
    );
    expect(saved.status).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody.free.autoStart).toBe(false);
    expect(savedBody.free.doseGrams).toBe(20);
    expect(savedBody.ratio.brewRatio).toBe(16);
    expect(savedBody.recipe.progressionMode).toBe("time");
    // Unspecified keys fall back to defaults.
    expect(savedBody.free.bloomSeconds).toBe(30);

    const fetched = await (await handle(get(), p)).json();
    expect(fetched).toEqual(savedBody);
  });

  test("unknown keys are dropped from the normalized result", async () => {
    const res = await handle(put({ free: { bogus: 1, autoStart: false } }), makeMockPlatform());
    const body = await res.json();
    expect(body.free.bogus).toBeUndefined();
    expect(body.free.autoStart).toBe(false);
  });
});

describe("pour-over preferences: validation", () => {
  test("rejects a wrong-typed field with 400 { detail: 'Invalid preferences' }", async () => {
    const res = await handle(put({ free: { autoStart: "yes" } }), makeMockPlatform());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ detail: "Invalid preferences" });
  });

  test("rejects an invalid progressionMode with 400", async () => {
    const res = await handle(put({ recipe: { progressionMode: "sideways" } }), makeMockPlatform());
    expect(res.status).toBe(400);
  });

  test("rejects invalid JSON with 400", async () => {
    const res = await handle(put("{ not json"), makeMockPlatform());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ detail: "Invalid preferences" });
  });
});

describe("pour-over active flows", () => {
  function recordingMachine() {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    let ok = true;
    return {
      calls,
      setOk: (v: boolean) => { ok = v; },
      machine: {
        getBaseUrl: () => "http://machine.test:8080",
        fetch: async (path: string, init?: RequestInit) => {
          calls.push({ path, init });
          return new Response(JSON.stringify({ ok }), {
            status: ok ? 200 : 502,
            headers: { "content-type": "application/json" },
          });
        },
      },
    };
  }

  test("POST /api/pour-over/prepare adapts and loads a profile on the machine", async () => {
    const m = recordingMachine();
    const p = makeMockPlatform({ machine: m.machine });
    const res = await handle(
      new Request("http://x/api/pour-over/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_weight: 250, bloom_enabled: true, bloom_seconds: 40 }),
      }),
      p,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.profile_id).toBe("string");
    expect(body.profile_name).toBe("MeticAI Ratio Pour-Over");
    expect(m.calls[0]?.path).toBe("/api/v1/profile/load");
    expect(m.calls[0]?.init?.method).toBe("POST");
    const loaded = JSON.parse(String(m.calls[0]?.init?.body));
    expect(loaded.final_weight).toBe(250);
    expect(loaded.stages[0].name).toBe("Bloom (40s)");
  });

  test("POST /api/pour-over/prepare returns 502 when the machine load fails", async () => {
    const m = recordingMachine();
    m.setOk(false);
    const p = makeMockPlatform({ machine: m.machine });
    const res = await handle(
      new Request("http://x/api/pour-over/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_weight: 300 }),
      }),
      p,
    );
    expect(res.status).toBe(502);
  });

  test("POST /api/pour-over/prepare-recipe loads a known recipe, 404s an unknown one", async () => {
    const m = recordingMachine();
    const p = makeMockPlatform({ machine: m.machine });
    const missing = await handle(
      new Request("http://x/api/pour-over/prepare-recipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe_slug: "does-not-exist" }),
      }),
      p,
    );
    expect(missing.status).toBe(404);

    const ok = await handle(
      new Request("http://x/api/pour-over/prepare-recipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe_slug: "4-6-method" }),
      }),
      p,
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.profile_name).toContain("MeticAI Recipe:");
    expect(m.calls.at(-1)?.path).toBe("/api/v1/profile/load");
  });

  test("cleanup / force-cleanup / active return stable no-op responses", async () => {
    const p = makeMockPlatform();
    const cleanup = await handle(new Request("http://x/api/pour-over/cleanup", { method: "POST" }), p);
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toEqual({ status: "ok" });

    const force = await handle(new Request("http://x/api/pour-over/force-cleanup", { method: "POST" }), p);
    expect(force.status).toBe(200);
    expect(await force.json()).toEqual({ status: "ok" });

    const active = await handle(new Request("http://x/api/pour-over/active"), p);
    expect(active.status).toBe(200);
    expect(await active.json()).toEqual({ active: false });
  });
});
