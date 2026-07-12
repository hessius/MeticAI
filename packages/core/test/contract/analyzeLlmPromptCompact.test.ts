import { describe, it, expect } from "vitest";
import { buildAnalyzeLlmPrompt } from "../../src/routes/analyzeLlmPrompt";
import type { ShotFacts } from "../../src/logic/shotFacts";

const facts: ShotFacts = {
  stages: [
    {
      stage_name: "Hold",
      reached: true,
      control_mode: "pressure",
      trigger_type: "weight",
      trigger_class: { kind: "targeted", label: "Targeted (yield reached)", reason: "" },
      stall: { stalled: false, weight_gain: 30 },
      channeling: { channeling: false, pressure_drop: 0, flow_rise: 0 },
      curve_adherence: null,
    },
  ],
  phases: [],
  weight: { actual: 36, target: 36, deviation_pct: 0 },
  total_time_s: 28,
};

describe("buildAnalyzeLlmPrompt (compact / on-device)", () => {
  const bigVars = Array.from({ length: 12 }, (_, i) => ({
    name: `Variable ${i}`, key: `var_${i}`, type: "pressure", value: i,
  }));
  const bigStages = Array.from({ length: 6 }, (_, i) => ({
    name: `Stage ${i}`, type: "pressure", key: `stage_${i}`,
    dynamics_points: [[0, 9], [3, 6]], dynamics_over: "time",
    exit_triggers: [{ type: "weight", value: 36, comparison: ">=" }],
    limits: [{ type: "flow", value: 5 }],
  }));
  const base = {
    profileName: "Test", temperature: 93, targetWeight: 36, profileDescription: "desc",
    profileVars: bigVars, cleanStages: bigStages, facts, tasteContext: "",
  };

  it("is materially smaller than the full prompt", () => {
    const full = buildAnalyzeLlmPrompt(base);
    const compact = buildAnalyzeLlmPrompt({ ...base, compact: true });
    expect(compact.length).toBeLessThan(full.length * 0.6);
  });

  it("fits a ~4096-token window with headroom for output", () => {
    // ~4 chars/token: keep the compacted input well under the window so the
    // model has room to generate the full analysis without overflowing.
    const compact = buildAnalyzeLlmPrompt({ ...base, compact: true });
    expect(compact.length).toBeLessThan(12_000);
  });

  it("drops the heavy knowledge blocks and worked example", () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true });
    expect(p).not.toContain("ESPRESSO PROFILING GUIDE");
    expect(p).not.toContain("Worked Example");
    expect(p).not.toContain("EXIT TRIGGER CLASSIFICATION");
  });

  it("preserves the output contract the parser needs", () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true });
    expect(p).toContain("## 1. Shot Performance");
    expect(p).toContain("## 2. Root Cause Analysis");
    expect(p).toContain("## 3. Setup Recommendations");
    expect(p).toContain("## 4. Profile Recommendations");
    expect(p).toContain("## 5. Profile Design Observations");
    expect(p).toContain("**Assessment:**");
    expect(p).toContain("RECOMMENDATIONS_JSON:");
    expect(p).toContain("END_RECOMMENDATIONS_JSON");
  });

  it("keeps the authoritative fact sheet and profile identity", () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true });
    expect(p).toContain("Shot Facts");
    expect(p).toContain("Test");
  });

  it("serialises profile JSON without pretty-printing (no indented newlines)", () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true });
    // Compact JSON contains the keys inline, not on their own indented lines.
    expect(p).toContain('"key":"var_0"');
  });

  it("still includes taste context when provided", () => {
    const p = buildAnalyzeLlmPrompt({
      ...base, compact: true, tasteContext: "## Taste Goal\nLess sour.",
    });
    expect(p).toContain("Taste Goal");
  });
});
