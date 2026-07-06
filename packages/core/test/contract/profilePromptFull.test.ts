import { describe, test, expect } from "vitest";
import { buildFullProfilePrompt, validateAndRetryProfile } from "../../src/ai/profilePromptFull";

const validProfile = {
  name: "Valid Bloom",
  author: "Ada",
  temperature: 93,
  variables: [{ name: "☕ Dose", key: "info_dose", type: "weight", value: 18 }],
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
  ],
};

const invalidProfile = {
  name: "Invalid",
  temperature: 93,
  variables: [],
  stages: [
    {
      name: "Paradox",
      type: "flow",
      dynamics: { points: [[0, 2], [8, 2]], over: "time", interpolation: "linear" },
      limits: [],
      exit_triggers: [{ type: "flow", value: 3, comparison: ">=" }],
    },
  ],
};

function fencedJson(value: unknown): string {
  return `PROFILE JSON:\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

describe("buildFullProfilePrompt", () => {
  test("includes author, preferences, image context, and key sections", () => {
    const prompt = buildFullProfilePrompt("Ada", "20g dose", ["light roast", "94°C"], true);
    expect(prompt).toContain("Set the 'author' field in the profile JSON to: \"Ada\"");
    expect(prompt).toContain("'20g dose, light roast, 94°C'");
    expect(prompt).toContain("Analyze the coffee bag image.");
    expect(prompt).toContain("VALIDATION RULES (your profile WILL be rejected if these are violated):");
    expect(prompt).toContain("OUTPUT FORMAT (use this exact format):");
  });

  test("reflects no-image mode", () => {
    const prompt = buildFullProfilePrompt("Ada", "18g dose", [], false);
    expect(prompt).not.toContain("Analyze the coffee bag image.");
    expect(prompt).toContain("TASK: Create a sophisticated espresso profile while strictly adhering to the user's requirements above.");
  });
});

describe("validateAndRetryProfile", () => {
  test("returns the original reply when extracted JSON is valid", async () => {
    let calls = 0;
    const reply = fencedJson(validProfile);
    const result = await validateAndRetryProfile(reply, async () => {
      calls += 1;
      return fencedJson(validProfile);
    });
    expect(result.reply).toBe(reply);
    expect(result.profileJson).toEqual(validProfile);
    expect(calls).toBe(0);
  });

  test("calls generateFix with validation errors and returns corrected reply", async () => {
    const prompts: string[] = [];
    const result = await validateAndRetryProfile(fencedJson(invalidProfile), async (prompt) => {
      prompts.push(prompt);
      return fencedJson(validProfile);
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The profile JSON you generated has validation errors.");
    expect(prompts[0]).toContain("Stage 'Paradox': flow stage cannot have a flow exit trigger (paradox)");
    expect(result.profileJson).toEqual(validProfile);
    expect(result.reply).toContain(JSON.stringify(validProfile, null, 2));
  });

  test("caps validation retries", async () => {
    let calls = 0;
    const result = await validateAndRetryProfile(fencedJson(invalidProfile), async () => {
      calls += 1;
      return fencedJson(invalidProfile);
    });
    expect(calls).toBe(2);
    expect(result.profileJson).toEqual(invalidProfile);
  });
});
