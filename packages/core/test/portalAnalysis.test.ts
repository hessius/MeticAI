import { describe, test, expect } from "vitest";
import {
  analyzePortalShot,
  buildSegments,
  evalEcAt,
  fitCalibration,
  fitForCoffee,
  predictTds,
  estimateForShot,
  extractionYield,
  coffeeKey,
  downsample,
  type CalibrationPoint,
  type PortalSample,
  type WeightSample,
} from "../src/logic/portalAnalysis";
import {
  parsePortalMeasurement,
  encodePortalMeasurement,
  PORTAL_CMD_SHOW_GRAPH,
  PORTAL_CMD_HIDE_GRAPH,
  PORTAL_SERVICE_UUID,
} from "../src/logic/portalProtocol";

/** A synthetic shot: EC decays over the pour while the cup fills linearly. */
function syntheticShot(opts: { seconds?: number; ecPeak?: number; outG?: number; rate?: number } = {}) {
  const seconds = opts.seconds ?? 30;
  const ecPeak = opts.ecPeak ?? 3.2;
  const outG = opts.outG ?? 40;
  const rate = opts.rate ?? 8;
  const portal: PortalSample[] = [];
  for (let i = 0; i <= seconds * rate; i++) {
    const t = i / rate;
    const ec = t < 6 ? 0 : ecPeak * Math.exp(-(t - 6) / 14) + 0.3;
    portal.push({ t, ec, tOut: 62 });
  }
  const weight: WeightSample[] = [];
  for (let i = 0; i <= seconds * 2; i++) {
    const t = i / 2;
    weight.push({ t, w: t < 6 ? 0 : Math.min(outG, ((t - 6) / (seconds - 6)) * outG) });
  }
  return { portal, weight };
}

describe("portal analysis: segments and interpolation", () => {
  test("segments split at gaps and interpolate inside", () => {
    const s: PortalSample[] = [
      { t: 0, ec: 1 },
      { t: 0.5, ec: 2 },
      { t: 1.0, ec: 3 },
      { t: 5.0, ec: 10 }, // gap of 4 s
      { t: 5.5, ec: 11 },
    ];
    const segs = buildSegments(s, 1.0);
    expect(segs.length).toBe(2);
    expect(evalEcAt(segs, 0.75)?.ec).toBe(2.5);
    expect(evalEcAt(segs, 3.0)).toBeNull(); // in the gap
    expect(evalEcAt(segs, 5.25)?.ec).toBe(10.5);
  });

  test("duplicate timestamps keep the last sample; non-finite samples are dropped", () => {
    const segs = buildSegments([
      { t: 1, ec: 5 },
      { t: 1, ec: 6 },
      { t: NaN, ec: 7 },
      { t: 2, ec: Number.POSITIVE_INFINITY },
    ]);
    expect(segs).toEqual([[{ t: 1, ec: 6 }]]);
  });
});

describe("portal analysis: mass-space integral", () => {
  test("constant EC over a linear weight ramp integrates analytically", () => {
    // EC = 2 everywhere, mass 0→40 g over 20 s  ⇒  ∫EC dm = 80, mean = 2
    const portal = Array.from({ length: 201 }, (_, i) => ({ t: i * 0.1, ec: 2, tOut: 60 }));
    const weight = Array.from({ length: 41 }, (_, i) => ({ t: i * 0.5, w: i }));
    const r = analyzePortalShot(portal, weight);
    expect(r.status).toBe("ok");
    expect(r.totalMassG).toBe(40);
    expect(r.integralEcG).toBeCloseTo(80, 6);
    expect(r.meanEcPerG).toBeCloseTo(2, 6);
    expect(r.coverageRatio).toBeCloseTo(1, 6);
    expect(r.meanTempC).toBe(60);
    expect(r.curve[r.curve.length - 1]!.I).toBeCloseTo(80, 6);
  });

  test("a gap in the Portal stream lowers coverage and is reported", () => {
    const portal = [
      ...Array.from({ length: 50 }, (_, i) => ({ t: i * 0.1, ec: 2 })),
      ...Array.from({ length: 50 }, (_, i) => ({ t: 15 + i * 0.1, ec: 2 })),
    ];
    const weight = Array.from({ length: 41 }, (_, i) => ({ t: i * 0.5, w: i }));
    const r = analyzePortalShot(portal, weight);
    expect(r.gapCount).toBe(1);
    expect(r.coverageRatio).toBeLessThan(0.85);
    expect(r.status).toBe("low-coverage");
    expect(r.reasons.join(" ")).toMatch(/gap/);
  });

  test("status codes for missing inputs", () => {
    expect(analyzePortalShot([], [{ t: 0, w: 0 }, { t: 1, w: 10 }]).status).toBe("no-portal-data");
    expect(analyzePortalShot([{ t: 0, ec: 1 }, { t: 1, ec: 1 }], []).status).toBe("no-weight-data");
    expect(analyzePortalShot([{ t: 0, ec: 1 }, { t: 1, ec: 1 }], [{ t: 0, w: 0 }, { t: 1, w: 2 }]).status).toBe("insufficient-mass");
  });

  test("lag shifts the EC curve against the scale; stop time splits active from drips", () => {
    const { portal, weight } = syntheticShot();
    const a = analyzePortalShot(portal, weight, { stopTimeSec: 25 });
    expect(a.status).toBe("ok");
    expect(a.activeIntegralEcG).toBeLessThan(a.integralEcG);
    expect(a.mainPeakMassG).toBeGreaterThanOrEqual(2);
    expect(a.firstDropTimeSec).toBeCloseTo(6, 0);
    expect(a.massAt90PctG).toBeGreaterThan(a.massAt85PctG);
    expect(a.tail.last5g!.share).toBeGreaterThan(0);
    expect(a.tail.last5g!.slopePerG).toBeLessThan(0); // EC still falling at the end
    const lagged = analyzePortalShot(portal, weight, { lagSec: 1 });
    expect(lagged.meanEcPerG).not.toBeCloseTo(a.meanEcPerG, 3);
  });

  test("weight curve is made monotone (scale noise never lowers cumulative mass)", () => {
    const portal = Array.from({ length: 201 }, (_, i) => ({ t: i * 0.1, ec: 1 }));
    const weight = Array.from({ length: 41 }, (_, i) => ({ t: i * 0.5, w: i - (i % 3 === 0 ? 0.4 : 0) }));
    const r = analyzePortalShot(portal, weight);
    for (let i = 1; i < r.curve.length; i++) expect(r.curve[i]!.m).toBeGreaterThan(r.curve[i - 1]!.m);
  });
});

describe("portal analysis: calibration", () => {
  const pts = (n: number, k = 3.0, noise = 0): CalibrationPoint[] =>
    Array.from({ length: n }, (_, i) => {
      const x = 1.2 + i * 0.1;
      return { id: `s${i}`, meanEcPerG: x, tdsPct: k * x + (i % 2 ? noise : -noise), coffeeKey: "a" };
    });

  test("proportional fit recovers k with leave-one-out error", () => {
    const fit = fitCalibration(pts(6));
    expect(fit.calibrated).toBe(true);
    expect(fit.activeModel).toBe("proportional");
    expect(fit.proportional!.k).toBeCloseTo(3.0, 6);
    expect(fit.proportional!.loocvRmse).toBeCloseTo(0, 6);
    expect(fit.preliminary).toBe(false);
    expect(predictTds(fit, 2)).toBeCloseTo(6, 6);
  });

  test("fewer than minShots is preliminary; unreliable and excluded points are skipped", () => {
    const fit = fitCalibration([...pts(3), { id: "bad", meanEcPerG: 2, tdsPct: 20, reliable: false }], { excludeId: "s0" });
    expect(fit.shotCount).toBe(2);
    expect(fit.preliminary).toBe(true);
    expect(fit.excludedCount).toBe(1);
  });

  test("affine model only wins when it is clearly better out of sample", () => {
    // TDS = 2x + 1 over a wide spread: the intercept is real, affine should win.
    const affinePts: CalibrationPoint[] = Array.from({ length: 8 }, (_, i) => {
      const x = 1 + i * 0.3;
      return { id: `a${i}`, meanEcPerG: x, tdsPct: 2 * x + 1 };
    });
    const fit = fitCalibration(affinePts);
    expect(fit.affine).not.toBeNull();
    expect(fit.activeModel).toBe("affine");
    expect(predictTds(fit, 2)).toBeCloseTo(5, 6);
  });

  test("extraction yield", () => {
    expect(extractionYield(9, 40, 18)).toBeCloseTo(20, 6);
    expect(extractionYield(9, 40, 0)).toBeNull();
    expect(extractionYield(null, 40, 18)).toBeNull();
  });
});

describe("portal analysis: pools and estimates", () => {
  const points: CalibrationPoint[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `h${i}`, meanEcPerG: 1.5 + i * 0.05, tdsPct: 3 * (1.5 + i * 0.05), coffeeKey: "hatch" })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `r${i}`, meanEcPerG: 1.4 + i * 0.1, tdsPct: 2.8 * (1.4 + i * 0.1), coffeeKey: "revolver" })),
  ];

  test("auto picks this coffee when it has enough shots", () => {
    const fit = fitForCoffee(points, "Hatch", "auto");
    expect(fit.pool).toBe("coffee");
    expect(fit.shotCount).toBe(5);
    expect(fit.fallbackFrom).toBeNull();
  });

  test("auto falls back to all coffees when this coffee has none, and flags it", () => {
    const fit = fitForCoffee(points, "Kilimanjaro", "auto");
    expect(fit.pool).toBe("all");
    expect(fit.fallbackFrom).toBe("coffee");
    expect(fit.distinctCoffees).toBe(2);
    const est = estimateForShot({ status: "ok", meanEcPerG: 1.6, totalMassG: 40 }, fit, { doseG: 18 });
    expect(est.tdsPct).toBeGreaterThan(4);
    expect(est.eyPct).toBeGreaterThan(0);
  });

  test("pinning to this coffee with too few readings stays preliminary", () => {
    const fit = fitForCoffee(points, "Revolver", "coffee");
    expect(fit.pool).toBe("coffee");
    expect(fit.preliminary).toBe(true);
    const est = estimateForShot({ status: "ok", meanEcPerG: 1.45, totalMassG: 40 }, fit, {});
    expect(est.flags.some((f) => /Preliminary/.test(f))).toBe(true);
  });

  test("no calibration and bad analyses produce null estimates with a reason", () => {
    const none = fitForCoffee([], "x");
    expect(estimateForShot({ status: "ok", meanEcPerG: 1.5, totalMassG: 40 }, none, {}).tdsPct).toBeNull();
    const fit = fitForCoffee(points, "Hatch");
    expect(estimateForShot({ status: "no-portal-data", meanEcPerG: 0, totalMassG: 0 }, fit, {}).tdsPct).toBeNull();
    const low = estimateForShot({ status: "low-coverage", meanEcPerG: 1.6, totalMassG: 40 }, fit, {});
    expect(low.tdsPct).not.toBeNull();
    expect(low.flags.some((f) => /not reliable/.test(f))).toBe(true);
    const extrapolated = estimateForShot({ status: "ok", meanEcPerG: 3.0, totalMassG: 40 }, fit, {});
    expect(extrapolated.flags.some((f) => /extrapolated/.test(f))).toBe(true);
  });

  test("coffee keys normalise case and whitespace", () => {
    expect(coffeeKey("  Hatch   Supernova ")).toBe("hatch supernova");
    expect(coffeeKey(null)).toBe("");
  });

  test("downsample keeps first and last", () => {
    const d = downsample(Array.from({ length: 100 }, (_, i) => i), 10);
    expect(d.length).toBe(10);
    expect(d[0]).toBe(0);
    expect(d[9]).toBe(99);
  });
});

describe("portal protocol", () => {
  test("13-byte packet round-trips through encode/parse", () => {
    const bytes = encodePortalMeasurement({ ec: 2.75, tInt: 31.5, tOut: 64.25, status: 7 });
    expect(bytes.length).toBe(13);
    const m = parsePortalMeasurement(new DataView(bytes.buffer));
    expect(m).toEqual({ ec: 2.75, tInt: 31.5, tOut: 64.25, status: 7 });
  });

  test("other lengths are rejected", () => {
    expect(parsePortalMeasurement(new DataView(new ArrayBuffer(12)))).toBeNull();
    expect(parsePortalMeasurement(new DataView(new ArrayBuffer(20)))).toBeNull();
  });

  test("constants match the documented protocol", () => {
    expect(PORTAL_SERVICE_UUID).toBe(0x7400);
    expect([...PORTAL_CMD_SHOW_GRAPH]).toEqual([0x40, 0x00, 0x01, 0x2d]);
    expect([...PORTAL_CMD_HIDE_GRAPH]).toEqual([0x40, 0x00, 0x01, 0x2e]);
  });
});
