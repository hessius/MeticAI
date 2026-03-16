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

// ---- Parser ----

/**
 * Parse a Gemini-generated structured analysis string into sections.
 *
 * Expected format:
 *   ## 1. Section Title
 *   **Subsection:**
 *   - bullet
 *   **Assessment:** [Good/Acceptable/Needs Improvement/Problematic]
 */
export function parseStructuredAnalysis(text: string): ParsedSection[] {
  // Strip the RECOMMENDATIONS_JSON block before parsing sections
  const cleanText = text.replace(
    /RECOMMENDATIONS_JSON:\s*\n[\s\S]*?END_RECOMMENDATIONS_JSON/g,
    "",
  );

  const sections: ParsedSection[] = [];

  const sectionRegex = /^## (\d+)\.\s+(.+)$/gm;
  const matches = [...cleanText.matchAll(sectionRegex)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const number = match[1];
    const title = `${number}. ${match[2].trim()}`;
    const startIndex = match.index! + match[0].length;
    const endIndex =
      i < matches.length - 1 ? matches[i + 1].index! : cleanText.length;
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

  return sections;
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
  const match = text.match(
    /RECOMMENDATIONS_JSON:\s*\n\s*(\[[\s\S]*?\])\s*\n\s*END_RECOMMENDATIONS_JSON/,
  );
  if (!match) return [];

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
      .map((item) => ({
        variable: String(item.variable ?? ""),
        current_value: Number(item.current_value ?? 0),
        recommended_value: Number(item.recommended_value ?? 0),
        stage: String(item.stage ?? ""),
        confidence: (["high", "medium", "low"].includes(
          String(item.confidence),
        )
          ? String(item.confidence)
          : "low") as "high" | "medium" | "low",
        reason: String(item.reason ?? ""),
        is_patchable: item.is_patchable !== undefined ? Boolean(item.is_patchable) : false,
      }));
  } catch {
    return [];
  }
}

/**
 * Check if an analysis string contains a RECOMMENDATIONS_JSON block.
 */
export function hasRecommendations(text: string): boolean {
  return /RECOMMENDATIONS_JSON:\s*\n/.test(text);
}
