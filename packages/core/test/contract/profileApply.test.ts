import { describe, test, expect } from "vitest";
import { makeMockPlatform } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { MockMachine } from "../mockPlatform";

interface FullProfile {
  id: string;
  name: string;
  temperature?: number;
  final_weight?: number;
  change_id?: string;
  in_history?: boolean;
  has_description?: boolean;
  variables?: Array<Record<string, unknown>>;
  stages?: Array<Record<string, unknown>>;
}

function makeProfile(): FullProfile {
  return {
    id: "abc123",
    name: "Test Profile",
    temperature: 92,
    final_weight: 40,
    change_id: "chg-1",
    in_history: true,
    has_description: true,
    variables: [
      { key: "pressure_Peak", type: "pressure", value: 9, adjustable: true },
      { key: "info_note", type: "text", value: 0, adjustable: false },
    ],
    stages: [
      {
        name: "Preinfusion",
        exit_triggers: [{ type: "time", value: 10 }],
        limits: [{ type: "flow", value: 4 }],
      },
    ],
  };
}

/** A machine mock that serves list/get and records the /profile/save body. */
function applyMachine(profile: FullProfile, opts: { saveOk?: boolean } = {}): {
  machine: MockMachine;
  saved: () => Record<string, unknown> | null;
} {
  let savedBody: Record<string, unknown> | null = null;
  const machine: MockMachine = {
    getBaseUrl: () => "http://machine.test:8080",
    fetch: async (path: string, init?: RequestInit) => {
      const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0];
      if (pathname === "/api/v1/profile/list") {
        return new Response(JSON.stringify([{ id: profile.id, name: profile.name }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (pathname === `/api/v1/profile/get/${profile.id}`) {
        return new Response(JSON.stringify(profile), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (pathname === "/api/v1/profile/save") {
        if (opts.saveOk === false) return new Response("nope", { status: 500 });
        savedBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
    },
  };
  return { machine, saved: () => savedBody };
}

function post(path: string, recommendations: unknown): Request {
  const form = new FormData();
  form.set("recommendations", JSON.stringify(recommendations));
  return new Request(`http://core.test${path}`, { method: "POST", body: form });
}

const ROUTE = "/api/profile/Test%20Profile/apply-recommendations";

describe("POST /api/profile/{name}/apply-recommendations", () => {
  test("applies a global temperature change and saves the stripped profile", async () => {
    const { machine, saved } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post(ROUTE, [{ variable: "temperature", stage: "global", recommended_value: 94 }]),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.applied).toEqual([{ variable: "temperature", stage: "global", value: 94 }]);
    expect(body.skipped).toEqual([]);
    expect(body.profile.temperature).toBe(94);
    // client-only metadata is stripped before saving to the machine
    const savedBody = saved()!;
    expect(savedBody.temperature).toBe(94);
    expect(savedBody.change_id).toBeUndefined();
    expect(savedBody.in_history).toBeUndefined();
    expect(savedBody.has_description).toBeUndefined();
  });

  test("applies an adjustable profile variable but skips info-only ones", async () => {
    const { machine, saved } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post(ROUTE, [
        { variable: "pressure_Peak", stage: "global", recommended_value: 7 },
        { variable: "info_note", stage: "global", recommended_value: 1 },
      ]),
      p,
    );
    const body = await res.json();
    expect(body.applied).toEqual([{ variable: "pressure_Peak", stage: "global", value: 7 }]);
    expect(body.skipped).toEqual([{ variable: "info_note", reason: "info-only / not adjustable" }]);
    const savedVar = (saved()!.variables as Array<Record<string, unknown>>).find(
      (v) => v.key === "pressure_Peak",
    );
    expect(savedVar!.value).toBe(7);
  });

  test("applies stage exit-trigger and limit values", async () => {
    const { machine, saved } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post(ROUTE, [
        { variable: "exit_time", stage: "Preinfusion", recommended_value: 15 },
        { variable: "limit_flow", stage: "Preinfusion", recommended_value: 6 },
      ]),
      p,
    );
    const body = await res.json();
    expect(body.applied).toHaveLength(2);
    const stage = (saved()!.stages as Array<Record<string, unknown>>)[0];
    const trigger = (stage.exit_triggers as Array<Record<string, unknown>>)[0];
    const limit = (stage.limits as Array<Record<string, unknown>>)[0];
    expect(trigger.value).toBe(15);
    expect(limit.value).toBe(6);
  });

  test("recovers a model-invented positional id via the fuzzy fallback", async () => {
    const { machine } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post(ROUTE, [
        { variable: "pressure_2", stage: "global", current_value: 9, recommended_value: 6 },
      ]),
      p,
    );
    const body = await res.json();
    expect(body.applied).toEqual([
      { variable: "pressure_Peak", stage: "global", value: 6, matched_from: "pressure_2" },
    ]);
  });

  test("skips out-of-range global values (temperature > 100, final_weight <= 0)", async () => {
    const { machine, saved } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post(ROUTE, [
        { variable: "temperature", stage: "global", recommended_value: 150 },
        { variable: "final_weight", stage: "global", recommended_value: 0 },
      ]),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("no_changes");
    expect(body.skipped).toEqual([
      { variable: "temperature", reason: "exceeds 100 °C" },
      { variable: "final_weight", reason: "must be > 0" },
    ]);
    expect(saved()).toBeNull(); // nothing applied -> no save
  });

  test("returns no_changes without saving when nothing is applicable", async () => {
    const { machine, saved } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post(ROUTE, [{ variable: "nonexistent", stage: "global", recommended_value: 5 }]),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("no_changes");
    expect(body.skipped).toEqual([{ variable: "nonexistent", reason: "variable not found in profile" }]);
    expect(saved()).toBeNull();
  });

  test("returns 400 for invalid recommendations JSON", async () => {
    const { machine } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const form = new FormData();
    form.set("recommendations", "{not json");
    const req = new Request(`http://core.test${ROUTE}`, { method: "POST", body: form });
    const res = await handle(req, p);
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toContain("Invalid recommendations JSON");
  });

  test("returns 400 when recommendations is not an array", async () => {
    const { machine } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(post(ROUTE, { variable: "x" }), p);
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toBe("recommendations must be a JSON array");
  });

  test("returns 404 when the profile is not found on the machine", async () => {
    const { machine } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post("/api/profile/Ghost/apply-recommendations", [
        { variable: "temperature", stage: "global", recommended_value: 94 },
      ]),
      p,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).detail).toBe("Profile 'Ghost' not found on machine");
  });

  test("returns 502 when the machine save fails", async () => {
    const { machine } = applyMachine(makeProfile(), { saveOk: false });
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post(ROUTE, [{ variable: "temperature", stage: "global", recommended_value: 94 }]),
      p,
    );
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toBe("Failed to save profile to machine");
  });

  test("is served under the bare /profile/{name}/... alias", async () => {
    const { machine } = applyMachine(makeProfile());
    const p = makeMockPlatform({ machine });
    const res = await handle(
      post("/profile/Test%20Profile/apply-recommendations", [
        { variable: "temperature", stage: "global", recommended_value: 93 },
      ]),
      p,
    );
    expect((await res.json()).status).toBe("success");
  });
});
