/**
 * Belka Portal route family.
 *
 * A Belka Portal is a Bluetooth conductivity (EC) sensor that sits under the
 * portafilter. The web app records its stream while the machine is extracting
 * (Web Bluetooth is browser-only, so capture always happens client-side) and
 * hands the finished recording here, keyed by `${date}/${filename}` to match
 * the machine's shot storage layout — the same key the annotation routes use.
 *
 * Everything that is *not* capture lives in this shared core so both runtimes
 * agree: persistence (`platform.storage.portalShots`), pairing the EC stream
 * with the machine's cup-weight curve (`logic/portalAnalysis`), refractometer
 * readings, per-coffee calibration and the flagged TDS/EY estimate.
 *
 * Routes:
 *   GET    /api/portal/shots                         -> summaries for list badges
 *   GET    /api/portal/shots/{date}/{filename}       -> recording + analysis + estimate
 *   PUT    /api/portal/shots/{date}/{filename}       -> store a recording
 *   PATCH  /api/portal/shots/{date}/{filename}       -> coffee / dose / lag / refractometer reading
 *   DELETE /api/portal/shots/{date}/{filename}       -> remove the recording
 *   GET    /api/portal/calibration?coffee=&mode=     -> the fit the estimate would use
 */

import type { Platform, Repo } from "../platform";
import { jsonResponse } from "../http";
import { loadVisibleHistory } from "../logic/historyStore";
import { historyEntryDate, historyEntryFilename } from "../logic/machineHistory";
import {
  type CalibrationFit,
  type CalibrationPoint,
  type PoolMode,
  type PortalAnalysis,
  type PortalAnalysisSummary,
  type PortalEstimate,
  type PortalSample,
  type WeightSample,
  analyzePortalShot,
  coffeeKey,
  estimateForShot,
  extractionYield,
  fitForCoffee,
  summarizePortalAnalysis,
} from "../logic/portalAnalysis";

// ---------------------------------------------------------------------------
// Stored shape
// ---------------------------------------------------------------------------

export interface PortalReading {
  tds_pct: number;
  beverage_g: number | null;
  ey_pct: number | null;
  at: string;
}

export interface StoredPortalShot {
  /** `${date}/${filename}` of the machine shot this recording belongs to. */
  key: string;
  samples: PortalSample[];
  /** Epoch ms when the recording started (machine shot start). */
  started_at: number;
  /** Seconds the Portal leads (+) or lags (−) the cup. */
  lag_sec: number;
  /** Seconds at which the pump stopped, when known. */
  stop_time_sec: number | null;
  device_name: string | null;
  /** Free-text coffee label; calibration is grouped by its normalised form. */
  coffee: string | null;
  dose_g: number | null;
  reading: PortalReading | null;
  /** Cached analysis against the machine's weight curve, when it was available. */
  analysis: PortalAnalysisSummary | null;
  updated_at: string;
}

export interface PortalShotSummary {
  sample_count: number;
  status: PortalAnalysisSummary["status"] | null;
  mean_ec_per_g: number | null;
  tds_pct: number | null;
  estimate_tds_pct: number | null;
  coffee: string | null;
}

/** Thrown for a malformed body; mapped to HTTP 422. */
export class PortalValidationError extends Error {}

const MAX_SAMPLES = 20_000;
const MAX_LABEL = 120;

function repo(platform: Platform): Repo<StoredPortalShot> {
  return platform.storage.portalShots as Repo<StoredPortalShot>;
}

function shotKey(date: string, filename: string): string {
  return `${date}/${filename}`;
}

function isoNow(platform: Platform): string {
  return new Date(platform.clock()).toISOString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown, what: string, { min, max }: { min?: number; max?: number } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new PortalValidationError(`${what} must be a finite number`);
  if (min !== undefined && v < min) throw new PortalValidationError(`${what} must be ≥ ${min}`);
  if (max !== undefined && v > max) throw new PortalValidationError(`${what} must be ≤ ${max}`);
  return v;
}

function optionalNumber(v: unknown, what: string, bounds?: { min?: number; max?: number }): number | null {
  if (v === null || v === undefined) return null;
  return finiteNumber(v, what, bounds);
}

function optionalLabel(v: unknown, what: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new PortalValidationError(`${what} must be a string`);
  const s = v.trim();
  return s ? s.slice(0, MAX_LABEL) : null;
}

/** Validate and normalise the samples array of a PUT body. */
export function validateSamples(raw: unknown): PortalSample[] {
  if (!Array.isArray(raw)) throw new PortalValidationError("samples must be an array");
  if (raw.length > MAX_SAMPLES) throw new PortalValidationError(`samples must hold at most ${MAX_SAMPLES} points`);
  const out: PortalSample[] = [];
  for (const s of raw) {
    if (!isRecord(s)) throw new PortalValidationError("each sample must be an object");
    const t = finiteNumber(s.t, "sample.t", { min: -60, max: 3600 });
    const ec = finiteNumber(s.ec, "sample.ec", { min: 0, max: 1000 });
    const sample: PortalSample = { t, ec };
    if (typeof s.tOut === "number" && Number.isFinite(s.tOut)) sample.tOut = s.tOut;
    if (typeof s.tInt === "number" && Number.isFinite(s.tInt)) sample.tInt = s.tInt;
    if (typeof s.status === "number" && Number.isFinite(s.status)) sample.status = s.status;
    out.push(sample);
  }
  return out;
}

export function validateReading(raw: unknown): { tdsPct: number; beverageG: number | null } | null {
  if (raw === null) return null;
  if (!isRecord(raw)) throw new PortalValidationError("reading must be an object or null");
  const tdsPct = finiteNumber(raw.tdsPct ?? raw.tds_pct, "reading.tdsPct", { min: 0.01, max: 30 });
  const beverageG = optionalNumber(raw.beverageG ?? raw.beverage_g, "reading.beverageG", { min: 0.1, max: 2000 });
  return { tdsPct, beverageG };
}

// ---------------------------------------------------------------------------
// Machine weight curve for a shot
// ---------------------------------------------------------------------------

interface WeightCurve {
  samples: WeightSample[];
  /** Seconds at which extraction ended (before the retraction stage). */
  extractionEndSec: number | null;
}

/**
 * The machine's own record of the shot gives the cup-weight curve the EC stream
 * is integrated against. Returns null when the shot is not (yet) on the
 * machine or the machine is unreachable; the caller then stores the recording
 * without an analysis and computes it on a later read.
 */
async function loadWeightCurve(platform: Platform, date: string, filename: string): Promise<WeightCurve | null> {
  let entries;
  try {
    ({ entries } = await loadVisibleHistory(platform));
  } catch {
    return null;
  }
  const entry = entries.find((e) => historyEntryDate(e) === date && historyEntryFilename(e) === filename);
  if (!entry?.data?.length) return null;
  const samples: WeightSample[] = [];
  let extractionEndSec: number | null = null;
  for (const pt of entry.data as Array<{ status?: string; time?: number; profile_time?: number; shot?: { weight?: number } }>) {
    const status = String(pt.status ?? "").toLowerCase();
    const retracting = status === "retracting";
    const timeMs = retracting ? pt.time ?? pt.profile_time ?? 0 : pt.profile_time ?? pt.time ?? 0;
    const t = timeMs / 1000;
    const w = pt.shot?.weight;
    if (typeof w === "number" && Number.isFinite(w)) samples.push({ t, w });
    if (!retracting) extractionEndSec = t;
  }
  return samples.length >= 2 ? { samples, extractionEndSec } : null;
}

async function analyze(platform: Platform, stored: StoredPortalShot): Promise<PortalAnalysis | null> {
  const [date, filename] = splitKey(stored.key);
  const curve = await loadWeightCurve(platform, date, filename);
  if (!curve) return null;
  return analyzePortalShot(stored.samples, curve.samples, {
    doseG: stored.dose_g ?? 0,
    lagSec: stored.lag_sec,
    stopTimeSec: stored.stop_time_sec ?? curve.extractionEndSec ?? 0,
  });
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf("/");
  return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

function calibrationPoints(records: StoredPortalShot[]): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  for (const r of records) {
    if (!r.reading || !r.analysis || !(r.analysis.meanEcPerG > 0)) continue;
    points.push({
      id: r.key,
      meanEcPerG: r.analysis.meanEcPerG,
      tdsPct: r.reading.tds_pct,
      reliable: r.analysis.status === "ok",
      meanTempC: r.analysis.meanTempC,
      coffeeKey: coffeeKey(r.coffee),
    });
  }
  return points;
}

/** A fit without its (possibly large) point list, for JSON responses. */
function serializeFit(fit: CalibrationFit) {
  const { poolPoints, ...rest } = fit;
  return { ...rest, pool_shot_count: poolPoints?.length ?? 0 };
}

function estimateFor(
  stored: StoredPortalShot,
  analysis: Pick<PortalAnalysis, "status" | "meanEcPerG" | "totalMassG"> | null,
  points: CalibrationPoint[],
  mode: PoolMode,
): { fit: CalibrationFit; estimate: PortalEstimate } {
  // Leave the shot's own reading out of the fit used to estimate it.
  const fit = fitForCoffee(points, stored.coffee, mode, { excludeId: stored.key });
  const estimate = estimateForShot(analysis, fit, {
    beverageG: stored.reading?.beverage_g ?? analysis?.totalMassG ?? null,
    doseG: stored.dose_g,
    poolLabel: fit.poolLabel,
  });
  if (fit.calibrated && fit.pool !== "coffee") {
    estimate.flags.unshift(
      `Borrowed from ${fit.poolLabel}: ${fit.shotCount} shot${fit.shotCount === 1 ? "" : "s"} of ${fit.distinctCoffees ?? 0} coffee${(fit.distinctCoffees ?? 0) === 1 ? "" : "s"}${fit.fallbackFrom ? " (no readings for this coffee yet)" : ""}.`,
    );
  }
  return { fit, estimate };
}

/** Distinct coffee labels seen so far, most recent first — for the label picker. */
function recentCoffees(records: StoredPortalShot[]): string[] {
  const seen = new Map<string, { label: string; at: string }>();
  for (const r of records) {
    if (!r.coffee) continue;
    const k = coffeeKey(r.coffee);
    const prev = seen.get(k);
    if (!prev || prev.at < r.updated_at) seen.set(k, { label: r.coffee, at: r.updated_at });
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map((v) => v.label).slice(0, 50);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface PortalShotResponse {
  status: "success";
  recording: StoredPortalShot | null;
  analysis: PortalAnalysis | null;
  estimate: PortalEstimate | null;
  fit: ReturnType<typeof serializeFit> | null;
  coffees: string[];
}

async function respondFor(
  platform: Platform,
  stored: StoredPortalShot | null,
  mode: PoolMode,
  precomputed?: PortalAnalysis | null,
): Promise<PortalShotResponse> {
  const all = await repo(platform).list();
  const coffees = recentCoffees(all);
  if (!stored) return { status: "success", recording: null, analysis: null, estimate: null, fit: null, coffees };
  const analysis = precomputed === undefined ? await analyze(platform, stored) : precomputed;
  if (analysis && !sameSummary(stored.analysis, summarizePortalAnalysis(analysis))) {
    // The machine's record arrived (or changed) since the recording was stored: refresh the cache.
    stored = { ...stored, analysis: summarizePortalAnalysis(analysis) };
    await repo(platform).write(stored.key, stored);
  }
  const points = calibrationPoints(all.map((r) => (r.key === stored!.key ? stored! : r)));
  const { fit, estimate } = estimateFor(stored, analysis ?? stored.analysis, points, mode);
  return { status: "success", recording: stored, analysis, estimate, fit: serializeFit(fit), coffees };
}

function sameSummary(a: PortalAnalysisSummary | null, b: PortalAnalysisSummary): boolean {
  return !!a && a.status === b.status && a.meanEcPerG === b.meanEcPerG && a.integralEcG === b.integralEcG && a.coverageRatio === b.coverageRatio;
}

export async function getPortalShot(platform: Platform, date: string, filename: string, mode: PoolMode = "auto"): Promise<PortalShotResponse> {
  const stored = await repo(platform).read(shotKey(date, filename));
  return respondFor(platform, stored, mode);
}

export async function putPortalShot(
  platform: Platform,
  date: string,
  filename: string,
  body: unknown,
  mode: PoolMode = "auto",
): Promise<PortalShotResponse> {
  if (!isRecord(body)) throw new PortalValidationError("body must be an object");
  const samples = validateSamples(body.samples);
  if (samples.length < 2) throw new PortalValidationError("a recording needs at least two samples");
  const key = shotKey(date, filename);
  const existing = await repo(platform).read(key);
  const stored: StoredPortalShot = {
    key,
    samples,
    started_at: finiteNumber(body.startedAt ?? body.started_at ?? existing?.started_at ?? platform.clock(), "startedAt", { min: 0 }),
    lag_sec: optionalNumber(body.lagSec ?? body.lag_sec, "lagSec", { min: -5, max: 5 }) ?? existing?.lag_sec ?? 0,
    stop_time_sec: optionalNumber(body.stopTimeSec ?? body.stop_time_sec, "stopTimeSec", { min: 0, max: 3600 }) ?? existing?.stop_time_sec ?? null,
    device_name: optionalLabel(body.deviceName ?? body.device_name, "deviceName") ?? existing?.device_name ?? null,
    coffee: optionalLabel(body.coffee, "coffee") ?? existing?.coffee ?? null,
    dose_g: optionalNumber(body.doseG ?? body.dose_g, "doseG", { min: 0, max: 200 }) ?? existing?.dose_g ?? null,
    reading: existing?.reading ?? null,
    analysis: null,
    updated_at: isoNow(platform),
  };
  const analysis = await analyze(platform, stored);
  if (analysis) stored.analysis = summarizePortalAnalysis(analysis);
  if (stored.reading && analysis) {
    stored.reading = { ...stored.reading, ey_pct: extractionYield(stored.reading.tds_pct, stored.reading.beverage_g ?? analysis.totalMassG, stored.dose_g) };
  }
  await repo(platform).write(key, stored);
  return respondFor(platform, stored, mode, analysis);
}

export async function patchPortalShot(
  platform: Platform,
  date: string,
  filename: string,
  body: unknown,
  mode: PoolMode = "auto",
): Promise<PortalShotResponse | null> {
  if (!isRecord(body)) throw new PortalValidationError("body must be an object");
  const key = shotKey(date, filename);
  const existing = await repo(platform).read(key);
  if (!existing) return null;
  const stored: StoredPortalShot = { ...existing, updated_at: isoNow(platform) };
  if ("coffee" in body) stored.coffee = optionalLabel(body.coffee, "coffee");
  if ("doseG" in body || "dose_g" in body) stored.dose_g = optionalNumber(body.doseG ?? body.dose_g, "doseG", { min: 0, max: 200 });
  if ("lagSec" in body || "lag_sec" in body) stored.lag_sec = optionalNumber(body.lagSec ?? body.lag_sec, "lagSec", { min: -5, max: 5 }) ?? 0;
  const analysis = await analyze(platform, stored);
  if (analysis) stored.analysis = summarizePortalAnalysis(analysis);
  if ("reading" in body) {
    const reading = validateReading(body.reading);
    stored.reading = reading
      ? {
          tds_pct: reading.tdsPct,
          beverage_g: reading.beverageG,
          ey_pct: extractionYield(reading.tdsPct, reading.beverageG ?? analysis?.totalMassG ?? stored.analysis?.totalMassG ?? null, stored.dose_g),
          at: isoNow(platform),
        }
      : null;
  } else if (stored.reading) {
    stored.reading = {
      ...stored.reading,
      ey_pct: extractionYield(stored.reading.tds_pct, stored.reading.beverage_g ?? analysis?.totalMassG ?? stored.analysis?.totalMassG ?? null, stored.dose_g),
    };
  }
  await repo(platform).write(key, stored);
  return respondFor(platform, stored, mode, analysis);
}

export async function deletePortalShot(platform: Platform, date: string, filename: string): Promise<boolean> {
  const key = shotKey(date, filename);
  const existing = await repo(platform).read(key);
  if (!existing) return false;
  await repo(platform).delete(key);
  return true;
}

export async function getPortalSummaries(platform: Platform, mode: PoolMode = "auto"): Promise<Record<string, PortalShotSummary>> {
  const all = await repo(platform).list();
  const points = calibrationPoints(all);
  const out: Record<string, PortalShotSummary> = {};
  for (const r of all) {
    if (!r || typeof r.key !== "string") continue;
    let estimateTds: number | null = null;
    if (r.analysis && !r.reading) {
      const { estimate } = estimateFor(r, r.analysis, points, mode);
      estimateTds = estimate.tdsPct;
    }
    out[r.key] = {
      sample_count: r.samples?.length ?? 0,
      status: r.analysis?.status ?? null,
      mean_ec_per_g: r.analysis?.meanEcPerG ?? null,
      tds_pct: r.reading?.tds_pct ?? null,
      estimate_tds_pct: estimateTds,
      coffee: r.coffee,
    };
  }
  return out;
}

export async function getPortalCalibration(platform: Platform, coffee: string | null, mode: PoolMode = "auto") {
  const all = await repo(platform).list();
  const points = calibrationPoints(all);
  const fit = fitForCoffee(points, coffee, mode);
  return { status: "success" as const, fit: serializeFit(fit), points: fit.poolPoints ?? [], coffees: recentCoffees(all) };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const SHOT_RE = /^\/api\/portal\/shots\/([^/]+)\/([^/]+)$/;

function poolMode(url: URL): PoolMode {
  const m = url.searchParams.get("mode");
  return m === "coffee" || m === "all" ? m : "auto";
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new PortalValidationError("body must be valid JSON");
  }
}

/**
 * Route dispatcher. Returns a Response for a Portal route, or `null` if the
 * request is not one (so the main handler can try other route families).
 */
export async function handlePortalRoutes(req: Request, platform: Platform): Promise<Response | null> {
  const url = new URL(req.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/portal/")) return null;

  try {
    if (pathname === "/api/portal/shots" && req.method === "GET") {
      return jsonResponse({ status: "success", shots: await getPortalSummaries(platform, poolMode(url)) });
    }
    if (pathname === "/api/portal/calibration" && req.method === "GET") {
      return jsonResponse(await getPortalCalibration(platform, url.searchParams.get("coffee"), poolMode(url)));
    }

    const match = pathname.match(SHOT_RE);
    if (!match) return null;
    const date = decodeURIComponent(match[1]!);
    const filename = decodeURIComponent(match[2]!);

    switch (req.method) {
      case "GET":
        return jsonResponse(await getPortalShot(platform, date, filename, poolMode(url)));
      case "PUT":
        return jsonResponse(await putPortalShot(platform, date, filename, await readJson(req), poolMode(url)));
      case "PATCH": {
        const result = await patchPortalShot(platform, date, filename, await readJson(req), poolMode(url));
        return result ? jsonResponse(result) : jsonResponse({ detail: "No Portal recording for this shot" }, 404);
      }
      case "DELETE": {
        const removed = await deletePortalShot(platform, date, filename);
        return removed ? jsonResponse({ status: "success" }) : jsonResponse({ detail: "No Portal recording for this shot" }, 404);
      }
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof PortalValidationError) return jsonResponse({ detail: err.message }, 422);
    platform.logger.error("portal route failed", err);
    return jsonResponse({ detail: "Portal request failed" }, 500);
  }
}
