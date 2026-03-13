import { describe, it, expect } from "vitest";
import {
  parseRecommendationsJSON,
  hasRecommendations,
} from "./parseAnalysis";

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
