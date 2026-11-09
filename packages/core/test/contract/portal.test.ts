import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { Platform } from "../../src/platform";

const T0 = 1_700_000_000; // machine `time` is epoch seconds
const SHOT = "/api/portal/shots/2023-11-14/shot_001.json";

/** A machine history with one shot whose cup fills 0→40 g over 30 s. */
function machineWithShot(file = "shot_001.json", time = T0) {
  const data = Array.from({ length: 61 }, (_, i) => ({
    status: i < 56 ? "Extract" : "retracting",
    time: i * 500,
    profile_time: i < 56 ? i * 500 : 55 * 500,
    shot: { weight: Math.min(40, Math.max(0, (i - 10) * (40 / 45))), pressure: 8, flow: 2 },
  }));
  return scriptedMachine({
    "/api/v1/history": { history: [{ id: "abc", time, file, name: "Blooming", profile: { name: "Blooming" }, data }] },
    "/api/v1/history/stats": { totalSavedShots: 1 },
  });
}

function portalSamples(peak = 3) {
  return Array.from({ length: 241 }, (_, i) => {
    const t = i / 8;
    return { t, ec: t < 5 ? 0 : peak * Math.exp(-(t - 5) / 12) + 0.2, tOut: 60 };
  });
}

function json(method: string, path: string, body?: unknown): Request {
  return new Request(`http://x${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function platformWithMachine(): Platform {
  return makeMockPlatform({ clock: () => (T0 + 60) * 1000, machine: machineWithShot() });
}

describe("portal: empty state", () => {
  test("GET summaries is an empty map", async () => {
    const res = await handle(new Request("http://x/api/portal/shots"), makeMockPlatform());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", shots: {} });
  });

  test("GET a shot with no recording returns nulls", async () => {
    const res = await handle(new Request(`http://x${SHOT}`), makeMockPlatform());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recording).toBeNull();
    expect(body.analysis).toBeNull();
    expect(body.coffees).toEqual([]);
  });

  test("PATCH and DELETE on a missing recording are 404", async () => {
    expect((await handle(json("PATCH", SHOT, { coffee: "x" }), makeMockPlatform())).status).toBe(404);
    expect((await handle(json("DELETE", SHOT), makeMockPlatform())).status).toBe(404);
  });

  test("unrelated paths fall through", async () => {
    const res = await handle(new Request("http://x/api/portals"), makeMockPlatform());
    expect(res.status).toBe(404);
  });
});

describe("portal: PUT validation", () => {
  test("rejects a non-object body, bad samples and too few samples with 422", async () => {
    const p = makeMockPlatform();
    expect((await handle(json("PUT", SHOT, [1, 2]), p)).status).toBe(422);
    expect((await handle(json("PUT", SHOT, { samples: [{ t: "a", ec: 1 }, { t: 1, ec: 1 }] }), p)).status).toBe(422);
    expect((await handle(json("PUT", SHOT, { samples: [{ t: 0, ec: 1 }] }), p)).status).toBe(422);
    const res = await handle(json("PUT", SHOT, { samples: [{ t: 0, ec: -1 }, { t: 1, ec: 1 }] }), p);
    expect(res.status).toBe(422);
    expect((await res.json()).detail).toMatch(/sample\.ec/);
  });

  test("rejects malformed JSON with 422", async () => {
    const req = new Request(`http://x${SHOT}`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{nope" });
    expect((await handle(req, makeMockPlatform())).status).toBe(422);
  });
});

describe("portal: store, analyse, read", () => {
  test("PUT stores the recording and analyses it against the machine's weight curve", async () => {
    const p = platformWithMachine();
    const res = await handle(json("PUT", SHOT, { samples: portalSamples(), startedAt: T0 * 1000, deviceName: "PORTAL-1", coffee: " Hatch Supernova " }), p);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recording.key).toBe("2023-11-14/shot_001.json");
    expect(body.recording.samples.length).toBe(241);
    expect(body.recording.coffee).toBe("Hatch Supernova");
    expect(body.recording.device_name).toBe("PORTAL-1");
    expect(body.recording.stop_time_sec).toBeNull();
    expect(body.analysis.status).toBe("ok");
    expect(body.analysis.totalMassG).toBeCloseTo(40, 5);
    expect(body.analysis.meanEcPerG).toBeGreaterThan(0.5);
    expect(body.recording.analysis.meanEcPerG).toBe(body.analysis.meanEcPerG);
    // no readings yet → no estimate, but a reason
    expect(body.estimate.tdsPct).toBeNull();
    expect(body.estimate.flags[0]).toMatch(/No refractometer/);
    expect(body.coffees).toEqual(["Hatch Supernova"]);
  });

  test("without the machine the recording is kept and analysed on a later read", async () => {
    const noMachine = makeMockPlatform({ clock: () => (T0 + 60) * 1000 });
    const put = await handle(json("PUT", SHOT, { samples: portalSamples(), startedAt: T0 * 1000 }), noMachine);
    expect(put.status).toBe(200);
    const first = await put.json();
    expect(first.analysis).toBeNull();
    expect(first.recording.analysis).toBeNull();
    // same storage, machine now reachable
    const withMachine = makeMockPlatform({ storage: noMachine.storage, clock: noMachine.clock, machine: machineWithShot() });
    const get = await handle(new Request(`http://x${SHOT}`), withMachine);
    const body = await get.json();
    expect(body.analysis.status).toBe("ok");
    expect(body.recording.analysis.meanEcPerG).toBeGreaterThan(0);
  });

  test("summaries list the stored shot with its EC/g and sample count", async () => {
    const p = platformWithMachine();
    await handle(json("PUT", SHOT, { samples: portalSamples(), startedAt: T0 * 1000 }), p);
    const res = await handle(new Request("http://x/api/portal/shots"), p);
    const body = await res.json();
    const s = body.shots["2023-11-14/shot_001.json"];
    expect(s.sample_count).toBe(241);
    expect(s.status).toBe("ok");
    expect(s.mean_ec_per_g).toBeGreaterThan(0);
    expect(s.tds_pct).toBeNull();
    expect(s.estimate_tds_pct).toBeNull();
  });

  test("DELETE removes it", async () => {
    const p = platformWithMachine();
    await handle(json("PUT", SHOT, { samples: portalSamples(), startedAt: T0 * 1000 }), p);
    expect((await handle(json("DELETE", SHOT), p)).status).toBe(200);
    expect((await handle(json("DELETE", SHOT), p)).status).toBe(404);
    expect((await (await handle(new Request(`http://x${SHOT}`), p)).json()).recording).toBeNull();
  });
});

describe("portal: readings, calibration and estimates", () => {
  test("PATCH sets a reading with EY, and clearing it removes it", async () => {
    const p = platformWithMachine();
    await handle(json("PUT", SHOT, { samples: portalSamples(), startedAt: T0 * 1000, doseG: 18 }), p);
    const res = await handle(json("PATCH", SHOT, { reading: { tdsPct: 9.2 } }), p);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recording.reading.tds_pct).toBe(9.2);
    expect(body.recording.reading.beverage_g).toBeNull();
    expect(body.recording.reading.ey_pct).toBeCloseTo((9.2 * 40) / 18, 3);
    expect(body.recording.reading.at).toBe(new Date((T0 + 60) * 1000).toISOString());
    const cleared = await (await handle(json("PATCH", SHOT, { reading: null }), p)).json();
    expect(cleared.recording.reading).toBeNull();
  });

  test("an out-of-range reading is 422", async () => {
    const p = platformWithMachine();
    await handle(json("PUT", SHOT, { samples: portalSamples(), startedAt: T0 * 1000 }), p);
    expect((await handle(json("PATCH", SHOT, { reading: { tdsPct: 45 } }), p)).status).toBe(422);
    expect((await handle(json("PATCH", SHOT, { reading: { tdsPct: "9" } }), p)).status).toBe(422);
  });

  test("readings on other shots of the same coffee calibrate this one; its own reading is left out", async () => {
    // One machine history that holds six shots at different times/files.
    const files = Array.from({ length: 6 }, (_, i) => `shot_00${i}.json`);
    const history = files.map((file, i) => ({
      id: `id${i}`,
      time: T0 + i * 3600,
      file,
      profile: { name: "Blooming" },
      data: Array.from({ length: 61 }, (_, j) => ({
        status: j < 56 ? "Extract" : "retracting",
        time: j * 500,
        profile_time: j < 56 ? j * 500 : 55 * 500,
        shot: { weight: Math.min(40, Math.max(0, (j - 10) * (40 / 45))) },
      })),
    }));
    const p = makeMockPlatform({
      clock: () => (T0 + 86400) * 1000,
      machine: scriptedMachine({ "/api/v1/history": { history }, "/api/v1/history/stats": { totalSavedShots: 6 } }),
    });
    // Five reference shots: stronger EC ↔ higher TDS, same coffee.
    for (let i = 0; i < 5; i++) {
      const date = new Date((T0 + i * 3600) * 1000).toISOString().split("T")[0];
      const path = `/api/portal/shots/${date}/${files[i]}`;
      const put = await handle(json("PUT", path, { samples: portalSamples(2.5 + i * 0.25), startedAt: (T0 + i * 3600) * 1000, coffee: "Hatch", doseG: 18 }), p);
      const stored = await put.json();
      const tds = 3.1 * stored.analysis.meanEcPerG; // a clean proportional relation
      await handle(json("PATCH", path, { reading: { tdsPct: tds } }), p);
    }
    // The sixth shot has no reading: it should get an estimate from "this coffee".
    const date5 = new Date((T0 + 5 * 3600) * 1000).toISOString().split("T")[0];
    const path5 = `/api/portal/shots/${date5}/${files[5]}`;
    const res = await handle(json("PUT", path5, { samples: portalSamples(3.0), startedAt: (T0 + 5 * 3600) * 1000, coffee: "hatch", doseG: 18 }), p);
    const body = await res.json();
    expect(body.fit.calibrated).toBe(true);
    expect(body.fit.pool).toBe("coffee");
    expect(body.fit.shotCount).toBe(5);
    expect(body.fit.preliminary).toBe(false);
    expect(body.fit.proportional.k).toBeCloseTo(3.1, 3);
    expect(body.estimate.tdsPct).toBeCloseTo(3.1 * body.analysis.meanEcPerG, 3);
    expect(body.estimate.eyPct).toBeGreaterThan(0);
    expect(body.estimate.flags).toEqual([]);

    // A different coffee borrows from all coffees and says so.
    const other = await handle(json("PATCH", path5, { coffee: "Revolver" }), p);
    const otherBody = await other.json();
    expect(otherBody.fit.pool).toBe("all");
    expect(otherBody.estimate.flags[0]).toMatch(/Borrowed from all coffees/);

    // The calibration endpoint reports the same fit; summaries carry estimates.
    const cal = await (await handle(new Request("http://x/api/portal/calibration?coffee=Hatch"), p)).json();
    expect(cal.fit.shotCount).toBe(5);
    expect(cal.points.length).toBe(5);
    expect(cal.coffees).toContain("Revolver");
    const summaries = await (await handle(new Request("http://x/api/portal/shots"), p)).json();
    const s5 = summaries.shots[`${date5}/${files[5]}`];
    expect(s5.tds_pct).toBeNull();
    expect(s5.estimate_tds_pct).toBeGreaterThan(0);
    expect(s5.coffee).toBe("Revolver");
  });

  test("mode=coffee refuses to borrow", async () => {
    const p = platformWithMachine();
    await handle(json("PUT", SHOT, { samples: portalSamples(), startedAt: T0 * 1000, coffee: "Solo" }), p);
    const body = await (await handle(new Request(`http://x${SHOT}?mode=coffee`), p)).json();
    expect(body.fit.pool).toBe("coffee");
    expect(body.fit.calibrated).toBe(false);
    expect(body.estimate.tdsPct).toBeNull();
  });
});
