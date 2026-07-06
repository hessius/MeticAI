/**
 * Dial-in recommendation prompt builder.
 *
 * Straight port of `build_dialin_recommendation_prompt` +
 * `_describe_axis_value` from apps/server/prompt_builder.py, used by the
 * dial-in `/recommend` route's AI path. Kept as its own module so it can be
 * unit-tested and reused by the browser Platform in Phase 3.
 */

import type { DialInIteration } from "./dialin";

/** Convert a -1..1 axis value to a human-readable description. */
export function describeAxisValue(value: number, negativeLabel: string, positiveLabel: string): string {
  const absVal = Math.abs(value);
  if (absVal < 0.15) return "Balanced";
  let intensity: string;
  if (absVal < 0.4) intensity = "Slightly";
  else if (absVal < 0.7) intensity = "Moderately";
  else intensity = "Very";
  const direction = value > 0 ? positiveLabel : negativeLabel;
  return `${intensity} ${direction}`;
}

export interface DialInPromptInput {
  roastLevel: string;
  origin?: string | null;
  process?: string | null;
  roastDate?: string | null;
  profileName?: string | null;
  iterations: DialInIteration[];
}

/**
 * Build a prompt asking the AI for dial-in adjustment recommendations. Mirrors
 * the Python builder line-for-line so responses are identical across runtimes.
 */
export function buildDialInRecommendationPrompt(input: DialInPromptInput): string {
  const { roastLevel, origin, process, roastDate, profileName, iterations } = input;
  const lines: string[] = [
    "# Espresso Dial-In Recommendation",
    "",
    "You are an expert barista helping the user dial in a new bag of coffee.",
    "Analyse the coffee details and all taste-feedback iterations below,",
    "then provide **concrete, actionable** adjustment recommendations.",
    "",
    "## Coffee Details",
    `- Roast level: ${roastLevel}`,
  ];

  if (origin) lines.push(`- Origin: ${origin}`);
  if (process) lines.push(`- Process: ${process}`);
  if (roastDate) lines.push(`- Roast date: ${roastDate}`);
  if (profileName) lines.push(`- Profile: ${profileName}`);

  if (iterations.length > 0) {
    lines.push("");
    lines.push("## Taste Iteration History");
    for (const it of iterations) {
      const taste = it.taste;
      const num = it.iteration_number ?? "?";
      const x = taste?.x ?? 0;
      const y = taste?.y ?? 0;
      const balanceDesc = describeAxisValue(x, "Sour", "Bitter");
      const bodyDesc = describeAxisValue(y, "Weak/Thin", "Strong/Heavy");
      lines.push(`### Iteration ${num}`);
      lines.push(`- Balance: ${balanceDesc} (X: ${x.toFixed(2)})`);
      lines.push(`- Body: ${bodyDesc} (Y: ${y.toFixed(2)})`);
      const descriptors = taste?.descriptors ?? [];
      if (descriptors.length > 0) lines.push(`- Descriptors: ${descriptors.join(", ")}`);
      const notes = taste?.notes;
      if (notes) lines.push(`- Notes: ${notes}`);
      const prevRecs = it.recommendations ?? [];
      if (prevRecs.length > 0) lines.push(`- Previous recommendations: ${prevRecs.join("; ")}`);
    }
  }

  lines.push("");
  lines.push("## Instructions");
  lines.push("Return a JSON object with a single key `recommendations` whose value is");
  lines.push("an array of short, actionable recommendation strings (max 6).");
  lines.push("Each recommendation should be a single sentence describing one specific");
  lines.push("adjustment (e.g. 'Grind 2 steps finer', 'Reduce dose by 0.5 g').");
  lines.push("Consider the full iteration history to track progress and avoid repeating");
  lines.push("adjustments that did not help. Base your reasoning on extraction science:");
  lines.push("- Sour → under-extracted → finer grind, higher temp, longer pre-infusion");
  lines.push("- Bitter → over-extracted → coarser grind, lower temp, shorter contact");
  lines.push("- Weak → increase dose or decrease yield");
  lines.push("- Strong → decrease dose or increase yield");

  return lines.join("\n");
}
