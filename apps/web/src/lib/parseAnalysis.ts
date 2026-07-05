import React from "react";
import {
  Target,
  Wrench,
  Lightbulb,
  TrendingUp,
  AlertCircle,
  Info,
  Compass,
} from "lucide-react";

// ---- Types ----

export interface ParsedSection {
  title: string;
  number: string;
  content: string;
  subsections: { title: string; items: string[] }[];
  assessment?: { status: string; color: string };
}

export interface SectionStyle {
  icon: React.ReactNode;
  color: string;
  borderColor: string;
}

// ---- Section Configuration (extensible array) ----

interface SectionConfigEntry {
  /** Pattern matched against section title (e.g. "Shot Performance") */
  pattern: string;
  style: SectionStyle;
}

/**
 * Ordered list of section styles. Matched by checking whether the
 * section title *contains* the pattern string (case-insensitive).
 * New sections can be added by appending to this array.
 */
export const SECTION_STYLES: SectionConfigEntry[] = [
  {
    pattern: "Shot Performance",
    style: {
      icon: React.createElement(Target, { className: "h-5 w-5" }),
      color: "text-blue-600 dark:text-blue-400",
      borderColor: "border-blue-500/30",
    },
  },
  {
    pattern: "Root Cause",
    style: {
      icon: React.createElement(AlertCircle, { className: "h-5 w-5" }),
      color: "text-amber-600 dark:text-amber-400",
      borderColor: "border-amber-500/30",
    },
  },
  {
    pattern: "Setup Recommendations",
    style: {
      icon: React.createElement(Wrench, { className: "h-5 w-5" }),
      color: "text-green-600 dark:text-green-400",
      borderColor: "border-green-500/30",
    },
  },
  {
    pattern: "Profile Recommendations",
    style: {
      icon: React.createElement(TrendingUp, { className: "h-5 w-5" }),
      color: "text-purple-600 dark:text-purple-400",
      borderColor: "border-purple-500/30",
    },
  },
  {
    pattern: "Profile Design",
    style: {
      icon: React.createElement(Lightbulb, { className: "h-5 w-5" }),
      color: "text-cyan-600 dark:text-cyan-400",
      borderColor: "border-cyan-500/30",
    },
  },
  {
    pattern: "Taste-Based",
    style: {
      icon: React.createElement(Compass, { className: "h-5 w-5" }),
      color: "text-rose-600 dark:text-rose-400",
      borderColor: "border-rose-500/30",
    },
  },
];

const DEFAULT_STYLE: SectionStyle = {
  icon: React.createElement(Info, { className: "h-5 w-5" }),
  color: "text-gray-600 dark:text-gray-400",
  borderColor: "border-gray-500/30",
};

/** Resolve the visual style for a section by its title. */
export function getSectionStyle(title: string): SectionStyle {
  const lower = title.toLowerCase();
  for (const entry of SECTION_STYLES) {
    if (lower.includes(entry.pattern.toLowerCase())) {
      return entry.style;
    }
  }
  return DEFAULT_STYLE;
}

// ---- Circled Numbers ----

export const CIRCLED_NUMBERS = [
  "\u2460", "\u2461", "\u2462", "\u2463", "\u2464",
  "\u2465", "\u2466", "\u2467", "\u2468", "\u2469",
  "\u246A", "\u246B", "\u246C", "\u246D", "\u246E",
  "\u246F", "\u2470", "\u2471", "\u2472", "\u2473",
];

// ---- Recommendation JSON locator ----

/**
 * Locate the recommendations JSON array within an analysis string.
 *
 * Weak models (especially small on-device LLMs such as Apple Intelligence)
 * frequently omit the `RECOMMENDATIONS_JSON:` / `END_RECOMMENDATIONS_JSON`
 * delimiters and instead dump a bare JSON array — sometimes embedded inside
 * a prose section. When that happens the array must still be (a) removed from
 * the rendered prose and (b) recovered as structured recommendations.
 *
 * Strategy:
 *   1. Prefer the properly delimited block.
 *   2. Otherwise, fall back to bracket-matching a bare array that contains a
 *      recommendation-shaped object (`"variable"` / `"recommended_value"`).
 *
 * Returns the character range of the located text (for stripping) and the raw
 * JSON array text (for parsing), or null if none is found.
 */
export function locateRecommendationsJSON(
  text: string,
): { start: number; end: number; json: string } | null {
  const delim = text.match(
    /RECOMMENDATIONS_JSON:\s*\n\s*(\[[\s\S]*?\])\s*\n?\s*END_RECOMMENDATIONS_JSON/,
  );
  if (delim && delim.index != null) {
    return {
      start: delim.index,
      end: delim.index + delim[0].length,
      json: delim[1],
    };
  }

  // Fallback: bare array containing a recommendation-shaped object.
  const keyMatch = text.match(/"(?:variable|recommended_value)"\s*:/);
  if (!keyMatch || keyMatch.index == null) return null;
  const open = text.lastIndexOf("[", keyMatch.index);
  if (open === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        return { start: open, end: i + 1, json: text.slice(open, i + 1) };
      }
    }
  }
  return null;
}

/** Tolerantly parse a JSON array, stripping trailing commas weak models emit. */
function parseJsonArrayLoose(json: string): unknown[] | null {
  const cleaned = json.replace(/,(\s*[\]}])/g, "$1");
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ---- Section header detection ----

/**
 * Canonical analysis sections and their default numbers. Used to recognize a
 * section header even when a (usually small on-device) model drops the leading
 * "## " marker or omits the number.
 */
const KNOWN_SECTION_KEYS: { key: string; number: string }[] = [
  { key: "shot performance", number: "1" },
  { key: "root cause", number: "2" },
  { key: "setup recommendation", number: "3" },
  { key: "profile recommendation", number: "4" },
  { key: "profile design", number: "5" },
];

function findKnownSection(title: string): { key: string; number: string } | null {
  const lower = title.toLowerCase();
  return KNOWN_SECTION_KEYS.find((k) => lower.includes(k.key)) ?? null;
}

/**
 * Tolerantly decide whether a single line is a section header and, if so,
 * return its number and title.
 *
 * Models routinely emit the first header as `## 1. Shot Performance` but then
 * drop the `## ` prefix, switch to `###`, wrap the title in bold, or omit the
 * number for later sections. The strict `^## (\d+)\. ` regex used previously
 * matched only the first header, collapsing every later section into the first
 * card. This accepts the common variants while rejecting bullets, subsection
 * labels (`**What Happened:**`), and numbered prose lines.
 */
export function matchSectionHeader(
  rawLine: string,
): { number: string; title: string } | null {
  let s = rawLine.trim();
  if (!s) return null;
  // Bulleted lines are never section headers.
  if (/^[-•*]\s/.test(s)) return null;

  const hashMatch = /^(#{1,6})\s+/.exec(s);
  const hadHash = hashMatch !== null;
  if (hadHash) s = s.slice(hashMatch![0].length).trim();

  // Only treat a line as bold-wrapped if the *entire* line is bold, so that
  // "**Assessment:** Good" (trailing prose) is not mistaken for a header.
  const boldMatch = /^\*\*(.+?)\*\*$/.exec(s) ?? /^__(.+?)__$/.exec(s);
  const hadBold = boldMatch !== null;
  if (hadBold) s = boldMatch![1].trim();

  // Drop a trailing colon a model may append ("Root Cause Analysis:").
  s = s.replace(/:$/, "").trim();

  let number: string | null = null;
  let title = s;
  const numMatch = /^(\d+)[.)]\s+(.+)$/.exec(s);
  if (numMatch) {
    number = numMatch[1];
    title = numMatch[2].trim();
  }

  const known = findKnownSection(title);

  // Acceptance rules:
  //  - a heading marker (#) with either a number or a known title
  //  - a fully bold-wrapped line with either a number or a known title
  //  - an unmarked line ONLY if it is a numbered, known section (the common
  //    "dropped ##" case) — this prevents numbered prose from matching.
  const accept =
    (hadHash && (number !== null || known !== null)) ||
    (hadBold && (number !== null || known !== null)) ||
    (!hadHash && !hadBold && number !== null && known !== null);
  if (!accept) return null;

  return { number: number ?? known?.number ?? "0", title };
}

// ---- Parser ----

/**
 * Parse a Gemini-generated structured analysis string into sections.
 *
 * Expected format:
 *   ## 1. Section Title
 *   **Subsection:**
 *   - bullet
 *   **Assessment:** [Good/Acceptable/Needs Improvement/Problematic]
 *
 * Header detection is tolerant (see {@link matchSectionHeader}) so loosely
 * formatted output still renders as separate cards instead of collapsing.
 */
export function parseStructuredAnalysis(text: string): ParsedSection[] {
  // TEMPORARY DIAGNOSTIC (remove after format debugging): dump the untouched
  // raw LLM analysis output so it can be copied from the console. Covers every
  // runtime and model because both ExpertAnalysisView and LlmAnalysisModal call
  // this function with the raw analysis string.
  console.log(
    "===== RAW ANALYSIS OUTPUT (start) =====\n" +
      text +
      "\n===== RAW ANALYSIS OUTPUT (end) =====",
  );

  // Strip the recommendations JSON (delimited or bare) before parsing sections
  // so it never leaks into prose as garbage bullet points.
  let cleanText = text;
  const located = locateRecommendationsJSON(cleanText);
  if (located) {
    cleanText = cleanText.slice(0, located.start) + cleanText.slice(located.end);
  }
  // Remove any residual delimiter markers left after an out-of-place array.
  cleanText = cleanText.replace(
    /RECOMMENDATIONS_JSON:\s*\n?|END_RECOMMENDATIONS_JSON/g,
    "",
  );

  // Strip internal prompt artifacts that may leak into the response
  cleanText = cleanText.replace(
    /^.*Structured Recommendations.*(?:\(MANDATORY\))?.*$/gim,
    "",
  );

  const sections: ParsedSection[] = [];

  // Scan line by line for tolerant section headers rather than a single strict
  // "## N. Title" regex, so dropped/loose markers do not collapse sections.
  interface HeaderHit {
    index: number;
    length: number;
    number: string;
    title: string;
  }
  const headers: HeaderHit[] = [];
  const lineRegex = /^.*$/gm;
  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = lineRegex.exec(cleanText)) !== null) {
    const parsed = matchSectionHeader(lineMatch[0]);
    if (parsed) {
      headers.push({
        index: lineMatch.index,
        length: lineMatch[0].length,
        number: parsed.number,
        title: parsed.title,
      });
    }
    // Guard against zero-length matches (empty lines) causing an infinite loop.
    if (lineMatch.index === lineRegex.lastIndex) lineRegex.lastIndex++;
  }

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const number = header.number;
    const title = `${number}. ${header.title}`;
    const startIndex = header.index + header.length;
    const endIndex =
      i < headers.length - 1 ? headers[i + 1].index : cleanText.length;
    const sectionContent = cleanText.slice(startIndex, endIndex).trim();

    // Parse subsections (bold headers like **What Happened:**)
    const subsections: { title: string; items: string[] }[] = [];
    const subsectionRegex = /\*\*([^*]+):\*\*/g;
    const subsectionMatches = [...sectionContent.matchAll(subsectionRegex)];

    for (let j = 0; j < subsectionMatches.length; j++) {
      const subMatch = subsectionMatches[j];
      const subTitle = subMatch[1].trim();
      const subStart = subMatch.index! + subMatch[0].length;
      const subEnd =
        j < subsectionMatches.length - 1
          ? subsectionMatches[j + 1].index!
          : sectionContent.length;
      const subContent = sectionContent.slice(subStart, subEnd).trim();

      const items = subContent
        .split("\n")
        .map((line) => line.replace(/^[-•]\s*/, "").trim())
        .filter((line) => line.length > 0 && !line.startsWith("**"));

      if (items.length > 0) {
        subsections.push({ title: subTitle, items });
      }
    }

    // Check for Assessment badge
    let assessment: { status: string; color: string } | undefined;
    const assessmentMatch = sectionContent.match(
      /\*\*Assessment:\*\*\s*\[?([^\]\n]+)\]?/i,
    );
    if (assessmentMatch) {
      const status = assessmentMatch[1].trim();
      let color = "bg-gray-600 dark:bg-gray-500";
      if (status.toLowerCase().includes("good"))
        color = "bg-green-700 dark:bg-green-500";
      else if (status.toLowerCase().includes("acceptable"))
        color = "bg-yellow-600 dark:bg-yellow-500";
      else if (status.toLowerCase().includes("needs improvement"))
        color = "bg-orange-700 dark:bg-orange-500";
      else if (status.toLowerCase().includes("problematic"))
        color = "bg-red-700 dark:bg-red-500";
      assessment = { status, color };
    }

    sections.push({
      title,
      number,
      content: sectionContent,
      subsections,
      assessment,
    });
  }

  // Filter out internal prompt artifacts that Gemini may echo back
  return sections.filter(
    (s) => !s.title.toLowerCase().includes("structured recommendations"),
  );
}

// ---- Recommendation Types & Parser ----

export interface Recommendation {
  variable: string;
  current_value: number;
  recommended_value: number;
  stage: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  is_patchable: boolean;
}

/**
 * Parse the RECOMMENDATIONS_JSON block from an analysis string.
 *
 * Expected format:
 *   RECOMMENDATIONS_JSON:
 *   [ ... ]
 *   END_RECOMMENDATIONS_JSON
 */
export function parseRecommendationsJSON(text: string): Recommendation[] {
  const located = locateRecommendationsJSON(text);
  if (!located) return [];

  const parsed = parseJsonArrayLoose(located.json);
  if (!parsed) return [];

  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      variable: String(item.variable ?? "").trim(),
      current_value: Number(item.current_value ?? 0),
      recommended_value: Number(item.recommended_value ?? 0),
      stage: String(item.stage ?? ""),
      confidence: (["high", "medium", "low"].includes(
        String(item.confidence),
      )
        ? String(item.confidence)
        : "low") as "high" | "medium" | "low",
      reason: String(item.reason ?? ""),
      is_patchable:
        item.is_patchable !== undefined ? Boolean(item.is_patchable) : true,
    }))
    // Drop hallucinated / non-actionable recommendations (weak on-device models
    // sometimes emit garbage variable ids like "flow_0" with NaN values). A
    // recommendation is only usable if it names a variable and both values are
    // finite numbers. Missing values coerce to 0 above, which is kept (advisory).
    .filter(
      (rec) =>
        rec.variable !== "" &&
        Number.isFinite(rec.current_value) &&
        Number.isFinite(rec.recommended_value),
    );
}

/**
 * Check if an analysis string contains recommendations (delimited or bare).
 */
export function hasRecommendations(text: string): boolean {
  return locateRecommendationsJSON(text) !== null;
}
