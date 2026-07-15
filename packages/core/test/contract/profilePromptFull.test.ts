import { describe, test, expect } from "vitest";
import { buildFullProfilePrompt, buildCompactProfilePrompt, validateAndRetryProfile } from "../../src/ai/profilePromptFull";

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

describe("buildFullProfilePrompt (compact / on-device)", () => {
  const args: [string, string, string[], boolean] = ["Metic", "light roast, 1:3 ratio", ["turbo"], false];

  test("is materially smaller than the full prompt", () => {
    const full = buildFullProfilePrompt(...args);
    const compact = buildFullProfilePrompt(...args, true);
    expect(compact.length).toBeLessThan(full.length * 0.6);
  });

  test("delegates to the compact builder when compact=true", () => {
    const viaFlag = buildFullProfilePrompt(...args, true);
    const direct = buildCompactProfilePrompt(...args);
    expect(viaFlag).toBe(direct);
  });

  test("preserves the output contract the extractor needs", () => {
    const p = buildFullProfilePrompt(...args, true);
    expect(p).toContain("**Profile Created:**");
    expect(p).toContain("```json");
    expect(p).toContain("author");
  });

  test("keeps the rejection-critical validation rules", () => {
    const p = buildFullProfilePrompt(...args, true);
    expect(p).toMatch(/flow stage must NOT have a flow exit trigger/i);
    expect(p).toMatch(/time exit trigger/i);
    expect(p).toMatch(/pressure stages need a flow limit/i);
    expect(p).toMatch(/relative/i);
  });

  test("honours mandatory user preferences", () => {
    const p = buildFullProfilePrompt("Metic", "20g dose", [], false, true);
    expect(p).toContain("20g dose");
    expect(p).toMatch(/MANDATORY/i);
  });

  test("adapts the task line for image input", () => {
    const withImage = buildFullProfilePrompt("Metic", "", [], true, true);
    const noImage = buildFullProfilePrompt("Metic", "", [], false, true);
    expect(withImage).toMatch(/coffee bag image/i);
    expect(noImage).not.toMatch(/coffee bag image/i);
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
