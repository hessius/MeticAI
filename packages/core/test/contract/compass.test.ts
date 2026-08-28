import { describe, it, expect } from "vitest";
import { compassAdjustments } from "../../src/logic/compass";

describe("compassAdjustments (D6)", () => {
  it("sour + weak suggests finer and hotter", () => {
    const adj = compassAdjustments(-0.8, -0.6);
    const kinds = adj.map((a) => a.kind);
    expect(kinds).toContain("grind_finer");
    expect(
      kinds.some((k) => ["temp_up", "ratio_up", "dose_up"].includes(k)),
    ).toBe(true);
  });
  it("bitter + strong suggests coarser", () => {
    expect(compassAdjustments(0.8, 0.7).map((a) => a.kind)).toContain(
      "grind_coarser",
    );
  });
  it("centered taste returns no changes", () => {
    expect(compassAdjustments(0, 0)).toEqual([]);
  });
});
