import type { PlatformAI } from "../platform";

/**
 * Providers whose context window is at or below this many tokens cannot fit the
 * full analysis/profile prompts and must be given a compacted variant. Mirrors
 * the frontend's COMPACT_PROMPT_CONTEXT_THRESHOLD so both runtimes agree.
 */
export const COMPACT_PROMPT_CONTEXT_THRESHOLD = 8192;

/**
 * Whether the active AI provider needs the compact (small-context) prompt
 * variant. On-device models (Apple Intelligence, Gemma) advertise a ~4096-token
 * window; the full prompts overflow it and the model errors out ("exceeded
 * model context window size") instead of returning a result. Hosted providers
 * omit `contextWindowTokens` (effectively unbounded) and get the full prompt.
 */
export function needsCompactPrompt(ai: Pick<PlatformAI, "contextWindowTokens">): boolean {
  const window = ai.contextWindowTokens?.();
  return window != null && window <= COMPACT_PROMPT_CONTEXT_THRESHOLD;
}
