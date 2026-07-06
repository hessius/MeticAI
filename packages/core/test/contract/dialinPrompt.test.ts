import { describe, test, expect } from "vitest";
import { buildDialInRecommendationPrompt, describeAxisValue } from "../../src/routes/dialinPrompt";
import type { DialInIteration } from "../../src/routes/dialin";

describe("describeAxisValue", () => {
  test("returns Balanced within the deadzone", () => {
    expect(describeAxisValue(0, "Sour", "Bitter")).toBe("Balanced");
    expect(describeAxisValue(0.1, "Sour", "Bitter")).toBe("Balanced");
    expect(describeAxisValue(-0.14, "Sour", "Bitter")).toBe("Balanced");
  });

  test("scales intensity and picks direction by sign", () => {
    expect(describeAxisValue(0.3, "Sour", "Bitter")).toBe("Slightly Bitter");
    expect(describeAxisValue(-0.5, "Sour", "Bitter")).toBe("Moderately Sour");
    expect(describeAxisValue(0.9, "Weak/Thin", "Strong/Heavy")).toBe("Very Strong/Heavy");
  });
});

describe("buildDialInRecommendationPrompt", () => {
  const iteration: DialInIteration = {
    iteration_number: 1,
    taste: { x: -0.5, y: 0.3, descriptors: ["citrus", "tea"], notes: "bright" },
    recommendations: ["Grind finer"],
    timestamp: "2024-01-01T00:00:00.000Z",
  };

  test("includes coffee details, optional fields, and iteration history", () => {
    const prompt = buildDialInRecommendationPrompt({
      roastLevel: "medium",
      origin: "Ethiopia",
      process: "washed",
      roastDate: "2024-01-01",
      profileName: "Blossom",
      iterations: [iteration],
    });
    expect(prompt).toContain("- Roast level: medium");
    expect(prompt).toContain("- Origin: Ethiopia");
    expect(prompt).toContain("- Process: washed");
    expect(prompt).toContain("- Profile: Blossom");
    expect(prompt).toContain("### Iteration 1");
    expect(prompt).toContain("- Balance: Moderately Sour (X: -0.50)");
    expect(prompt).toContain("- Body: Slightly Strong/Heavy (Y: 0.30)");
    expect(prompt).toContain("- Descriptors: citrus, tea");
    expect(prompt).toContain("- Notes: bright");
    expect(prompt).toContain("- Previous recommendations: Grind finer");
    expect(prompt).toContain("`recommendations`");
  });

  test("omits optional lines and the history section when absent", () => {
    const prompt = buildDialInRecommendationPrompt({ roastLevel: "dark", iterations: [] });
    expect(prompt).toContain("- Roast level: dark");
    expect(prompt).not.toContain("- Origin:");
    expect(prompt).not.toContain("## Taste Iteration History");
  });
});
