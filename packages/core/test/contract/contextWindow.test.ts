import { describe, it, expect } from "vitest";
import { needsCompactPrompt, COMPACT_PROMPT_CONTEXT_THRESHOLD } from "../../src/ai/contextWindow";
import type { PlatformAI } from "../../src/platform";

function fakeAI(window?: number): Pick<PlatformAI, "contextWindowTokens"> {
  return { contextWindowTokens: () => window };
}

describe("needsCompactPrompt", () => {
  it("is true for a small-window (on-device) provider", () => {
    expect(needsCompactPrompt(fakeAI(4096))).toBe(true);
    expect(needsCompactPrompt(fakeAI(COMPACT_PROMPT_CONTEXT_THRESHOLD))).toBe(true);
  });

  it("is false when no window is advertised (hosted, effectively unbounded)", () => {
    expect(needsCompactPrompt(fakeAI(undefined))).toBe(false);
    expect(needsCompactPrompt({})).toBe(false);
  });

  it("is false for a large-window provider", () => {
    expect(needsCompactPrompt(fakeAI(COMPACT_PROMPT_CONTEXT_THRESHOLD + 1))).toBe(false);
    expect(needsCompactPrompt(fakeAI(1_000_000))).toBe(false);
  });
});
