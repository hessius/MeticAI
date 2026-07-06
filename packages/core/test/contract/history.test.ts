import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { Platform } from "../../src/platform";

const T = 1_700_000_000; // seconds
const ISO = new Date(T * 1000).toISOString();

const SHOTS = [
  { id: "shot-a", time: T, profile: { id: "p1", name: "Turbo Bloom" }, data: [{ shot: { weight: 36 }, profile_time: 28000 }] },
  { id: "shot-b", time: T - 3600, profile: { id: "p2", name: "Slow Ramp" }, data: [{ shot: { weight: 40 }, time: 32000 }] },
];

function machinePlatform(overrides: Partial<Platform> = {}): Platform {
  return makeMockPlatform({
    clock: () => T * 1000,
    machine: scriptedMachine({ "/api/v1/history": SHOTS }),
    ...overrides,
  });
}

function req(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://x${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

describe("history: GET /api/history", () => {
  test("returns normalized, paginated machine shots", async () => {
    const res = await handle(req("/api/history?limit=1&offset=0"), machinePlatform());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      id: "shot-a",
      profile_name: "Turbo Bloom",
      created_at: ISO,
      profile_json: { id: "p1", name: "Turbo Bloom" },
      notes: null,
      notes_updated_at: null,
      reply: "",
    });
  });

  test("includes the AI description from storage.descriptions when present", async () => {
    const p = machinePlatform();
    await p.storage.descriptions.write("Turbo Bloom", "A punchy chocolate shot.");
    const body = await (await handle(req("/api/history"), p)).json();
    const entry = body.entries.find((e: { id: string }) => e.id === "shot-a");
    expect(entry.reply).toBe("A punchy chocolate shot.");
  });
});

describe("history: DELETE /api/history/{id} (tombstone)", () => {
  test("hides a shot locally and 404s if already gone", async () => {
    const p = machinePlatform();
    const del = await handle(req("/api/history/shot-a", "DELETE"), p);
    expect(del.status).toBe(200);
    expect((await del.json()).status).toBe("success");

    const list = await (await handle(req("/api/history"), p)).json();
    expect(list.total).toBe(1);
    expect(list.entries.map((e: { id: string }) => e.id)).toEqual(["shot-b"]);

    const again = await handle(req("/api/history/shot-a", "DELETE"), p);
    expect(again.status).toBe(404);
  });

  test("DELETE /api/history tombstones all visible shots", async () => {
    const p = machinePlatform();
    const res = await handle(req("/api/history", "DELETE"), p);
    expect(res.status).toBe(200);
    const list = await (await handle(req("/api/history"), p)).json();
    expect(list.total).toBe(0);
  });
});

describe("history: GET /api/history/{id}", () => {
  test("returns a single normalized entry", async () => {
    const body = await (await handle(req("/api/history/shot-b"), machinePlatform())).json();
    expect(body).toMatchObject({ id: "shot-b", profile_name: "Slow Ramp" });
    expect(body.profile_json).toEqual({ id: "p2", name: "Slow Ramp" });
  });

  test("404 for an unknown id", async () => {
    const res = await handle(req("/api/history/nope"), machinePlatform());
    expect(res.status).toBe(404);
  });
});

describe("history: notes", () => {
  test("PATCH then GET round-trips per-shot notes", async () => {
    const p = machinePlatform();
    const save = await handle(req("/api/history/shot-a/notes", "PATCH", { notes: "grind finer" }), p);
    expect(save.status).toBe(200);
    const saved = await save.json();
    expect(saved).toMatchObject({ status: "success", notes: "grind finer", notes_updated_at: ISO });

    const got = await (await handle(req("/api/history/shot-a/notes"), p)).json();
    expect(got).toEqual({ status: "success", notes: "grind finer", notes_updated_at: ISO });

    // Notes also surface on the entry + list view.
    const entry = await (await handle(req("/api/history/shot-a"), p)).json();
    expect(entry.notes).toBe("grind finer");
  });

  test("deleting a shot clears its notes", async () => {
    const p = machinePlatform();
    await handle(req("/api/history/shot-a/notes", "PATCH", { notes: "x" }), p);
    await handle(req("/api/history/shot-a", "DELETE"), p);
    const got = await (await handle(req("/api/history/shot-a/notes"), p)).json();
    expect(got.notes).toBe(null);
  });
});

describe("history: GET /api/history/{id}/json", () => {
  test("returns the raw profile json", async () => {
    const body = await (await handle(req("/api/history/shot-a/json"), machinePlatform())).json();
    expect(body).toEqual({ id: "p1", name: "Turbo Bloom" });
  });
});

describe("history: machine unreachable", () => {
  test("GET degrades to an empty history", async () => {
    const res = await handle(req("/api/history"), makeMockPlatform()); // unwired machine
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ entries: [], total: 0 });
  });
});
