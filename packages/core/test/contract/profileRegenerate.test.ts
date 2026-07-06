import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine, scriptedAI } from "../mockPlatform";
import { handle } from "../../src/handler";
import { buildStaticProfileDescription } from "../../src/logic/profileDescription";

const PROFILE = {
  id: "abc123",
  name: "Fruity Turbo",
  temperature: 93,
  final_weight: 40,
  variables: [{ key: "pressure_Peak", type: "pressure", value: 9 }],
  stages: [
    { name: "Preinfusion", dynamics_points: [[0, 4]] },
    { name: "Infusion", dynamics_points: [[0, 6], [25, 6]] },
  ],
};

function post(path: string): Request {
  return new Request(`http://core.test${path}`, { method: "POST", body: new FormData() });
}

/** Machine that serves the profile by id and via the catalogue by name. */
const machine = () =>
  scriptedMachine({
    "/api/v1/profile/get/abc123": PROFILE,
    "/api/v1/profile/list": [{ id: "abc123", name: "Fruity Turbo" }],
  });

const ROUTE = "/api/profile/abc123/regenerate-description";

describe("POST /api/profile/{id}/regenerate-description", () => {
  test("returns an AI description, resolving placeholders and caching tags", async () => {
    const aiText =
      "Profile Created: Fruity Turbo\nDescription: A punchy shot at $pressure_Peak.\n\nTags: Light Body, Acidity";
    const p = makeMockPlatform({ machine: machine(), ai: scriptedAI(aiText) });
    const res = await handle(post(ROUTE), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    // placeholder resolved to value + unit, Tags line stripped
    expect(body.description).toContain("9 bar");
    expect(body.description).not.toContain("$pressure_Peak");
    expect(body.description).not.toMatch(/Tags:/);
    // description + ai-tags cached under the profile name
    expect(await p.storage.descriptions.read("Fruity Turbo")).toBe(body.description);
    expect(await p.storage.aiTags.read("Fruity Turbo")).toEqual(["Light Body", "Acidity"]);
  });

  test("falls back to the static description when AI is not configured", async () => {
    const p = makeMockPlatform({ machine: machine() }); // default unconfigured AI
    const res = await handle(post(ROUTE), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.description).toBe(buildStaticProfileDescription(PROFILE as unknown as Parameters<typeof buildStaticProfileDescription>[0]));
    expect(await p.storage.descriptions.read("Fruity Turbo")).toBe(body.description);
  });

  test("falls back to static when the AI output signals it was generated without AI", async () => {
    const p = makeMockPlatform({
      machine: machine(),
      ai: scriptedAI("This description was generated without AI assistance."),
    });
    const res = await handle(post(ROUTE), p);
    const body = await res.json();
    expect(body.description).toBe(buildStaticProfileDescription(PROFILE as unknown as Parameters<typeof buildStaticProfileDescription>[0]));
  });

  test("resolves the identifier as a profile name when it is not a machine id", async () => {
    const p = makeMockPlatform({ machine: machine() });
    const res = await handle(post("/api/profile/Fruity%20Turbo/regenerate-description"), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.description).toBe(buildStaticProfileDescription(PROFILE as unknown as Parameters<typeof buildStaticProfileDescription>[0]));
  });

  test("returns 404 when the profile cannot be resolved", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/profile/list": [] }),
    });
    const res = await handle(post("/api/profile/ghost/regenerate-description"), p);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.detail).toBe("History entry not found");
  });

  test("is served under the bare /profile/{id}/... alias", async () => {
    const p = makeMockPlatform({ machine: machine() });
    const res = await handle(post("/profile/abc123/regenerate-description"), p);
    expect((await res.json()).status).toBe("success");
  });
});
