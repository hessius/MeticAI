/**
 * pourOverSession — in-memory persistence for an in-progress manual Pour-Over
 * run, so navigating out of and back into `PourOverView` resumes the live timer
 * and weight-trend graph instead of resetting (issue #582).
 *
 * Unlike the espresso `shotTelemetryRecorder`, there is no app-level pour-over
 * telemetry source (the run is scale-driven and user-controlled), so this is a
 * plain save/restore snapshot: `PourOverView` writes its run-state slice here on
 * unmount and hydrates from it on mount. Explicit reset paths clear it.
 *
 * In-memory only; a full app restart starts fresh. Config inputs (mode, dose,
 * ratio, recipe selection) are intentionally NOT stored here — they are already
 * persisted via server-side pour-over preferences.
 */

export interface PourOverWeightPoint {
  t: number
  w: number
  flow?: number
}

export interface PourOverSessionSnapshot {
  // Timer run-state
  isRunning: boolean
  baseElapsedMs: number
  /** `performance.now()`-based start marker; monotonic across the app lifetime. */
  startedAtMs: number | null
  // Graph
  weightTrend: PourOverWeightPoint[]
  // Recipe progression
  recipeCurrentStep: number
  stepTimeOffsetMs: number
  machineEndElapsedMs: number | null
  // Smoothing / flow-derivation refs
  previousWeight: number | null
  previousWeightTimestamp: number | null
  trendStartTimestamp: number | null
  emaWeight: number | null
  prevEmaWeight: number | null
  emaFlow: number
}

let snapshot: PourOverSessionSnapshot | null = null

/** Persist the current in-progress run. Called on `PourOverView` unmount. */
export function savePourOverSession(next: PourOverSessionSnapshot): void {
  snapshot = next
}

/** Restore a previously-saved run, or `null` if none. Called on mount. */
export function loadPourOverSession(): PourOverSessionSnapshot | null {
  return snapshot
}

/** Discard any saved run. Called from explicit reset/stop paths and tests. */
export function clearPourOverSession(): void {
  snapshot = null
}
