export interface TempSample {
  /** Seconds since heating started (monotonic). */
  t: number
  /** Readiness-sensor (brew head) temperature in °C; the estimate is fit to this. */
  temp: number
  /** Optional brew-chamber (boiler) temperature in °C, for display only. */
  chamber?: number
}

export interface EstimateOptions {
  /** Current readiness-sensor (brew head) temperature in °C. */
  current: number
  /** Set/target temperature (°C). */
  target: number
  /** Ready cutoff (°C) = target − threshold; heating is "ready" at this temp. */
  cutoff: number
  /** Ambient/room baseline (°C) used as the cold-start reference. Default 20. */
  ambient?: number
  /**
   * Empirical seconds to reach `cutoff` from a cold (ambient) start. Default 210
   * (~3.5 min with room-temperature water, matching observed behaviour). A hot
   * (kettle-filled) start lands ~90s automatically because the model is driven
   * by the current temperature, not the clock.
   */
  coldStartSeconds?: number
  /** Upper clamp for the returned ETA (seconds). Default 900. */
  maxSeconds?: number
}

/**
 * Estimate seconds remaining until the brew head reaches `cutoff`, using a
 * Newtonian (exponential-approach) heating model with a *fixed* rate constant
 * calibrated to observed behaviour rather than fit to noisy live samples:
 *
 *   T(t) = target − (target − T0) · e^(−k·t)
 *
 * We pin k so that heating from `ambient` to `cutoff` takes `coldStartSeconds`
 * (≈210s from room temperature). The remaining time is then computed purely
 * from the *current* temperature's gap to target:
 *
 *   remaining = ln((target − current) / (target − cutoff)) / k
 *
 * This is monotonic and stable (no sample fitting, so no jitter), and it
 * automatically predicts a faster ready time for a hot start (e.g. a
 * kettle-filled boiler) because `current` already sits closer to target. The
 * logarithm captures the real-world slow-down near the target.
 *
 * Returns null only for degenerate inputs (caller hides the estimate), 0 when
 * already at/above cutoff, and a value clamped to `maxSeconds`.
 */
export function estimateTimeToReady(opts: EstimateOptions): number | null {
  const { current, target, cutoff } = opts
  const ambient = opts.ambient ?? 20
  const coldStartSeconds = opts.coldStartSeconds ?? 210
  const maxSeconds = opts.maxSeconds ?? 900

  if (
    !Number.isFinite(current) ||
    !Number.isFinite(target) ||
    !Number.isFinite(cutoff)
  ) {
    return null
  }
  if (target <= cutoff) return 0
  if (current >= cutoff) return 0

  const readyGap = target - cutoff
  const coldGap = target - ambient
  // Ambient is already within the ready band — no meaningful cold-start span.
  if (coldGap <= readyGap) return 0

  const k = Math.log(coldGap / readyGap) / coldStartSeconds
  if (!Number.isFinite(k) || k <= 0) return null

  const currentGap = target - current
  if (currentGap <= readyGap) return 0

  const remaining = Math.log(currentGap / readyGap) / k
  if (!Number.isFinite(remaining)) return null
  if (remaining <= 0) return 0
  return Math.min(remaining, maxSeconds)
}
