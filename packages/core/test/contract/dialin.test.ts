import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedAI, throwingAI } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { Platform } from "../../src/platform";

const SESSIONS = "/api/dialin/sessions";

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://x${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

const COFFEE = { roast_level: "medium", origin: "Ethiopia", process: "washed" };

async function createSession(p: Platform, body: unknown = { coffee: COFFEE }): Promise<Record<string, unknown>> {
  const res = await handle(req("POST", SESSIONS, body), p);
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

describe("dial-in: create session", () => {
  test("creates an active session with a 12-char id and echoes coffee", async () => {
    const p = makeMockPlatform({ clock: () => 1_700_000_000_000 });
    const session = await createSession(p, { coffee: COFFEE, profile_name: "Blossom" });
    expect(typeof session.id).toBe("string");
    expect((session.id as string).length).toBe(12);
    expect(session.status).toBe("active");
    expect(session.iterations).toEqual([]);
    expect(session.profile_name).toBe("Blossom");
    expect(session.coffee).toEqual(COFFEE);
    expect(session.created_at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  test("accepts coffee fields at the top level (no nested coffee key)", async () => {
    const p = makeMockPlatform();
    const session = await createSession(p, { roast_level: "dark" });
    expect(session.coffee).toEqual({ roast_level: "dark" });
  });

  test("rejects an invalid roast level with 400 { detail }", async () => {
    const res = await handle(req("POST", SESSIONS, { coffee: { roast_level: "burnt" } }), makeMockPlatform());
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toContain("roast_level");
  });
});

describe("dial-in: get / list", () => {
  test("gets a session by id", async () => {
    const p = makeMockPlatform();
    const created = await createSession(p);
    const res = await handle(req("GET", `${SESSIONS}/${created.id}`), p);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(created.id);
  });

  test("returns 404 { detail } for an unknown id", async () => {
    const res = await handle(req("GET", `${SESSIONS}/missing`), makeMockPlatform());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ detail: "Session not found" });
  });

  test("lists all sessions and filters by status", async () => {
    const p = makeMockPlatform();
    const a = await createSession(p);
    await createSession(p);
    await handle(req("POST", `${SESSIONS}/${a.id}/complete`), p);

    const all = await handle(req("GET", SESSIONS), p);
    expect((await all.json()).sessions).toHaveLength(2);

    const active = await handle(req("GET", `${SESSIONS}?status=active`), p);
    const activeList = (await active.json()).sessions as Array<{ id: string }>;
    expect(activeList).toHaveLength(1);
    expect(activeList[0]!.id).not.toBe(a.id);

    const completed = await handle(req("GET", `${SESSIONS}?status=completed`), p);
    expect((await completed.json()).sessions).toHaveLength(1);
  });

  test("rejects an invalid status filter with 400", async () => {
    const res = await handle(req("GET", `${SESSIONS}?status=bogus`), makeMockPlatform());
    expect(res.status).toBe(400);
  });
});

describe("dial-in: iterations", () => {
  test("adds an iteration with an auto-incrementing number", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    const first = await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: -0.5, y: 0 } }), p);
    expect(first.status).toBe(201);
    expect((await first.json()).iteration_number).toBe(1);

    const second = await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: 0.5, y: 0.5 }, shot_ref: "2024/x.shot.json" }), p);
    const secondBody = await second.json();
    expect(secondBody.iteration_number).toBe(2);
    expect(secondBody.shot_ref).toBe("2024/x.shot.json");
    expect(secondBody.recommendations).toEqual([]);
  });

  test("rejects out-of-range taste coordinates", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: 2, y: 0 } }), p);
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toContain("taste.x");
  });

  test("adding to a missing session returns 404", async () => {
    const res = await handle(req("POST", `${SESSIONS}/missing/iterations`, { taste: { x: 0, y: 0 } }), makeMockPlatform());
    expect(res.status).toBe(404);
  });

  test("adding to a completed session returns 404 (not active)", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    await handle(req("POST", `${SESSIONS}/${s.id}/complete`), p);
    const res = await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: 0, y: 0 } }), p);
    expect(res.status).toBe(404);
    expect((await res.json()).detail).toContain("not active");
  });

  test("updates recommendations for an iteration", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: 0, y: 0 } }), p);
    const res = await handle(
      req("PUT", `${SESSIONS}/${s.id}/iterations/1/recommendations`, { recommendations: ["Grind finer"] }),
      p,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).recommendations).toEqual(["Grind finer"]);
  });

  test("updating recommendations for a missing iteration returns 404", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    const res = await handle(
      req("PUT", `${SESSIONS}/${s.id}/iterations/9/recommendations`, { recommendations: ["x"] }),
      p,
    );
    expect(res.status).toBe(404);
  });
});

describe("dial-in: rule-based recommendations", () => {
  test("sour+weak taste yields grind-finer and dose-up guidance stored on the latest iteration", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: -0.5, y: -0.5 } }), p);
    const res = await handle(req("POST", `${SESSIONS}/${s.id}/recommend`), p);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("rules");
    expect(body.recommendations).toEqual([
      "Grind finer (2-3 steps)",
      "Increase temperature by 1-2°C",
      "Increase dose by 0.3-0.5g",
    ]);

    const session = await (await handle(req("GET", `${SESSIONS}/${s.id}`), p)).json();
    expect(session.iterations[0].recommendations).toEqual(body.recommendations);
  });

  test("balanced taste yields the encouraging default", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: 0, y: 0 } }), p);
    const res = await handle(req("POST", `${SESSIONS}/${s.id}/recommend`), p);
    expect((await res.json()).recommendations).toEqual([
      "Looking good! Small tweaks only — try ±0.5°C or ±0.2g dose",
    ]);
  });

  test("recommend with no iterations returns 400", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${s.id}/recommend`), p);
    expect(res.status).toBe(400);
  });

  test("recommend for a missing session returns 404", async () => {
    const res = await handle(req("POST", `${SESSIONS}/missing/recommend`), makeMockPlatform());
    expect(res.status).toBe(404);
  });
});

describe("dial-in: AI-backed recommendations", () => {
  async function seededSession(p: Platform): Promise<string> {
    const s = await createSession(p);
    await handle(req("POST", `${SESSIONS}/${s.id}/iterations`, { taste: { x: -0.5, y: -0.5 } }), p);
    return s.id as string;
  }

  test("uses the AI provider when configured and returns source 'ai'", async () => {
    const p = makeMockPlatform({
      ai: scriptedAI(JSON.stringify({ recommendations: ["Grind 2 steps finer", "Raise temp 1C"] })),
    });
    const id = await seededSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${id}/recommend`), p);
    const body = await res.json();
    expect(body.source).toBe("ai");
    expect(body.recommendations).toEqual(["Grind 2 steps finer", "Raise temp 1C"]);

    const session = await (await handle(req("GET", `${SESSIONS}/${id}`), p)).json();
    expect(session.iterations[0].recommendations).toEqual(body.recommendations);
  });

  test("parses a markdown-fenced JSON response and caps at 6 items", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => `rec ${i + 1}`);
    const fenced = "```json\n" + JSON.stringify({ recommendations: seven }) + "\n```";
    const p = makeMockPlatform({ ai: scriptedAI(fenced) });
    const id = await seededSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${id}/recommend`), p);
    const body = await res.json();
    expect(body.source).toBe("ai");
    expect(body.recommendations).toHaveLength(6);
    expect(body.recommendations[0]).toBe("rec 1");
  });

  test("falls back to rules when the AI returns an empty list", async () => {
    const p = makeMockPlatform({ ai: scriptedAI(JSON.stringify({ recommendations: [] })) });
    const id = await seededSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${id}/recommend`), p);
    const body = await res.json();
    expect(body.source).toBe("rules");
    expect(body.recommendations).toEqual([
      "Grind finer (2-3 steps)",
      "Increase temperature by 1-2°C",
      "Increase dose by 0.3-0.5g",
    ]);
  });

  test("falls back to rules when the AI throws", async () => {
    const p = makeMockPlatform({ ai: throwingAI("provider down") });
    const id = await seededSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${id}/recommend`), p);
    const body = await res.json();
    expect(body.source).toBe("rules");
  });

  test("falls back to rules when the AI returns non-JSON", async () => {
    const p = makeMockPlatform({ ai: scriptedAI("sorry, I cannot help with that") });
    const id = await seededSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${id}/recommend`), p);
    expect((await res.json()).source).toBe("rules");
  });
});

describe("dial-in: lifecycle", () => {
  test("completes a session", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    const res = await handle(req("POST", `${SESSIONS}/${s.id}/complete`), p);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("completed");
  });

  test("deletes a session, then 404 on re-delete", async () => {
    const p = makeMockPlatform();
    const s = await createSession(p);
    const del = await handle(req("DELETE", `${SESSIONS}/${s.id}`), p);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });

    const again = await handle(req("DELETE", `${SESSIONS}/${s.id}`), p);
    expect(again.status).toBe(404);
  });
});

describe("dial-in: bare /dialin alias", () => {
  test("serves the same routes without the /api prefix", async () => {
    const p = makeMockPlatform();
    const created = await handle(req("POST", "/dialin/sessions", { coffee: COFFEE }), p);
    expect(created.status).toBe(201);
    const id = (await created.json()).id;
    const got = await handle(req("GET", `/dialin/sessions/${id}`), p);
    expect(got.status).toBe(200);
    expect((await got.json()).id).toBe(id);
  });
});
