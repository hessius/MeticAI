/**
 * Belka Portal conductivity analysis — pure, host-free maths shared by both
 * runtimes (server and native/direct).
 *
 * The Belka Portal is a Bluetooth sensor that sits under the portafilter and
 * reports the electrical conductivity (EC) and temperature of the liquid
 * passing through it, at roughly 8 Hz. EC is a *concentration proxy*: it is not
 * a refractometer reading and it is not TDS. The primary result here is
 * therefore the mass-weighted integral
 *
 *     ∫ EC(m) dm   over cumulative cup mass m (from the machine's scale)
 *
 * and its normalisation `meanEcPerG = ∫EC dm / covered mass`. Nothing in this
 * module turns EC into a TDS% unless the caller supplies a calibration fitted
 * from paired refractometer readings for the same coffee, water and mounting —
 * and every estimate carries flags saying how much to trust it.
 *
 * Conventions: time in seconds from shot start, mass in grams, EC in the
 * Portal's own units (mS/cm presumed).
 *
 * Ported from portal-met-bridge (MIT, github.com/privaterra/portal-met-bridge),
 * whose method follows the Decenza Portal calibration work.
 */

export interface PortalSample {
  /** Seconds since shot start (machine clock). */
  t: number;
  /** Conductivity in the Portal's units. */
  ec: number;
  /** Outlet (liquid) temperature in °C, when present. */
  tOut?: number;
  /** Portal's internal temperature in °C, when present. */
  tInt?: number;
  /** Raw status byte (battery-like; semantics unverified). */
  status?: number;
}

export interface WeightSample {
  /** Seconds since shot start. */
  t: number;
  /** Cup weight in grams from the machine's scale. */
  w: number;
}

export const PORTAL_ANALYSIS_DEFAULTS = Object.freeze({
  /** A pause longer than this between Portal samples is a gap. */
  gapSplitSec: 1.0,
  /** Evaluate EC this far past a segment edge before giving up. */
  boundaryClampSec: 0.5,
  /** Ignore the first drops when locating the main peak. */
  activePeakMinMassG: 2.0,
  minTotalMassG: 5.0,
  minCoverageRatio: 0.85,
  tailWindowsG: [2, 5] as readonly number[],
  /** EC above this counts as coffee, not water. */
  firstDropEc: 0.05,
  firstDropMassG: 0.3,
  minCalibrationShots: 5,
});

export interface PortalAnalysisOptions {
  /** Dose in grams (for the dose-normalised integral). */
  doseG?: number;
  /** Seconds the Portal leads (+) or lags (−) the cup. */
  lagSec?: number;
  /** Time the pump stopped; integral after it is counted as drips. */
  stopTimeSec?: number;
  gapSplitSec?: number;
  boundaryClampSec?: number;
  activePeakMinMassG?: number;
  minTotalMassG?: number;
  minCoverageRatio?: number;
  tailWindowsG?: readonly number[];
  firstDropEc?: number;
  firstDropMassG?: number;
}

export type PortalAnalysisStatus =
  | "ok"
  | "no-portal-data"
  | "no-weight-data"
  | "insufficient-mass"
  | "low-coverage";

export interface TailFeature {
  mean: number;
  share: number;
  ratioToPeak: number;
  slopePerG?: number;
}

export interface PortalCurvePoint {
  m: number;
  ec: number | null;
  I: number;
  t: number;
}

export interface PortalAnalysis {
  status: PortalAnalysisStatus;
  reasons: string[];
  portalSampleCount: number;
  gapCount: number;
  totalMassG: number;
  coveredMassG: number;
  coverageRatio: number;
  integralEcG: number;
  activeIntegralEcG: number;
  meanEcPerG: number;
  doseNormalizedIntegral: number;
  peakEc: number;
  peakTimeSec: number;
  mainPeakEc: number;
  mainPeakMassG: number;
  finalEc: number;
  meanTempC: number | null;
  maxTempC: number | null;
  firstDropTimeSec: number | null;
  tail: Record<string, TailFeature>;
  massAt85PctG: number;
  massAt90PctG: number;
  /** EC vs cumulative mass with the running integral, for plotting. */
  curve: PortalCurvePoint[];
}

/** The subset of an analysis worth caching next to a stored recording. */
export interface PortalAnalysisSummary {
  status: PortalAnalysisStatus;
  meanEcPerG: number;
  integralEcG: number;
  coverageRatio: number;
  mainPeakEc: number;
  meanTempC: number | null;
  totalMassG: number;
}

export function summarizePortalAnalysis(a: PortalAnalysis): PortalAnalysisSummary {
  return {
    status: a.status,
    meanEcPerG: a.meanEcPerG,
    integralEcG: a.integralEcG,
    coverageRatio: a.coverageRatio,
    mainPeakEc: a.mainPeakEc,
    meanTempC: a.meanTempC,
    totalMassG: a.totalMassG,
  };
}

// ---------------------------------------------------------------- segments --

type Segment = PortalSample[];

/** Split Portal samples into continuous segments at gaps. */
export function buildSegments(
  samples: PortalSample[],
  gapSplitSec: number = PORTAL_ANALYSIS_DEFAULTS.gapSplitSec,
): Segment[] {
  const clean = samples
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.ec))
    .sort((a, b) => a.t - b.t);
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const s of clean) {
    if (!current || s.t - current[current.length - 1]!.t > gapSplitSec) {
      current = [];
      segments.push(current);
    }
    if (current.length && current[current.length - 1]!.t === s.t) {
      current[current.length - 1] = s; // last write wins on duplicate timestamps
    } else {
      current.push(s);
    }
  }
  return segments;
}

/** Linear interpolation of EC at time t within a segment; null in a gap. */
export function evalEcAt(
  segments: Segment[],
  t: number,
  clampSec: number = PORTAL_ANALYSIS_DEFAULTS.boundaryClampSec,
): { ec: number; seg: number } | null {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const first = seg[0]!;
    const last = seg[seg.length - 1]!;
    if (t < first.t - clampSec || t > last.t + clampSec) continue;
    if (t <= first.t) return { ec: first.ec, seg: i };
    if (t >= last.t) return { ec: last.ec, seg: i };
    let lo = 0;
    let hi = seg.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (seg[mid]!.t <= t) lo = mid;
      else hi = mid;
    }
    const a = seg[lo]!;
    const b = seg[hi]!;
    const alpha = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return { ec: a.ec + alpha * (b.ec - a.ec), seg: i };
  }
  return null;
}

// ------------------------------------------------------------ weight curve --

interface MassPoint {
  t: number;
  m: number;
}

/** Monotone (running-max) cumulative cup mass, deduplicated by time. */
export function cleanWeightCurve(weightSamples: WeightSample[]): MassPoint[] {
  const pts = weightSamples
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.w))
    .sort((a, b) => a.t - b.t);
  const out: MassPoint[] = [];
  let runningMax = 0;
  for (const p of pts) {
    if (out.length && p.t === out[out.length - 1]!.t) continue;
    runningMax = Math.max(runningMax, p.w);
    out.push({ t: p.t, m: runningMax });
  }
  return out;
}

function massAtTime(curve: MassPoint[], t: number): number {
  if (!curve.length) return 0;
  if (t <= curve[0]!.t) return curve[0]!.m;
  if (t >= curve[curve.length - 1]!.t) return curve[curve.length - 1]!.m;
  let lo = 0;
  let hi = curve.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = curve[lo]!;
  const b = curve[hi]!;
  const alpha = (t - a.t) / (b.t - a.t);
  return a.m + alpha * (b.m - a.m);
}

// ------------------------------------------------------------- the analysis --

interface Knot {
  t: number;
  m: number;
  ec: number | null;
  seg: number;
  I: number;
  covered?: number;
}

/**
 * Mass-space analysis of one shot: Portal samples paired with the machine's
 * cup-weight curve.
 */
export function analyzePortalShot(
  portalSamples: PortalSample[],
  weightSamples: WeightSample[],
  opts: PortalAnalysisOptions = {},
): PortalAnalysis {
  const o = { ...PORTAL_ANALYSIS_DEFAULTS, lagSec: 0, doseG: 0, stopTimeSec: 0, ...opts };
  const result: PortalAnalysis = {
    status: "ok",
    reasons: [],
    portalSampleCount: 0,
    gapCount: 0,
    totalMassG: 0,
    coveredMassG: 0,
    coverageRatio: 0,
    integralEcG: 0,
    activeIntegralEcG: 0,
    meanEcPerG: 0,
    doseNormalizedIntegral: 0,
    peakEc: 0,
    peakTimeSec: 0,
    mainPeakEc: 0,
    mainPeakMassG: 0,
    finalEc: 0,
    meanTempC: null,
    maxTempC: null,
    firstDropTimeSec: null,
    tail: {},
    massAt85PctG: 0,
    massAt90PctG: 0,
    curve: [],
  };

  const segments = buildSegments(portalSamples, o.gapSplitSec);
  const valid = segments.reduce((n, s) => n + s.length, 0);
  result.portalSampleCount = valid;
  result.gapCount = Math.max(0, segments.length - 1);

  if (valid >= 1) {
    let tempSum = 0;
    let tempN = 0;
    for (const seg of segments) {
      for (const s of seg) {
        if (s.ec > result.peakEc) {
          result.peakEc = s.ec;
          result.peakTimeSec = s.t;
        }
        if (typeof s.tOut === "number" && Number.isFinite(s.tOut)) {
          tempSum += s.tOut;
          tempN++;
          result.maxTempC = result.maxTempC === null ? s.tOut : Math.max(result.maxTempC, s.tOut);
        }
      }
    }
    if (tempN) result.meanTempC = tempSum / tempN;
  }

  if (valid < 2) {
    result.status = "no-portal-data";
    result.reasons.push("Fewer than two valid Portal samples.");
    return result;
  }

  const curve = cleanWeightCurve(weightSamples);
  if (curve.length < 2) {
    result.status = "no-weight-data";
    result.reasons.push("Fewer than two weight samples from the machine scale.");
    return result;
  }
  result.totalMassG = curve[curve.length - 1]!.m;
  if (result.totalMassG < o.minTotalMassG) {
    result.status = "insufficient-mass";
    result.reasons.push(`Only ${result.totalMassG.toFixed(1)} g reached the cup.`);
    return result;
  }

  // First drop: earliest time the scale shows mass or the Portal sees coffee.
  const firstByMass = curve.find((p) => p.m >= o.firstDropMassG);
  const firstByEc = segments.flat().find((s) => s.ec >= o.firstDropEc);
  const cands = [firstByMass?.t, firstByEc?.t].filter((x): x is number => Number.isFinite(x));
  if (cands.length) result.firstDropTimeSec = Math.min(...cands);

  // Knots: every scale sample and every Portal sample (shifted by lag), in time
  // order, each carrying interpolated mass and EC so sparse scale packets do not
  // erase chemistry observed between them.
  const t0 = curve[0]!.t;
  const tEnd = curve[curve.length - 1]!.t;
  const times = new Set<number>(curve.map((p) => p.t));
  for (const seg of segments) {
    for (const s of seg) {
      const tt = s.t - o.lagSec;
      if (tt > t0 && tt < tEnd) times.add(tt);
    }
  }
  if (o.stopTimeSec > t0 && o.stopTimeSec < tEnd) times.add(o.stopTimeSec);
  const knots: Knot[] = [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const e = evalEcAt(segments, t + o.lagSec, o.boundaryClampSec);
      return { t, m: massAtTime(curve, t), ec: e ? e.ec : null, seg: e ? e.seg : -1, I: 0 };
    });

  // Trapezoidal integration in cumulative-mass space, only across covered steps.
  let total = 0;
  let active = 0;
  let covered = 0;
  const hasStop = o.stopTimeSec > 0;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]!;
    const b = knots[i]!;
    const dm = b.m - a.m;
    if (dm > 0 && a.ec !== null && b.ec !== null && a.seg === b.seg) {
      const step = 0.5 * (a.ec + b.ec) * dm;
      total += step;
      covered += dm;
      if (!hasStop || b.t <= o.stopTimeSec) active += step;
    }
    b.I = total;
    b.covered = covered;
  }
  result.integralEcG = total;
  result.activeIntegralEcG = hasStop ? active : total;
  result.coveredMassG = covered;
  result.coverageRatio = result.totalMassG > 0 ? covered / result.totalMassG : 0;
  result.meanEcPerG = covered > 0 ? total / covered : 0;
  if (o.doseG > 0) result.doseNormalizedIntegral = total / o.doseG;
  result.finalEc = knots[knots.length - 1]!.ec ?? result.finalEc;

  // Main peak: ignore the first drops.
  for (const k of knots) {
    if (k.m >= o.activePeakMinMassG && k.ec !== null && k.ec > result.mainPeakEc) {
      result.mainPeakEc = k.ec;
      result.mainPeakMassG = k.m;
    }
  }
  if (result.mainPeakEc <= 0) result.mainPeakEc = result.peakEc;

  // Curve for plotting (drop duplicate masses so the x axis is monotone).
  const plot: PortalCurvePoint[] = [];
  for (const k of knots) {
    if (plot.length && k.m <= plot[plot.length - 1]!.m) continue;
    plot.push({ m: k.m, ec: k.ec, I: k.I, t: k.t });
  }
  result.curve = plot;

  result.massAt85PctG = massAtIntegralFraction(knots, 0.85);
  result.massAt90PctG = massAtIntegralFraction(knots, 0.9);

  // Tail features over the final N grams.
  const mEnd = result.totalMassG;
  const iEnd = total;
  for (const win of o.tailWindowsG) {
    const iStart = integralAtMass(knots, mEnd - win);
    const mean = (iEnd - iStart) / win;
    const feature: TailFeature = {
      mean,
      share: iEnd > 0 ? (iEnd - iStart) / iEnd : 0,
      ratioToPeak: result.mainPeakEc > 0 ? mean / result.mainPeakEc : 0,
    };
    if (win === 5) feature.slopePerG = tailSlope(knots, mEnd - win, mEnd);
    result.tail[`last${win}g`] = feature;
  }

  if (result.coverageRatio < o.minCoverageRatio) {
    result.status = "low-coverage";
    result.reasons.push(
      `Portal covered ${(result.coverageRatio * 100).toFixed(0)}% of the cup mass; estimates need ≥ ${(o.minCoverageRatio * 100).toFixed(0)}%.`,
    );
  }
  if (result.gapCount > 0) {
    result.reasons.push(`${result.gapCount} gap${result.gapCount > 1 ? "s" : ""} in the Portal stream.`);
  }
  return result;
}

function integralAtMass(knots: Knot[], m: number): number {
  if (m <= knots[0]!.m) return 0;
  for (let i = 1; i < knots.length; i++) {
    if (knots[i]!.m >= m) {
      const a = knots[i - 1]!;
      const b = knots[i]!;
      const dm = b.m - a.m;
      if (dm <= 0) return b.I;
      const alpha = (m - a.m) / dm;
      return a.I + alpha * (b.I - a.I);
    }
  }
  return knots[knots.length - 1]!.I;
}

function massAtIntegralFraction(knots: Knot[], frac: number): number {
  const target = knots[knots.length - 1]!.I * frac;
  if (target <= 0) return 0;
  for (let i = 1; i < knots.length; i++) {
    if (knots[i]!.I >= target) {
      const a = knots[i - 1]!;
      const b = knots[i]!;
      const dI = b.I - a.I;
      if (dI <= 0) return b.m;
      return a.m + ((target - a.I) / dI) * (b.m - a.m);
    }
  }
  return knots[knots.length - 1]!.m;
}

/** Least-squares slope dEC/dm over a mass window, sampled on a uniform grid. */
function tailSlope(knots: Knot[], m0: number, m1: number, n = 51): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = m0 + ((m1 - m0) * i) / (n - 1);
    const ec = ecAtMass(knots, m);
    if (ec === null) continue;
    xs.push(m);
    ys.push(ec);
  }
  if (xs.length < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function ecAtMass(knots: Knot[], m: number): number | null {
  for (let i = 1; i < knots.length; i++) {
    if (knots[i]!.m >= m) {
      const a = knots[i - 1]!;
      const b = knots[i]!;
      if (a.ec === null || b.ec === null) return b.ec ?? a.ec ?? null;
      const dm = b.m - a.m;
      if (dm <= 0) return b.ec;
      const alpha = (m - a.m) / dm;
      return a.ec + alpha * (b.ec - a.ec);
    }
  }
  return knots[knots.length - 1]!.ec;
}

// -------------------------------------------------------------- calibration --

/** One paired observation: a shot's mean EC/g and its refractometer TDS%. */
export interface CalibrationPoint {
  id: string;
  meanEcPerG: number;
  tdsPct: number;
  /** false when the shot's analysis was not `ok`; such points are skipped. */
  reliable?: boolean;
  meanTempC?: number | null;
  /** Normalised coffee label (see `coffeeKey`). */
  coffeeKey?: string;
}

export interface ModelErrors {
  rmse: number;
  mae: number;
  bias: number;
  loocvRmse: number;
  loocvMae: number;
}

export interface CalibrationFit {
  calibrated: boolean;
  activeModel: "none" | "proportional" | "affine";
  shotCount: number;
  excludedCount: number;
  preliminary: boolean;
  minX: number;
  maxX: number;
  proportional: ({ k: number } & ModelErrors) | null;
  affine: ({ a: number; b: number } & ModelErrors) | null;
  tempCorrelation: number | null;
  /** Set by `fitForCoffee`. */
  pool?: PoolId;
  poolLabel?: string;
  poolPoints?: CalibrationPoint[];
  distinctCoffees?: number;
  fallbackFrom?: PoolId | null;
  mode?: PoolMode;
}

export interface FitOptions {
  excludeId?: string;
  minShots?: number;
}

type Model = (x: number) => number;

/**
 * Fit EC → TDS% from paired shots. The proportional model (through the origin:
 * pure water has neither EC nor TDS) is always fitted; an affine model is only
 * considered once there are enough points spread over a real range of EC, and
 * only used when it clearly wins out of sample.
 */
export function fitCalibration(points: CalibrationPoint[], opts: FitOptions = {}): CalibrationFit {
  const minShots = opts.minShots ?? PORTAL_ANALYSIS_DEFAULTS.minCalibrationShots;
  const usable = points.filter(
    (p) =>
      p.id !== opts.excludeId &&
      Number.isFinite(p.meanEcPerG) &&
      p.meanEcPerG > 0 &&
      Number.isFinite(p.tdsPct) &&
      p.tdsPct > 0 &&
      p.reliable !== false,
  );
  const fit: CalibrationFit = {
    calibrated: false,
    activeModel: "none",
    shotCount: usable.length,
    excludedCount: points.length - usable.length - (points.some((p) => p.id === opts.excludeId) ? 1 : 0),
    preliminary: usable.length < minShots,
    minX: usable.length ? Math.min(...usable.map((p) => p.meanEcPerG)) : 0,
    maxX: usable.length ? Math.max(...usable.map((p) => p.meanEcPerG)) : 0,
    proportional: null,
    affine: null,
    tempCorrelation: null,
  };
  if (usable.length < 1) return fit;

  const xs = usable.map((p) => p.meanEcPerG);
  const ys = usable.map((p) => p.tdsPct);

  const k = dot(xs, xs) > 0 ? dot(xs, ys) / dot(xs, xs) : 0;
  fit.proportional = { k, ...errors(xs, ys, (x) => k * x), ...loocv(xs, ys, fitProportional) };

  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const spreadOk = fit.maxX - fit.minX > 0.08 * meanX;
  if (usable.length >= minShots && spreadOk) {
    const { a, b } = fitAffineParams(xs, ys);
    fit.affine = { a, b, ...errors(xs, ys, (x) => a * x + b), ...loocv(xs, ys, fitAffine) };
  }

  const temps = usable.map((p) => p.meanTempC).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (temps.length === usable.length && usable.length >= minShots) {
    const resid = xs.map((x, i) => ys[i]! - k * x);
    fit.tempCorrelation = pearson(temps, resid);
  }

  fit.calibrated = true;
  if (fit.affine && usable.length >= minShots && fit.affine.loocvRmse < 0.9 * fit.proportional.loocvRmse) {
    fit.activeModel = "affine";
  } else {
    fit.activeModel = "proportional";
  }
  return fit;
}

export function predictTds(fit: CalibrationFit | null | undefined, meanEcPerG: number): number | null {
  if (!fit || !fit.calibrated || !Number.isFinite(meanEcPerG)) return null;
  if (fit.activeModel === "affine" && fit.affine) return fit.affine.a * meanEcPerG + fit.affine.b;
  if (fit.proportional) return fit.proportional.k * meanEcPerG;
  return null;
}

/** Extraction yield (%) from TDS%, beverage mass and dose. */
export function extractionYield(
  tdsPct: number | null | undefined,
  beverageG: number | null | undefined,
  doseG: number | null | undefined,
): number | null {
  if (
    typeof tdsPct !== "number" || !Number.isFinite(tdsPct) ||
    typeof beverageG !== "number" || !Number.isFinite(beverageG) ||
    typeof doseG !== "number" || !Number.isFinite(doseG) || doseG <= 0
  ) {
    return null;
  }
  return (tdsPct * beverageG) / doseG;
}

export interface PortalEstimate {
  tdsPct: number | null;
  eyPct: number | null;
  /** Human-readable caveats; never empty when the number should be doubted. */
  flags: string[];
  model?: CalibrationFit["activeModel"];
  pool?: PoolId | null;
  poolLabel?: string | null;
}

/** Combine an analysis (or its cached summary) with a fit into a flagged estimate. */
export function estimateForShot(
  analysis: Pick<PortalAnalysis, "status" | "meanEcPerG" | "totalMassG"> | null | undefined,
  fit: CalibrationFit | null | undefined,
  { beverageG, doseG, poolLabel }: { beverageG?: number | null; doseG?: number | null; poolLabel?: string | null } = {},
): PortalEstimate {
  const flags: string[] = [];
  if (
    !analysis ||
    !(analysis.meanEcPerG > 0) ||
    analysis.status === "no-portal-data" ||
    analysis.status === "no-weight-data" ||
    analysis.status === "insufficient-mass"
  ) {
    return { tdsPct: null, eyPct: null, flags: ["No usable Portal + weight data in this shot, so nothing to estimate from."] };
  }
  if (!fit || !fit.calibrated) {
    return {
      tdsPct: null,
      eyPct: null,
      flags: [poolLabel ? `No refractometer readings yet for ${poolLabel}.` : "No refractometer calibration yet for this coffee."],
    };
  }
  if (analysis.status !== "ok") flags.push(`Shot analysis is not reliable (${analysis.status}).`);
  if (fit.preliminary) {
    flags.push(
      `Preliminary: only ${fit.shotCount} reference shot${fit.shotCount === 1 ? "" : "s"} (need ${PORTAL_ANALYSIS_DEFAULTS.minCalibrationShots}).`,
    );
  }
  const x = analysis.meanEcPerG;
  if (fit.shotCount >= 2 && (x < fit.minX * 0.95 || x > fit.maxX * 1.05)) {
    flags.push("Outside the EC range of the reference shots (extrapolated).");
  }
  const tdsPct = predictTds(fit, x);
  const eyPct = extractionYield(tdsPct, beverageG ?? analysis.totalMassG, doseG);
  return { tdsPct, eyPct, flags, model: fit.activeModel, pool: fit.pool ?? null, poolLabel: fit.poolLabel ?? poolLabel ?? null };
}

// ------------------------------------------------------- calibration pools --

export type PoolId = "coffee" | "all";
export type PoolMode = "auto" | PoolId;

/** Normalise a free-text coffee label so "Hatch Supernova " and "hatch supernova" group together. */
export function coffeeKey(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

interface Pool {
  id: PoolId;
  label: string;
  match: (p: CalibrationPoint, coffee: string) => boolean;
}

/**
 * Which reference shots may inform an estimate. Ordered from most to least
 * specific: the same coffee, then every coffee. "auto" takes the most specific
 * pool that has reached the minimum shot count, else the most specific one
 * with any shots at all (flagged preliminary).
 */
export const POOLS: readonly Pool[] = Object.freeze([
  { id: "coffee" as const, label: "this coffee only", match: (p, c) => !!c && p.coffeeKey === c },
  { id: "all" as const, label: "all coffees", match: () => true },
]);

export function fitForCoffee(
  points: CalibrationPoint[],
  coffee: string | null | undefined,
  mode: PoolMode = "auto",
  opts: FitOptions = {},
): CalibrationFit {
  const minShots = opts.minShots ?? PORTAL_ANALYSIS_DEFAULTS.minCalibrationShots;
  const key = coffeeKey(coffee);
  const candidates = mode === "auto" ? POOLS : POOLS.filter((p) => p.id === mode);
  const fits = candidates.map((pool) => {
    const pts = points.filter((p) => p.id !== opts.excludeId && pool.match(p, key));
    const fit = fitCalibration(pts, opts);
    fit.pool = pool.id;
    fit.poolLabel = pool.label;
    fit.poolPoints = pts;
    fit.distinctCoffees = new Set(pts.map((p) => p.coffeeKey ?? "")).size;
    return fit;
  });
  // With no readings anywhere, report the most specific pool so the message says
  // "no readings for this coffee" rather than "for all coffees".
  let chosen = fits.find((f) => f.shotCount >= minShots) ?? fits.find((f) => f.shotCount > 0) ?? fits[0];
  if (!chosen) {
    chosen = fitCalibration([], opts);
    chosen.pool = mode === "auto" ? "coffee" : mode;
    chosen.poolLabel = (POOLS.find((p) => p.id === chosen!.pool) ?? POOLS[0]!).label;
    chosen.poolPoints = [];
    chosen.distinctCoffees = 0;
  }
  chosen.fallbackFrom = mode === "auto" && chosen.pool !== "coffee" ? "coffee" : null;
  chosen.mode = mode;
  return chosen;
}

// ------------------------------------------------------------------ helpers --

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function fitProportional(xs: number[], ys: number[]): Model {
  const k = dot(xs, xs) > 0 ? dot(xs, ys) / dot(xs, xs) : 0;
  return (x) => k * x;
}

function fitAffineParams(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const a = den > 0 ? num / den : 0;
  const b = my - a * mx;
  return { a, b };
}

function fitAffine(xs: number[], ys: number[]): Model {
  const { a, b } = fitAffineParams(xs, ys);
  return (x) => a * x + b;
}

function errors(xs: number[], ys: number[], f: Model): Pick<ModelErrors, "rmse" | "mae" | "bias"> {
  let se = 0;
  let ae = 0;
  let bias = 0;
  for (let i = 0; i < xs.length; i++) {
    const r = f(xs[i]!) - ys[i]!;
    se += r * r;
    ae += Math.abs(r);
    bias += r;
  }
  const n = xs.length || 1;
  return { rmse: Math.sqrt(se / n), mae: ae / n, bias: bias / n };
}

function loocv(xs: number[], ys: number[], fitter: (xs: number[], ys: number[]) => Model): Pick<ModelErrors, "loocvRmse" | "loocvMae"> {
  if (xs.length < 2) return { loocvRmse: Infinity, loocvMae: Infinity };
  let se = 0;
  let ae = 0;
  for (let i = 0; i < xs.length; i++) {
    const trX = xs.filter((_, j) => j !== i);
    const trY = ys.filter((_, j) => j !== i);
    const f = fitter(trX, trY);
    const r = f(xs[i]!) - ys[i]!;
    se += r * r;
    ae += Math.abs(r);
  }
  return { loocvRmse: Math.sqrt(se / xs.length), loocvMae: ae / xs.length };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Downsample a series to at most n points, keeping first and last. */
export function downsample<T>(series: T[], n: number): T[] {
  if (series.length <= n) return series.slice();
  const out: T[] = [];
  const step = (series.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(series[Math.round(i * step)]!);
  return out;
}
