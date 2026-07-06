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
