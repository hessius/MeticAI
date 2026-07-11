import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { Platform } from "../../src/platform";

const T = 1_700_000_000; // seconds

const SHOTS = [
  {
    id: "shot-a",
    time: T,
    file: "shot-a.shot",
    profile: {
      id: "p1",
      name: "Turbo Bloom",
      author: "Barista",
      temperature: 93,
      final_weight: 36,
      stages: [{ name: "Preinfuse", type: "flow", key: "pi" }],
    },
    data: [
      { status: "heating", profile_time: 0, shot: { pressure: 0, flow: 0, weight: 0 }, sensors: { external_1: 90 } },
      { status: "extracting", profile_time: 28000, shot: { pressure: 6, flow: 2.1, weight: 36, gravimetric_flow: 1.8 }, sensors: { external_1: 93 } },
    ],
  },
  {
    id: "shot-b",
    time: T - 3600,
    profile: { id: "p2", name: "Slow Ramp" },
    data: [{ time: 32000, shot: { weight: 40 } }],
  },
];

function machinePlatform(overrides: Partial<Platform> = {}): Platform {
  return makeMockPlatform({
    clock: () => T * 1000,
    machine: scriptedMachine({ "/api/v1/history": SHOTS }),
    ...overrides,
  });
}

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: "GET" });
}

describe("shots-read: GET /api/last-shot", () => {
  test("returns the most-recent normalized shot", async () => {
    const body = await (await handle(get("/api/last-shot"), machinePlatform())).json();
    expect(body).toMatchObject({
      profile_name: "Turbo Bloom",
      filename: "shot-a.shot",
      timestamp: T,
      final_weight: 36,
      total_time: 28,
    });
  });

  test("404 when there are no shots", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({ "/api/v1/history": [] }) });
    const res = await handle(get("/api/last-shot"), p);
    expect(res.status).toBe(404);
  });

  test("hidden shots are excluded", async () => {
    const p = machinePlatform();
    await handle(new Request("http://x/api/history/shot-a", { method: "DELETE" }), p);
    const body = await (await handle(get("/api/last-shot"), p)).json();
    expect(body.filename).toBe("shot-b.json");
  });
});

describe("shots-read: GET /api/shots/dates", () => {
  test("returns distinct dates, newest first", async () => {
    const body = await (await handle(get("/api/shots/dates"), machinePlatform())).json();
    expect(Array.isArray(body.dates)).toBe(true);
    expect(body.dates).toEqual([...body.dates].sort((a: string, b: string) => b.localeCompare(a)));
  });
});

describe("shots-read: GET /api/shots/recent", () => {
  test("returns a flat list with annotation flags", async () => {
    const body = await (await handle(get("/api/shots/recent"), machinePlatform())).json();
    expect(body.shots).toHaveLength(2);
    expect(body.shots[0]).toMatchObject({
      profile_name: "Turbo Bloom",
      profile_id: "p1",
      filename: "shot-a.shot",
      final_weight: 36,
      total_time: 28,
      has_annotation: false,
    });
  });

  test("reflects an existing annotation", async () => {
    const p = machinePlatform();
    const date = new Date(T * 1000).toISOString().split("T")[0];
    await handle(
      new Request(`http://x/api/shots/${date}/shot-a.shot/annotation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: 4 }),
      }),
      p,
    );
    const body = await (await handle(get("/api/shots/recent"), p)).json();
    const shotA = body.shots.find((s: { filename: string }) => s.filename === "shot-a.shot");
    expect(shotA.has_annotation).toBe(true);
  });
});

describe("shots-read: GET /api/shots/recent/by-profile", () => {
  test("groups shots by profile name", async () => {
    const body = await (await handle(get("/api/shots/recent/by-profile"), machinePlatform())).json();
    const names = body.profiles.map((p: { profile_name: string }) => p.profile_name).sort();
    expect(names).toEqual(["Slow Ramp", "Turbo Bloom"]);
    const turbo = body.profiles.find((p: { profile_name: string }) => p.profile_name === "Turbo Bloom");
    expect(turbo.shot_count).toBe(1);
  });
});

describe("shots-read: GET /api/shots/by-profile/{name}", () => {
  test("filters and pages by profile name", async () => {
    const body = await (await handle(get("/api/shots/by-profile/Turbo%20Bloom?limit=5"), machinePlatform())).json();
    expect(body.profile_name).toBe("Turbo Bloom");
    expect(body.count).toBe(1);
    expect(body.limit).toBe(5);
    expect(body.shots[0]).toMatchObject({ filename: "shot-a.shot", final_weight: 36 });
  });

  test("defaults the limit to 20", async () => {
    const body = await (await handle(get("/api/shots/by-profile/Turbo%20Bloom"), machinePlatform())).json();
    expect(body.limit).toBe(20);
  });
});

describe("shots-read: GET /api/shots/data/{date}/{filename}", () => {
  test("returns converted telemetry series", async () => {
    const date = new Date(T * 1000).toISOString().split("T")[0];
    const res = await handle(get(`/api/shots/data/${date}/shot-a.shot`), machinePlatform());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.profile.name).toBe("Turbo Bloom");
    expect(body.data.data.time).toEqual([0, 28]);
    expect(body.data.data.pressure).toEqual([0, 6]);
    expect(body.data.data.weight).toEqual([0, 36]);
    expect(body.data.data.gravimetric_flow).toEqual([0, 1.8]);
    expect(body.data.data.temperature).toEqual([90, 93]);
    expect(body.data.final_weight).toBe(36);
  });

  test("404 for an unknown shot", async () => {
    const res = await handle(get("/api/shots/data/2000-01-01/nope.shot"), machinePlatform());
    expect(res.status).toBe(404);
  });
});

describe("shots read: llm-analysis-cache stub", () => {
  test("GET /api/shots/llm-analysis-cache reports no cache", async () => {
    const res = await handle(new Request("http://x/api/shots/llm-analysis-cache"), makeMockPlatform());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cached: false });
  });
});
