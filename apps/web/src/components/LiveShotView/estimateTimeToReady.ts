export interface TempSample {
  /** Seconds since heating started (monotonic). */
  t: number
  /** Temperature reading in °C. */
  temp: number
}

export interface EstimateOptions {
  samples: TempSample[]
  /** Set/target temperature (°C). */
  target: number
  /** Lance-ready cutoff (°C) = target − threshold. */
  cutoff: number
  /** Minimum samples required before producing an estimate. Default 5. */
  minSamples?: number
  /** Upper clamp for the returned ETA (seconds). Default 900. */
  maxSeconds?: number
}

/**
 * Estimate seconds remaining until temperature reaches `cutoff`, using a
 * Newtonian (exponential-approach) model fit to recent samples:
 *
 *   T(t) = target − (target − T0) · e^(−k·t)
 *
 * Linearizing: ln(target − T) = ln(target − T0) − k·t, i.e. y = a + b·t with
 * y = ln(target − T), b = −k. We fit (a, b) by least squares over the provided
 * samples, then solve for the time at which T = cutoff and subtract the latest
 * sample time to return the remaining seconds. Windowing is the caller's
 * responsibility; this function fits whatever samples array it is given.
 *
 * This is an unweighted log-space OLS approximation, not a true nonlinear
 * least-squares fit, so noisy readings near target can bias the estimate.
 *
 * Returns null when there is insufficient/degenerate data (caller hides the
 * estimate), 0 when already at/above cutoff, and a value clamped to maxSeconds.
 */
export function estimateTimeToReady(opts: EstimateOptions): number | null {
  const { samples, target, cutoff } = opts
  const minSamples = opts.minSamples ?? 5
  const maxSeconds = opts.maxSeconds ?? 900

  if (samples.length < minSamples) return null

  const latest = samples[samples.length - 1]
  if (latest.temp >= cutoff) return 0

  const pts: Array<{ t: number; y: number }> = []
  for (const s of samples) {
    const gap = target - s.temp
    if (gap <= 0) continue
    pts.push({ t: s.t, y: Math.log(gap) })
  }
  if (pts.length < minSamples) return null

  const n = pts.length
  let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0
  for (const p of pts) {
    sumT += p.t
    sumY += p.y
    sumTT += p.t * p.t
    sumTY += p.t * p.y
  }
  const denom = n * sumTT - sumT * sumT
  if (denom === 0) return null

  const b = (n * sumTY - sumT * sumY) / denom
  const a = (sumY - b * sumT) / n
  const k = -b

  if (!Number.isFinite(k) || k <= 0) return null

  const gapAtCutoff = target - cutoff
  if (gapAtCutoff <= 0) return 0
  const tCutoff = (a - Math.log(gapAtCutoff)) / k

  const remaining = tCutoff - latest.t
  if (!Number.isFinite(remaining)) return null
  if (remaining <= 0) return 0
  return Math.min(remaining, maxSeconds)
}
