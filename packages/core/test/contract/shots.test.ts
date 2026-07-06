import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedAI, scriptedMachine } from "../mockPlatform";
import { handle } from "../../src/handler";
import type { HistEntry } from "../../src/logic/shotAnalysis";

const ENTRY: HistEntry = {
  id: "shot-1",
  time: 1710000000,
  name: "Bloom Ramp",
  profile: {
    name: "Bloom Ramp",
    final_weight: 36,
    temperature: 93,
    variables: [
      { key: "pre_flow", name: "Pre Flow", type: "flow", value: 1.2 },
      { key: "peak_pressure", name: "Peak Pressure", type: "pressure", value: 9 },
    ],
    stages: [
      {
        name: "Bloom Soak",
        type: "flow",
        dynamics_points: [[0, "$pre_flow"], [4, "$pre_flow"]],
        dynamics_over: "time",
        exit_triggers: [{ type: "weight", value: 2, comparison: ">=" }],
        limits: [{ type: "pressure", value: 2 }],
      },
      {
        name: "Extraction",
        type: "pressure",
        dynamics_points: [[0, 6], [5, "$peak_pressure"]],
        dynamics_over: "time",
        exit_triggers: [{ type: "weight", value: 36, comparison: ">=" }],
        limits: [{ type: "flow", value: 3 }],
      },
    ],
  },
  data: [
    { time: 0, profile_time: 0, status: "Bloom Soak", shot: { pressure: 0.5, flow: 0, weight: 0 } },
    { time: 4000, profile_time: 4000, status: "Bloom Soak", shot: { pressure: 2.0, flow: 1.4, weight: 2 } },
    { time: 10000, profile_time: 10000, status: "Extraction", shot: { pressure: 8, flow: 2.0, weight: 20 } },
    { time: 15000, profile_time: 15000, status: "Extraction", shot: { pressure: 9, flow: 1.8, weight: 36 } },
  ],
};

// time 1710000000s -> 2024-03-09; filename falls back to `${id}.json`.
const SHOT_DATE = "2024-03-09";
const SHOT_FILE = "shot-1.json";

function analyzeForm(extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("profile_name", "Bloom Ramp");
  form.set("shot_date", SHOT_DATE);
  form.set("shot_filename", SHOT_FILE);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

function post(path: string, body: FormData): Request {
  return new Request(`http://core.test${path}`, { method: "POST", body });
}

const historyMachine = () => scriptedMachine({ "/api/v1/history": { history: [ENTRY] } });

describe("POST /api/shots/analyze", () => {
  test("returns a structured local analysis for a matching shot", async () => {
    const p = makeMockPlatform({ machine: historyMachine() });
    const res = await handle(post("/api/shots/analyze", analyzeForm()), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.analysis.profile_info).toEqual({
      name: "Bloom Ramp",
      temperature: 93,
      stage_count: 2,
    });
    expect(body.analysis.stage_analyses).toHaveLength(2);
  });

  test("returns an error when the shot is not found", async () => {
    const p = makeMockPlatform({ machine: historyMachine() });
    const res = await handle(
      post("/api/shots/analyze", analyzeForm({ shot_filename: "missing.json" })),
      p,
    );
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toBe("Shot not found");
  });

  test("is served under the bare /shots/analyze alias", async () => {
    const p = makeMockPlatform({ machine: historyMachine() });
    const res = await handle(post("/shots/analyze", analyzeForm()), p);
    expect((await res.json()).status).toBe("success");
  });
});

describe("POST /api/shots/analyze-llm", () => {
  const validAnalysis = [
    "## 1. Shot Performance",
    "Assessment: Acceptable",
    "## 2. Root Cause Analysis",
    "## 3. Setup Recommendations",
    "## 4. Profile Recommendations",
    "## 5. Profile Design Observations",
  ].join("\n\n");

  test("errors when AI is not configured", async () => {
    const p = makeMockPlatform({ machine: historyMachine() });
    const res = await handle(post("/api/shots/analyze-llm", analyzeForm()), p);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toBe("AI provider is not configured");
  });

  test("returns AI analysis text and caches it for recommendations", async () => {
    const p = makeMockPlatform({ machine: historyMachine(), ai: scriptedAI(validAnalysis) });
    const res = await handle(post("/api/shots/analyze-llm", analyzeForm()), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.cached).toBe(false);
    expect(body.llm_analysis).toContain("Shot Performance");

    const cached = await p.storage.aiCache.get<string>(
      `analysis:Bloom Ramp::${SHOT_FILE}`,
    );
    expect(cached).toBe(body.llm_analysis);
  });

  test("errors when the shot has no telemetry data", async () => {
    const noData: HistEntry = { ...ENTRY, data: [] };
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/history": { history: [noData] } }),
      ai: scriptedAI(validAnalysis),
    });
    const res = await handle(post("/api/shots/analyze-llm", analyzeForm()), p);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toBe("Shot has no telemetry data");
  });
});

describe("POST /api/shots/analyze-recommendations", () => {
  const analysisWithRecs = [
    "## 4. Profile Recommendations",
    "RECOMMENDATIONS_JSON:",
    JSON.stringify([
      { variable: "pressure_2", current_value: 9, recommended_value: 8, stage: "Extraction", reason: "x" },
      { variable: "temperature", current_value: 93, recommended_value: 94, stage: "global", reason: "y" },
    ]),
    "END_RECOMMENDATIONS_JSON",
  ].join("\n");

  const profileMachine = () =>
    scriptedMachine({
      "/api/v1/profile/list": [
        {
          name: "Bloom Ramp",
          variables: [{ key: "pressure_2", name: "Pressure", type: "pressure", value: 9, adjustable: true }],
        },
      ],
    });

  test("parses recommendations from the posted analysis text and flags patchability", async () => {
    const p = makeMockPlatform({ machine: profileMachine() });
    const form = new FormData();
    form.set("profile_name", "Bloom Ramp");
    form.set("shot_filename", SHOT_FILE);
    form.set("analysis", analysisWithRecs);
    const res = await handle(post("/api/shots/analyze-recommendations", form), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.total).toBe(2);
    expect(body.recommendations[0].is_patchable).toBe(true);
    expect(body.recommendations[1].is_patchable).toBe(true);
    expect(body.patchable_count).toBe(2);
  });

  test("falls back to the cached analysis when no analysis is posted", async () => {
    const p = makeMockPlatform({ machine: profileMachine() });
    await p.storage.aiCache.set(`analysis:Bloom Ramp::${SHOT_FILE}`, analysisWithRecs);
    const form = new FormData();
    form.set("profile_name", "Bloom Ramp");
    form.set("shot_filename", SHOT_FILE);
    const res = await handle(post("/api/shots/analyze-recommendations", form), p);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.total).toBe(2);
  });

  test("returns 404 when there is no analysis to parse", async () => {
    const p = makeMockPlatform({ machine: profileMachine() });
    const form = new FormData();
    form.set("profile_name", "Bloom Ramp");
    form.set("shot_filename", SHOT_FILE);
    const res = await handle(post("/api/shots/analyze-recommendations", form), p);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail.status).toBe("no_analysis");
  });
});
