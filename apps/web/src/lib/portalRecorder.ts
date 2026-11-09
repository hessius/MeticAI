/**
 * portalRecorder — app-lifetime store that joins the Belka Portal's EC stream
 * with the machine's shot lifecycle and hands finished recordings to the core.
 *
 * Mirrors `shotTelemetryRecorder`: a module singleton fed once from the
 * always-mounted App (`usePortalRecorder(machineState)`), read by views through
 * `useSyncExternalStore`. Capture is purely client-side because Web Bluetooth
 * only exists in the browser; storage, analysis and calibration are the core's.
 *
 * Timebase. The machine reports `shot_timer` in seconds since its own shot
 * start. On the rising edge of `brewing` we fix
 *     anchorMs = wall-clock now − shot_timer·1000
 * and every Portal packet is stamped `(wall − anchorMs) / 1000`, so Portal
 * samples share the machine's clock without the two devices ever talking.
 *
 * Lifecycle.  idle → recording (brewing went true) → settling (brewing went
 * false; keep catching drips for `settleSec`) → binding (find the shot the
 * machine just saved via /api/last-shot and PUT the recording under its key)
 * → idle. A recording that cannot be bound (machine not reachable, shot file
 * not there yet) is parked in localStorage and retried on the next idle frame
 * and on the next app start, so nothing is lost.
 */

import type { MachineState } from '@/hooks/useWebSocket'
import type { PortalSample } from '@metic/core/logic/portalAnalysis'
import { STORAGE_KEYS } from '@/lib/constants'
import { loadPortalSettings } from '@/lib/portalSettings'
import { portalBle, type PortalConnectionState, type PortalSampleEvent, type PortalStateEvent, type PortalStep, type PortalStepValue } from '@/services/portal/portalBle'
import { fetchLastShot, putPortalShot } from '@/services/portal/portalApi'

export type PortalRecordingState = 'idle' | 'recording' | 'settling' | 'binding'

export interface PortalSnapshot {
  connection: PortalConnectionState
  deviceName: string | null
  /** Latest EC reading (Portal units), null until the first packet. */
  ec: number | null
  /** Latest outlet temperature °C. */
  tOut: number | null
  packetRate: number
  steps: Partial<Record<PortalStep, PortalStepValue>>
  recording: PortalRecordingState
  /** Samples of the shot in progress (or just finished, until bound). */
  liveSamples: PortalSample[]
  /** The last recording that was stored, for a confirmation in the UI. */
  lastSaved: { date: string; filename: string; sampleCount: number; at: number } | null
  /** Recordings waiting to be matched to a machine shot. */
  pendingCount: number
  lastError: string | null
  version: number
}

export interface PendingRecording {
  startedAt: number
  stopTimeSec: number | null
  lagSec: number
  deviceName: string | null
  coffee: string | null
  doseG: number | null
  samples: PortalSample[]
  attempts: number
}

const MIN_SAMPLES = 10
const MAX_LIVE_SAMPLES = 20_000
/** How close the machine's saved shot must be to our anchor to be "the same shot". */
const BIND_WINDOW_MS = 120_000
const BIND_ATTEMPTS = 10
const BIND_RETRY_MS = 3_000
const PENDING_MAX_AGE_MS = 7 * 86_400_000

type Listener = () => void
const listeners = new Set<Listener>()

let connection: PortalConnectionState = 'idle'
let deviceName: string | null = null
let last: PortalSampleEvent | null = null
let recording: PortalRecordingState = 'idle'
let liveSamples: PortalSample[] = []
let anchorMs: number | null = null
let stopTimeSec: number | null = null
let lastBrewing = false
let settleTimer: ReturnType<typeof setTimeout> | null = null
let lastSaved: PortalSnapshot['lastSaved'] = null
let lastError: string | null = null
let version = 0
let graphShown = false
let bindingPending = false

let snapshot: PortalSnapshot = build()

// Injectable for tests.
let nowFn: () => number = () => Date.now()
let lastShotFn: typeof fetchLastShot = fetchLastShot
let putFn: typeof putPortalShot = putPortalShot

function build(): PortalSnapshot {
  return {
    connection,
    deviceName,
    ec: last?.ec ?? null,
    tOut: last?.tOut ?? null,
    packetRate: portalBle.packetRate(),
    steps: { ...portalBle.steps },
    recording,
    liveSamples,
    lastSaved,
    pendingCount: readPending().length,
    lastError,
    version,
  }
}

let notifyScheduled = false
function flush() {
  notifyScheduled = false
  snapshot = build()
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* a broken listener must not wedge the recorder */
    }
  })
}
function notify() {
  version++
  if (notifyScheduled) return
  notifyScheduled = true
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
  else flush()
}

// ---------------------------------------------------------------------------
// Portal events
// ---------------------------------------------------------------------------

portalBle.addEventListener('state', (ev) => {
  const d = (ev as CustomEvent<PortalStateEvent>).detail
  connection = d.state
  if (d.state === 'connected') {
    deviceName = d.name ?? 'Belka Portal'
    lastError = null
    // Connected mid-shot: switch the Portal's screen now.
    if (recording === 'recording' && loadPortalSettings().autoGraph && !graphShown) {
      graphShown = true
      portalBle.showGraph().catch(() => {})
    }
  } else if (d.state === 'error') {
    lastError = d.error ?? 'Portal error'
  } else if (d.state !== 'connecting') {
    last = null
  }
  notify()
})

portalBle.addEventListener('measurement', (ev) => {
  const m = (ev as CustomEvent<PortalSampleEvent>).detail
  last = m
  if ((recording === 'recording' || recording === 'settling') && anchorMs !== null) {
    const t = (m.wall - anchorMs) / 1000
    liveSamples = [...liveSamples, { t: Math.round(t * 1000) / 1000, ec: m.ec, tOut: m.tOut, tInt: m.tInt, status: m.status }]
    if (liveSamples.length > MAX_LIVE_SAMPLES) liveSamples = liveSamples.slice(-MAX_LIVE_SAMPLES)
  }
  notify()
})

portalBle.addEventListener('step', () => notify())

// ---------------------------------------------------------------------------
// Machine lifecycle
// ---------------------------------------------------------------------------

function start(ms: MachineState) {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = null
  anchorMs = nowFn() - Math.max(0, ms.shot_timer ?? 0) * 1000
  liveSamples = []
  stopTimeSec = null
  recording = 'recording'
  lastError = null
  if (connection === 'connected' && loadPortalSettings().autoGraph) {
    graphShown = true
    portalBle.showGraph().catch(() => {})
  }
  notify()
}

function settle(ms: MachineState) {
  stopTimeSec = ms.shot_timer != null && ms.shot_timer > 0 ? ms.shot_timer : anchorMs !== null ? (nowFn() - anchorMs) / 1000 : null
  recording = 'settling'
  notify()
  const settleSec = loadPortalSettings().settleSec
  settleTimer = setTimeout(() => void finalize(), settleSec * 1000)
}

async function finalize() {
  settleTimer = null
  if (graphShown) {
    graphShown = false
    if (connection === 'connected') portalBle.hideGraph().catch(() => {})
  }
  const samples = liveSamples
  const startedAt = anchorMs ?? nowFn()
  if (samples.length < MIN_SAMPLES) {
    // Nothing worth keeping (Portal not connected, or a flush/purge).
    recording = 'idle'
    liveSamples = []
    anchorMs = null
    notify()
    return
  }
  const settings = loadPortalSettings()
  const pending: PendingRecording = {
    startedAt,
    stopTimeSec,
    lagSec: settings.lagSec,
    deviceName,
    coffee: settings.lastCoffee || null,
    doseG: settings.lastDoseG,
    samples,
    attempts: 0,
  }
  recording = 'binding'
  notify()
  const bound = await bind(pending)
  if (!bound) {
    addPending(pending)
    lastError = 'Portal recording saved locally; it will be attached to the shot when the machine lists it.'
  }
  recording = 'idle'
  liveSamples = []
  anchorMs = null
  notify()
}

/**
 * Match the recording to the machine's most recent saved shot and store it.
 * The machine writes the shot file a few seconds after extraction, so we poll.
 */
async function bind(rec: PendingRecording, attempts = BIND_ATTEMPTS, retryMs = BIND_RETRY_MS): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const lastShot = await lastShotFn()
    if (lastShot && Math.abs(lastShot.timestamp * 1000 - rec.startedAt) <= BIND_WINDOW_MS) {
      try {
        await putFn(lastShot.date, lastShot.filename, {
          samples: rec.samples,
          startedAt: rec.startedAt,
          lagSec: rec.lagSec,
          stopTimeSec: rec.stopTimeSec,
          deviceName: rec.deviceName,
          coffee: rec.coffee,
          doseG: rec.doseG,
        })
        lastSaved = { date: lastShot.date, filename: lastShot.filename, sampleCount: rec.samples.length, at: nowFn() }
        lastError = null
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('meticai:portal-saved', { detail: lastSaved }))
        }
        return true
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        return false
      }
    }
    if (lastShot && lastShot.timestamp * 1000 > rec.startedAt + BIND_WINDOW_MS) return false // a newer shot already exists
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, retryMs))
  }
  return false
}

// ---------------------------------------------------------------------------
// Pending recordings (localStorage)
// ---------------------------------------------------------------------------

function readPending(): PendingRecording[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.PORTAL_PENDING) : null
    const list = raw ? (JSON.parse(raw) as PendingRecording[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writePending(list: PendingRecording[]) {
  try {
    if (list.length) localStorage.setItem(STORAGE_KEYS.PORTAL_PENDING, JSON.stringify(list))
    else localStorage.removeItem(STORAGE_KEYS.PORTAL_PENDING)
  } catch {
    /* storage unavailable */
  }
}

function addPending(rec: PendingRecording) {
  const list = readPending().filter((p) => nowFn() - p.startedAt < PENDING_MAX_AGE_MS)
  list.push(rec)
  writePending(list.slice(-5)) // keep the five most recent; each can be ~250 KB
}

/** Try once more to attach any parked recordings. Returns how many were bound. */
export async function retryPendingPortalRecordings(): Promise<number> {
  if (bindingPending) return 0
  const list = readPending()
  if (!list.length) return 0
  bindingPending = true
  let bound = 0
  try {
    const keep: PendingRecording[] = []
    for (const rec of list) {
      rec.attempts = (rec.attempts ?? 0) + 1
      const ok = await bind(rec, 1, 0)
      if (ok) bound++
      else if (nowFn() - rec.startedAt < PENDING_MAX_AGE_MS) keep.push(rec)
    }
    writePending(keep)
  } finally {
    bindingPending = false
    notify()
  }
  return bound
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Feed one telemetry frame. Call on every `machineState` change from App. */
export function recordPortalTelemetry(ms: MachineState): void {
  if (!loadPortalSettings().enabled) {
    lastBrewing = !!ms.brewing
    return
  }
  const brewing = !!ms.brewing
  if (brewing && !lastBrewing) start(ms)
  else if (!brewing && lastBrewing && recording === 'recording') settle(ms)
  lastBrewing = brewing
}

export function subscribePortal(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPortalSnapshot(): PortalSnapshot {
  return snapshot
}

/** Stop a recording by hand (e.g. the machine never reported the end). */
export function stopPortalRecordingNow(): void {
  if (recording !== 'recording' && recording !== 'settling') return
  if (settleTimer) clearTimeout(settleTimer)
  if (recording === 'recording' && anchorMs !== null) stopTimeSec = (nowFn() - anchorMs) / 1000
  void finalize()
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function __resetPortalRecorder(): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = null
  connection = 'idle'
  deviceName = null
  last = null
  recording = 'idle'
  liveSamples = []
  anchorMs = null
  stopTimeSec = null
  lastBrewing = false
  lastSaved = null
  lastError = null
  graphShown = false
  bindingPending = false
  version = 0
  notifyScheduled = false
  snapshot = build()
}

export function __setPortalRecorderDeps(deps: { now?: () => number; lastShot?: typeof fetchLastShot; put?: typeof putPortalShot }): void {
  nowFn = deps.now ?? (() => Date.now())
  lastShotFn = deps.lastShot ?? fetchLastShot
  putFn = deps.put ?? putPortalShot
}

/** Inject a Portal packet without Bluetooth (tests, demos). */
export function __injectPortalMeasurement(m: { ec: number; tOut?: number; tInt?: number; status?: number; wall?: number }): void {
  portalBle.dispatchEvent(
    new CustomEvent('measurement', {
      detail: { ec: m.ec, tOut: m.tOut ?? 60, tInt: m.tInt ?? 30, status: m.status ?? 0, at: performance.now(), wall: m.wall ?? nowFn() },
    }),
  )
}

export function __setPortalConnection(state: PortalConnectionState, name?: string): void {
  portalBle.dispatchEvent(new CustomEvent('state', { detail: { state, name } }))
}
