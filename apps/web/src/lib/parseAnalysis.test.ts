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

  it("coerces missing numeric fields to safe defaults", () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"grind_size"}]
END_RECOMMENDATIONS_JSON`;
    const recs = parseRecommendationsJSON(text);
    expect(recs).toHaveLength(1);
    expect(recs[0].variable).toBe("grind_size");
    expect(recs[0].current_value).toBe(0);
    expect(recs[0].recommended_value).toBe(0);
    expect(recs[0].is_patchable).toBe(true);
  });

  it("drops an empty recommendation object", () => {
    const text = `RECOMMENDATIONS_JSON:
[{}]
END_RECOMMENDATIONS_JSON`;
    expect(parseRecommendationsJSON(text)).toEqual([]);
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

  it("drops hallucinated recs with NaN values but keeps valid ones", () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"flow_0","current_value":"NaN","recommended_value":"NaN","stage":"main","confidence":"low","reason":"r"},{"variable":"flow","current_value":2.5,"recommended_value":3.0,"stage":"main","confidence":"high","reason":"r"}]
END_RECOMMENDATIONS_JSON`;
    const recs = parseRecommendationsJSON(text);
    expect(recs).toHaveLength(1);
    expect(recs[0].variable).toBe("flow");
  });

  it("drops recs with a blank variable name", () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"","current_value":1,"recommended_value":2,"stage":"main","confidence":"low","reason":"r"}]
END_RECOMMENDATIONS_JSON`;
    expect(parseRecommendationsJSON(text)).toEqual([]);
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

describe("tolerant section-header detection", () => {
  it("splits sections when a model drops the '##' prefix on later headers", () => {
    const text = `## 1. Shot Performance

**What Happened:**
- Good extraction overall

2. Root Cause Analysis

**Primary Factors:**
- Slight over-extraction

3. Setup Recommendations

**Priority Changes:**
- Grind 1 step finer
`;
    const sections = parseStructuredAnalysis(text);
    expect(sections).toHaveLength(3);
    expect(sections[0].title).toContain("Shot Performance");
    expect(sections[1].title).toContain("Root Cause");
    expect(sections[2].title).toContain("Setup Recommendations");
    // The Root Cause content must NOT be swallowed into the first card.
    expect(sections[0].content).not.toContain("Slight over-extraction");
    expect(sections[1].subsections[0].items).toEqual(["Slight over-extraction"]);
  });

  it("recognizes '###' and bold headers, numbered or not", () => {
    const text = `### 1. Shot Performance

**What Happened:**
- Even extraction

**Root Cause Analysis**

**Primary Factors:**
- Channeling suspected

## Profile Design Observations

**Strengths:**
- Clean ramp
`;
    const sections = parseStructuredAnalysis(text);
    expect(sections).toHaveLength(3);
    expect(sections[0].title).toContain("Shot Performance");
    expect(sections[1].title).toContain("Root Cause");
    expect(sections[2].title).toContain("Profile Design");
  });

  it("does not treat bullets, subsection labels, or numbered prose as headers", () => {
    const text = `## 1. Shot Performance

**What Happened:**
- The flow was stable at 2.5 ml/s
- 1. This bullet looks numbered but is content

**Steps To Try:**
- Adjust grind

**Assessment:** Good
`;
    const sections = parseStructuredAnalysis(text);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toContain("Shot Performance");
    // "**What Happened:**" and "**Steps To Try:**" are subsections, not sections.
    const subTitles = sections[0].subsections.map((s) => s.title);
    expect(subTitles).toContain("What Happened");
    expect(subTitles).toContain("Steps To Try");
    expect(sections[0].assessment?.status).toBe("Good");
  });

  it("splits sections when a model wraps headers in bold instead of '##'", () => {
    const text = `**1. Shot Performance**

**What Happened:**
- Solid shot

**2. Root Cause Analysis**

**Primary Factors:**
- Grind slightly coarse
`;
    const sections = parseStructuredAnalysis(text);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toContain("Shot Performance");
    expect(sections[1].title).toContain("Root Cause");
  });
});
