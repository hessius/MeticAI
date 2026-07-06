import { describe, test, expect } from "vitest";
import { makeMockPlatform } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { Platform } from "../../src/platform";

// Use a fixed, non-zero clock so updated_at is a stable, comparable ISO string.
function platformAt(ms: number): Platform {
  return makeMockPlatform({ clock: () => ms });
}

const ISO = new Date(1_700_000_000_000).toISOString();

function patch(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ANNOT = "/api/shots/2024-01-15/shot_001.json/annotation";

describe("annotations: GET single", () => {
  test("returns nulls when no annotation exists", async () => {
    const res = await handle(new Request(`http://x${ANNOT}`), makeMockPlatform());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "success",
      annotation: null,
      rating: null,
      updated_at: null,
    });
  });
});

describe("annotations: PATCH upsert", () => {
  test("saves text and rating together", async () => {
    const p = platformAt(1_700_000_000_000);
    const res = await handle(patch(ANNOT, { annotation: "great shot", rating: 4 }), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "success",
      annotation: "great shot",
      rating: 4,
      updated_at: ISO,
    });
  });

  test("trims whitespace-only text to null and keeps the rating", async () => {
    const p = platformAt(1_700_000_000_000);
    const res = await handle(patch(ANNOT, { annotation: "   ", rating: 3 }), p);
    expect(await res.json()).toEqual({
      status: "success",
      annotation: null,
      rating: 3,
      updated_at: ISO,
    });
  });

  test("omitting rating preserves the existing rating (merge)", async () => {
    const p = platformAt(1_700_000_000_000);
    await handle(patch(ANNOT, { annotation: "first", rating: 5 }), p);
    const res = await handle(patch(ANNOT, { annotation: "updated text" }), p);
    expect(await res.json()).toMatchObject({
      status: "success",
      annotation: "updated text",
      rating: 5,
    });
  });

  test("null rating also preserves the existing rating", async () => {
    const p = platformAt(1_700_000_000_000);
    await handle(patch(ANNOT, { annotation: "first", rating: 2 }), p);
    const res = await handle(patch(ANNOT, { annotation: "second", rating: null }), p);
    expect(await res.json()).toMatchObject({ annotation: "second", rating: 2 });
  });

  test("rating-only PATCH preserves existing text", async () => {
    const p = platformAt(1_700_000_000_000);
    await handle(patch(ANNOT, { annotation: "keep me", rating: 1 }), p);
    const res = await handle(patch(ANNOT, { rating: 5 }), p);
    expect(await res.json()).toMatchObject({ annotation: "keep me", rating: 5 });
  });

  test("clearing both text and rating deletes the entry", async () => {
    const p = platformAt(1_700_000_000_000);
    await handle(patch(ANNOT, { annotation: "temp", rating: 3 }), p);
    // rating-only path with null clears rating; existing text remains, so not deleted yet
    const res = await handle(patch(ANNOT, { annotation: "", rating: null }), p);
    // annotation="" empties text; rating null keeps existing (3) -> still present
    expect(await res.json()).toMatchObject({ annotation: null, rating: 3 });

    // Now clear the rating via rating-only path with no existing text left after we drop text.
    const p2 = platformAt(1_700_000_000_000);
    await handle(patch(ANNOT, { rating: 4 }), p2); // rating only, no text
    const cleared = await handle(patch(ANNOT, { rating: null }), p2);
    expect(await cleared.json()).toEqual({
      status: "success",
      annotation: null,
      rating: null,
      updated_at: null,
    });
    // Confirm it is gone.
    const after = await handle(new Request(`http://x${ANNOT}`), p2);
    expect(await after.json()).toMatchObject({ annotation: null, rating: null });
  });

  test("rejects an out-of-range rating with 422", async () => {
    const res = await handle(patch(ANNOT, { annotation: "x", rating: 9 }), makeMockPlatform());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      status: "error",
      error: "Rating must be between 1 and 5",
    });
  });

  test("rejects a non-integer rating with 422", async () => {
    const res = await handle(patch(ANNOT, { annotation: "x", rating: 2.5 }), makeMockPlatform());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      status: "error",
      error: "Rating must be an integer between 1 and 5",
    });
  });

  test("rejects invalid JSON with 400", async () => {
    const res = await handle(patch(ANNOT, "{not json"), makeMockPlatform());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: "error", error: "Invalid JSON body" });
  });
});

describe("annotations: DELETE", () => {
  test("reports deleted=false when nothing exists", async () => {
    const res = await handle(new Request(`http://x${ANNOT}`, { method: "DELETE" }), makeMockPlatform());
    expect(await res.json()).toEqual({ status: "success", deleted: false });
  });

  test("reports deleted=true after an annotation is written", async () => {
    const p = platformAt(1_700_000_000_000);
    await handle(patch(ANNOT, { annotation: "bye", rating: 3 }), p);
    const res = await handle(new Request(`http://x${ANNOT}`, { method: "DELETE" }), p);
    expect(await res.json()).toEqual({ status: "success", deleted: true });
    const after = await handle(new Request(`http://x${ANNOT}`), p);
    expect(await after.json()).toMatchObject({ annotation: null, rating: null });
  });
});

describe("annotations: GET summaries", () => {
  test("returns per-shot summaries keyed by date/filename", async () => {
    const p = platformAt(1_700_000_000_000);
    await handle(patch("/api/shots/2024-01-15/a.json/annotation", { annotation: "note", rating: 4 }), p);
    await handle(patch("/api/shots/2024-01-16/b.json/annotation", { rating: 2 }), p);

    const res = await handle(new Request("http://x/api/shots/annotations"), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "success",
      annotations: {
        "2024-01-15/a.json": { has_annotation: true, rating: 4 },
        "2024-01-16/b.json": { has_annotation: false, rating: 2 },
      },
    });
  });

  test("summaries are empty when nothing is stored", async () => {
    const res = await handle(new Request("http://x/api/shots/annotations"), makeMockPlatform());
    expect(await res.json()).toEqual({ status: "success", annotations: {} });
  });
});
