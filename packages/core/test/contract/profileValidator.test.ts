import { describe, test, expect } from "vitest";
import { validateProfile } from "../../src/logic/profileValidator";

const validProfile = {
  name: "Valid Bloom",
  author: "Metic",
  temperature: 93,
  variables: [
    { name: "☕ Dose", key: "info_dose", type: "weight", value: 18 },
    { name: "Peak Pressure", key: "peak_pressure", type: "pressure", value: 8 },
  ],
  stages: [
    {
      name: "Preinfusion",
      type: "flow",
      dynamics: { points: [[0, 2], [8, 2]], over: "time", interpolation: "linear" },
      limits: [{ type: "pressure", value: 4 }],
      exit_triggers: [
        { type: "weight", value: 5, comparison: ">=", relative: false },
        { type: "time", value: 10, comparison: ">=", relative: true },
      ],
    },
    {
      name: "Extract",
      type: "pressure",
      dynamics: { points: [[0, "$peak_pressure"], [20, 6]], over: "time", interpolation: "curve" },
      limits: [{ type: "flow", value: 5 }],
      exit_triggers: [
        { type: "weight", value: 36, comparison: ">=", relative: false },
        { type: "time", value: 35, comparison: ">=", relative: true },
      ],
    },
  ],
};

describe("validateProfile", () => {
  test("accepts a structurally valid profile", () => {
    const result = validateProfile(validProfile);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects missing top-level requirements", () => {
    const result = validateProfile({ stages: [] });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Missing required field: 'name'");
    expect(result.errors).toContain("Profile must have at least one stage");
  });

  test("rejects invalid stage definitions and missing failsafes", () => {
    const result = validateProfile({
      name: "Broken",
      stages: [
        { name: "Bad Type", type: "temperature", exit_triggers: [] },
        { name: "Paradox", type: "flow", limits: [{ type: "flow", value: 2 }], exit_triggers: [{ type: "flow", value: 3, comparison: "==" }] },
      ],
    });
    expect(result.errors).toContain("Stage 'Bad Type': type must be 'power', 'flow', or 'pressure', got 'temperature'");
    expect(result.errors).toContain("Stage 'Bad Type': missing exit_triggers");
    expect(result.errors).toContain("Stage 'Paradox': flow stage cannot have a flow exit trigger (paradox)");
    expect(result.errors).toContain("Stage 'Paradox': single non-time exit trigger needs a time backup");
    expect(result.errors).toContain("Stage 'Paradox': exit trigger comparison must be '>=' or '<=', got '=='");
    expect(result.errors).toContain("Stage 'Paradox': flow stage must have a pressure limit");
    expect(result.errors).toContain("Stage 'Paradox': flow stage cannot have a flow limit (same-type)");
  });

  test("rejects invalid dynamics, pressure bounds, and weight ordering", () => {
    const result = validateProfile({
      name: "Broken Dynamics",
      stages: [
        {
          name: "First",
          type: "pressure",
          dynamics: { points: [[0, 16]], over: "volume", interpolation: "none" },
          limits: [{ type: "pressure", value: -1 }],
          exit_triggers: [{ type: "weight", value: 20, comparison: ">=", relative: false }, { type: "time", value: 10, comparison: ">=", relative: true }],
        },
        {
          name: "Second",
          type: "pressure",
          dynamics: { points: [[0, 8]], over: "time", interpolation: "curve" },
          limits: [{ type: "flow", value: 4 }],
          exit_triggers: [{ type: "weight", value: 18, comparison: ">=", relative: false }, { type: "pressure", value: 16, comparison: ">=" }],
        },
      ],
    });
    expect(result.errors).toContain("Stage 'First': pressure stage must have a flow limit");
    expect(result.errors).toContain("Stage 'First': pressure stage cannot have a pressure limit (same-type)");
    expect(result.errors).toContain("Stage 'First': negative pressure limit value (-1)");
    expect(result.errors).toContain("Stage 'First': dynamics.over must be 'time', 'weight', or 'piston_position', got 'volume'");
    expect(result.errors).toContain("Stage 'First': interpolation must be 'linear' or 'curve', got 'none'");
    expect(result.errors).toContain("Stage 'First': dynamics pressure exceeds 15 bar (16)");
    expect(result.errors).toContain("Stage 'Second': pressure stage cannot have a pressure exit trigger (paradox)");
    expect(result.errors).toContain("Stage 'Second': pressure trigger exceeds 15 bar (16)");
    expect(result.errors).toContain("Stage 'Second': absolute weight trigger (18g) must be > previous stage's (20g)");
    expect(result.errors).toContain("Stage 'Second': 'curve' interpolation requires at least 2 dynamics points");
  });

  test("rejects invalid variable naming and unused adjustable variables", () => {
    const result = validateProfile({
      ...validProfile,
      variables: [
        { name: "Dose", key: "info_dose", type: "weight", value: 18 },
        { name: "🎯 Peak Pressure", key: "peak_pressure", type: "pressure", value: 8 },
        { name: "Unused Flow", key: "unused_flow", type: "flow", value: 2 },
      ],
    });
    expect(result.errors).toContain("Variable 'info_dose': info variable name must start with an emoji, got 'Dose'");
    expect(result.errors).toContain("Variable 'peak_pressure': adjustable variable name must NOT start with an emoji, got '🎯 Peak Pressure'");
    expect(result.errors).toContain("Adjustable variable 'unused_flow' ('Unused Flow') is defined but never used in any stage. Use $unused_flow in a dynamics point or remove it.");
  });
});
