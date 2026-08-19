/**
 * shotTelemetryRecorder — persistent, app-lifetime buffer of live espresso
 * telemetry.
 *
 * Telemetry streams continuously at the App level (`useMachineTelemetry` →
 * `machineState`), but the live-shot graph history used to be accumulated
 * *inside* `LiveShotView` (which is lazily mounted). Opening the live view late,
 * or navigating out and back, therefore lost everything graphed so far.
 *
 * This module records the current heating + shot session into a small,
 * subscribable, in-memory store that is fed once from `App` (always mounted) and
 * read by `LiveShotView`. The view becomes a pure reader/renderer; this store is
 * the single writer.
 *
 * Decisions (see issue #582):
 *  - Reset when the machine returns to idle/off — a finished shot is not retained
 *    for later viewing once the machine is idle.
 *  - In-memory only; a full app restart starts fresh.
 *  - Purely client-side: both proxy and direct/Capacitor runtimes feed the same
 *    `machineState`, so this covers both without any server/interceptor mirror.
 */

import type { MachineState } from '@/hooks/useWebSocket'
import type { ChartDataPoint } from '@/components/charts/chartConstants'
import type { TempSample } from '@/components/LiveShotView/estimateTimeToReady'

// Espresso machines operate 0–150°C; values outside are transient sensor glitches.
const TEMP_MIN = 0
const TEMP_MAX = 150

// Bound memory for long heat-ups / shots. When a buffer exceeds its cap we
// downsample it in place to the floor, preserving the first and last points.
const HEATING_CAP = 4000
const HEATING_FLOOR = 2000
const SHOT_CAP = 4000
const SHOT_FLOOR = 2000

export interface ShotTelemetrySnapshot {
  /** Shot pressure/flow/weight/power points, keyed by machine `shot_timer`. */
  shotSamples: ChartDataPoint[]
  /** Heating head/chamber temperature samples (seconds since heating start). */
  heatingSamples: TempSample[]
  /** Monotonic version; bumps whenever either buffer changes. */
  version: number
}

type Listener = () => void

// ---------------------------------------------------------------------------
// Mutable store state (module singleton)
// ---------------------------------------------------------------------------

let shotSamples: ChartDataPoint[] = []
let heatingSamples: TempSample[] = []
let version = 0

let heatingStartMs: number | null = null
let lastBrewing = false
let lastShotTime: number | null = null

let snapshot: ShotTelemetrySnapshot = { shotSamples, heatingSamples, version }
const listeners = new Set<Listener>()

// Injectable clock (tests). Defaults to Date.now.
let nowFn: () => number = () => Date.now()

// ---------------------------------------------------------------------------
// Notification (coalesced to at most once per animation frame in the browser)
// ---------------------------------------------------------------------------

let notifyScheduled = false

function rebuildSnapshot() {
  snapshot = { shotSamples, heatingSamples, version }
}

function flushNotify() {
  notifyScheduled = false
  rebuildSnapshot()
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* a broken listener must not wedge the recorder */
    }
  })
}

function scheduleNotify() {
  version++
  if (notifyScheduled) return
  notifyScheduled = true
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(flushNotify)
  } else {
    // Non-browser (SSR/tests without rAF): notify synchronously.
    flushNotify()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validTemp(v: number | null | undefined): v is number {
  return v != null && v >= TEMP_MIN && v <= TEMP_MAX
}

/** Downsample in place to `floor` points, always keeping first + last. */
function downsampleInPlace<T>(data: T[], floor: number): T[] {
  if (data.length <= floor) return data
  const step = data.length / floor
  const out: T[] = []
  for (let i = 0; i < floor; i++) out.push(data[Math.floor(i * step)])
  const last = data[data.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** True when the machine reports a genuine idle/off/home state. */
function isIdleState(stateLC: string): boolean {
  return (
    stateLC === 'idle' ||
    stateLC === 'home' ||
    stateLC === 'off' ||
    stateLC.startsWith('sleep')
  )
}

/** True when the machine is heating, preheating, or holding at ready. */
function isHeatingLikeState(stateLC: string, preheatActive: boolean): boolean {
  return (
    preheatActive ||
    stateLC === 'heating' ||
    stateLC === 'preheating' ||
    stateLC.startsWith('click to start')
  )
}

function clearAll() {
  const had = shotSamples.length > 0 || heatingSamples.length > 0
  shotSamples = []
  heatingSamples = []
  heatingStartMs = null
  lastShotTime = null
  if (had) scheduleNotify()
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

function recordHeating(ms: MachineState) {
  if (!validTemp(ms.brew_head_temperature)) return
  const now = nowFn()
  if (heatingStartMs === null) heatingStartMs = now
  const t = (now - heatingStartMs) / 1000
  const chamber = validTemp(ms.boiler_temperature) ? ms.boiler_temperature : undefined
  heatingSamples = [...heatingSamples, { t, temp: ms.brew_head_temperature, chamber }]
  if (heatingSamples.length > HEATING_CAP) {
    heatingSamples = downsampleInPlace(heatingSamples, HEATING_FLOOR)
  }
  scheduleNotify()
}

function recordShot(ms: MachineState) {
  const time = ms.shot_timer ?? 0

  // New shot: machine time reset (rising edge handled by caller via lastBrewing)
  // or a regression in shot_timer. Start the shot buffer fresh.
  if (lastShotTime !== null && time < lastShotTime - 0.05) {
    shotSamples = []
  }
  lastShotTime = time

  const point: ChartDataPoint = {
    time,
    pressure: ms.pressure ?? 0,
    flow: Math.max(0, ms.flow_rate ?? 0),
    weight: ms.shot_weight ?? 0,
    power: ms.power ?? 0,
    temperature: validTemp(ms.brew_head_temperature)
      ? ms.brew_head_temperature
      : undefined,
    stage: ms.state ?? undefined,
  }

  // De-dupe: frames at the same machine time replace the latest sample so
  // 50 Hz bursts sharing a `profile_time` don't stack.
  const last = shotSamples[shotSamples.length - 1]
  if (last && Math.abs(last.time - time) < 1e-6) {
    shotSamples = [...shotSamples.slice(0, -1), point]
  } else {
    shotSamples = [...shotSamples, point]
  }
  if (shotSamples.length > SHOT_CAP) {
    shotSamples = downsampleInPlace(shotSamples, SHOT_FLOOR)
  }
  scheduleNotify()
}

/**
 * Feed one telemetry frame into the recorder. Call on every `machineState`
 * change from the always-mounted App-level telemetry hook.
 */
export function recordTelemetry(ms: MachineState): void {
  const brewing = !!ms.brewing
  const stateLC = (ms.state ?? '').toLowerCase()
  const preheatActive = (ms.preheat_countdown ?? 0) > 0

  if (brewing) {
    // Rising edge into a shot: drop any prior shot buffer so a new shot starts clean.
    if (!lastBrewing) {
      shotSamples = []
      lastShotTime = null
    }
    lastBrewing = true
    recordShot(ms)
    return
  }

  lastBrewing = false

  if (isHeatingLikeState(stateLC, preheatActive)) {
    recordHeating(ms)
    return
  }

  if (isIdleState(stateLC)) {
    clearAll()
    return
  }

  // Transient in-between states (e.g. drawdown/purge/retracting) or an unknown/
  // null state: keep the buffers untouched so the just-finished shot survives
  // until the machine truly returns to idle.
}

// ---------------------------------------------------------------------------
// Reader API (useSyncExternalStore-compatible)
// ---------------------------------------------------------------------------

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): ShotTelemetrySnapshot {
  return snapshot
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset all recorder state. Intended for tests. */
export function resetShotTelemetry(): void {
  shotSamples = []
  heatingSamples = []
  version = 0
  heatingStartMs = null
  lastBrewing = false
  lastShotTime = null
  notifyScheduled = false
  rebuildSnapshot()
}

/** Override the clock (tests). Pass no argument to restore Date.now. */
export function __setNowFn(fn?: () => number): void {
  nowFn = fn ?? (() => Date.now())
}
