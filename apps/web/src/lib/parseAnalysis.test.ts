import { describe, it, expect } from "vitest";
import {
  parseStructuredAnalysis,
  parseRecommendationsJSON,
  hasRecommendations,
} from "./parseAnalysis";

describe("parseStructuredAnalysis", () => {
  it("filters out Structured Recommendations section from parsed output", () => {
    const text = `## 1. Shot Performance

**What Happened:**
- Good extraction overall

**Assessment:** Good

## 2. Root Cause Analysis

**Primary Factors:**
- Slight over-extraction

## 6. Structured Recommendations (MANDATORY)

- structured recommendations (MANDATORY)

RECOMMENDATIONS_JSON:
[{"variable":"flow","current_value":2.5,"recommended_value":3.0,"stage":"main","confidence":"high","reason":"test","is_patchable":true}]
END_RECOMMENDATIONS_JSON
`;
    const sections = parseStructuredAnalysis(text);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toContain("Shot Performance");
    expect(sections[1].title).toContain("Root Cause");
    expect(sections.some(s => s.title.toLowerCase().includes("structured recommendations"))).toBe(false);
  });
});

describe("parseRecommendationsJSON", () => {
  it("parses a valid RECOMMENDATIONS_JSON block", () => {
    const text = `## 1. Shot Analysis
Some text here.

RECOMMENDATIONS_JSON:
[
  {
    "variable": "flow_main",
    "current_value": 2.5,
    "recommended_value": 3.0,
    "stage": "extraction",
    "confidence": "high",
    "reason": "Under-extraction detected",
    "is_patchable": true
  },
  {
    "variable": "temperature",
    "current_value": 92,
    "recommended_value": 94,
    "stage": "global",
    "confidence": "medium",
    "reason": "Higher temp for dark roast",
    "is_patchable": true
  }
]
END_RECOMMENDATIONS_JSON
`;
    const recs = parseRecommendationsJSON(text);
    expect(recs).toHaveLength(2);
    expect(recs[0].variable).toBe("flow_main");
    expect(recs[0].recommended_value).toBe(3.0);
    expect(recs[0].confidence).toBe("high");
    expect(recs[0].is_patchable).toBe(true);
    expect(recs[1].stage).toBe("global");
  });

  it("returns empty array when no block is present", () => {
    const text = "## Shot Analysis\nJust regular analysis text.";
    expect(parseRecommendationsJSON(text)).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const text = `RECOMMENDATIONS_JSON:
[{broken json!!!
END_RECOMMENDATIONS_JSON`;
    expect(parseRecommendationsJSON(text)).toEqual([]);
  });

  it("returns empty array for empty array block", () => {
    const text = `RECOMMENDATIONS_JSON:
[]
END_RECOMMENDATIONS_JSON`;
    expect(parseRecommendationsJSON(text)).toEqual([]);
  });

  it("defaults unknown confidence to 'low'", () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"x","current_value":1,"recommended_value":2,"stage":"s","confidence":"unknown","reason":"r","is_patchable":true}]
END_RECOMMENDATIONS_JSON`;
    const recs = parseRecommendationsJSON(text);
    expect(recs[0].confidence).toBe("low");
  });

  it("coerces missing fields to safe defaults", () => {
    const text = `RECOMMENDATIONS_JSON:
[{}]
END_RECOMMENDATIONS_JSON`;
    const recs = parseRecommendationsJSON(text);
    expect(recs).toHaveLength(1);
    expect(recs[0].variable).toBe("");
    expect(recs[0].current_value).toBe(0);
    expect(recs[0].recommended_value).toBe(0);
    expect(recs[0].is_patchable).toBe(true);
  });

  it("defaults is_patchable to true when field is missing", () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"grind_size","current_value":15,"recommended_value":14,"stage":"prep","confidence":"high","reason":"Finer grind needed"}]
END_RECOMMENDATIONS_JSON`;
    const recs = parseRecommendationsJSON(text);
    expect(recs).toHaveLength(1);
    expect(recs[0].is_patchable).toBe(true);
    expect(recs[0].variable).toBe("grind_size");
  });

  it("respects explicit is_patchable false from backend", () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"info_note","current_value":0,"recommended_value":0,"stage":"global","confidence":"low","reason":"General advice","is_patchable":false}]
END_RECOMMENDATIONS_JSON`;
    const recs = parseRecommendationsJSON(text);
    expect(recs).toHaveLength(1);
    expect(recs[0].is_patchable).toBe(false);
  });
});

describe("hasRecommendations", () => {
  it("returns true when block exists", () => {
    const text = `Some analysis
RECOMMENDATIONS_JSON:
[{"variable":"x"}]
END_RECOMMENDATIONS_JSON`;
    expect(hasRecommendations(text)).toBe(true);
  });

  it("returns false when no block exists", () => {
    expect(hasRecommendations("Just regular text")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasRecommendations("")).toBe(false);
  });
});

describe("malformed on-device model output (missing delimiters)", () => {
  // Reproduces the Apple Intelligence bug where a bare recommendations array
  // leaked into the "Potential Improvements" prose as garbage bullet points.
  const leaked = `## 5. Profile Design Observations

**Potential Improvements:**
- The pre-infusion duration could be increased.
- Using a finer grind could help extraction.

[
  {
    "variable": "pressure_PreBrew",
    "current_value": 1.8,
    "recommended_value": 2.5,
    "stage": "PreBrew",
    "confidence": "high",
    "reason": "Increase pressure during pre-infusion to ensure puck saturation."
  }
]
`;

  it("strips a bare (undelimited) recommendations array from section prose", () => {
    const sections = parseStructuredAnalysis(leaked);
    expect(sections).toHaveLength(1);
    const content = sections[0].content;
    expect(content).not.toContain('"variable"');
    expect(content).not.toContain("pressure_PreBrew");
    expect(content).not.toContain("[");
    const items = sections[0].subsections[0].items;
    expect(items).toEqual([
      "The pre-infusion duration could be increased.",
      "Using a finer grind could help extraction.",
    ]);
  });

  it("recovers recommendations from a bare (undelimited) array", () => {
    const recs = parseRecommendationsJSON(leaked);
    expect(recs).toHaveLength(1);
    expect(recs[0].variable).toBe("pressure_PreBrew");
    expect(recs[0].recommended_value).toBe(2.5);
    expect(recs[0].confidence).toBe("high");
  });

  it("hasRecommendations detects a bare array", () => {
    expect(hasRecommendations(leaked)).toBe(true);
  });

  it("tolerates trailing commas in a delimited block", () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"flow","current_value":2.5,"recommended_value":3.0,"stage":"main","confidence":"high","reason":"r","is_patchable":true},]
END_RECOMMENDATIONS_JSON`;
    const recs = parseRecommendationsJSON(text);
    expect(recs).toHaveLength(1);
    expect(recs[0].variable).toBe("flow");
  });

  it("does not treat prose mentioning variables as a recommendations array", () => {
    const text = "## 1. Shot Performance\n\n**Notes:**\n- The flow variable was stable.";
    expect(parseRecommendationsJSON(text)).toEqual([]);
    expect(hasRecommendations(text)).toBe(false);
  });
});
