import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { AnalyzableProfile } from "../../src/logic/profileAnalysis";
import { getRecommendations, findSimilarProfiles } from "../../src/logic/profileRecommendation";

const PROFILES: AnalyzableProfile[] = [
  {
    name: "Fruity Turbo",
    temperature: 94,
    final_weight: 40,
    stages: [
      { name: "Preinfusion", type: "flow", dynamics: { points: [[0, 4]], over: "time" } },
      { name: "Infusion", type: "pressure", dynamics: { points: [[0, 6], [10, 6]], over: "time" } },
    ] as AnalyzableProfile["stages"],
  },
  {
    name: "Classic Lever",
    temperature: 92,
    final_weight: 36,
    stages: [
      { name: "Preinfusion", type: "flow", dynamics: { points: [[0, 3]], over: "time" } },
      { name: "Ramp", type: "pressure", dynamics: { points: [[0, 9], [20, 5]], over: "time" } },
    ] as AnalyzableProfile["stages"],
  },
];

function post(path: string, form: FormData): Request {
  return new Request(`http://core.test${path}`, { method: "POST", body: form });
}

const catalogueMachine = () =>
  scriptedMachine({ "/api/v1/profile/list": PROFILES });

describe("POST /api/profiles/recommend", () => {
  test("returns tag-scored recommendations matching the shared scorer", async () => {
    const p = makeMockPlatform({ machine: catalogueMachine() });
    const form = new FormData();
    form.append("tags", "fruity");
    form.append("tags", "turbo");
    form.set("limit", "5");
    const res = await handle(post("/api/profiles/recommend", form), p);
    const body = await res.json();
    expect(body.status).toBe("success");

    const expected = getRecommendations(["fruity", "turbo"], PROFILES, 5);
    expect(body.count).toBe(expected.length);
    expect(body.recommendations).toEqual(expected);
  });

  test("is served under the bare /profiles/recommend alias", async () => {
    const p = makeMockPlatform({ machine: catalogueMachine() });
    const form = new FormData();
    form.append("tags", "fruity");
    const res = await handle(post("/profiles/recommend", form), p);
    expect((await res.json()).status).toBe("success");
  });

  test("returns 500 with a detail message when the machine is unavailable", async () => {
    const p = makeMockPlatform(); // default machine.fetch rejects
    const form = new FormData();
    form.append("tags", "fruity");
    const res = await handle(post("/api/profiles/recommend", form), p);
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toBeTruthy();
  });
});

describe("POST /api/profiles/find-similar", () => {
  test("returns profiles similar to the named source", async () => {
    const p = makeMockPlatform({ machine: catalogueMachine() });
    const form = new FormData();
    form.set("profile_name", "Fruity Turbo");
    form.set("limit", "10");
    const res = await handle(post("/api/profiles/find-similar", form), p);
    const body = await res.json();
    expect(body.status).toBe("success");

    const source = PROFILES.find((x) => x.name === "Fruity Turbo")!;
    const expected = findSimilarProfiles(source, PROFILES, 10);
    expect(body.recommendations).toEqual(expected);
    expect(body.count).toBe(expected.length);
  });

  test("returns an empty list when the source profile is unknown", async () => {
    const p = makeMockPlatform({ machine: catalogueMachine() });
    const form = new FormData();
    form.set("profile_name", "Does Not Exist");
    const res = await handle(post("/api/profiles/find-similar", form), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.recommendations).toEqual([]);
    expect(body.count).toBe(0);
  });
});
