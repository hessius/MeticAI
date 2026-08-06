/**
 * On-device diagnostics — captures signals that help diagnose field freezes
 * (ANRs) and crashes on devices we cannot attach a debugger to (e.g. a user's
 * phone where `adb logcat` is not an option).
 *
 * It is intentionally passive and cheap: it never changes app behavior, only
 * observes. Two classes of signal are recorded into a small ring buffer that is
 * persisted to localStorage (so it survives a WebView reload / renderer crash):
 *
 *  - Main-thread stalls: a 1s heartbeat measures wall-clock drift. If the JS
 *    main thread is blocked (the classic "Metic isn't responding" ANR), the
 *    heartbeat that should have fired is delayed; the measured drift is the
 *    approximate freeze duration. This is the key signal: a run of multi-second
 *    stalls proves the freeze is in the JS/WebView thread, while its ABSENCE
 *    during a reported freeze proves the block is native (plugin / WebView
 *    engine), pointing the investigation in opposite directions.
 *  - Errors: window `error`, `unhandledrejection`, and long tasks (Performance
 *    Observer), plus any explicit reports (e.g. from the React error boundary).
 *
 * The report is surfaced in Settings so a user can copy and send it back.
 */

export type DiagnosticKind = 'boot' | 'stall' | 'longtask' | 'error' | 'rejection' | 'info'

export interface DiagnosticEvent {
  /** Epoch milliseconds */
  t: number
  kind: DiagnosticKind
  detail: string
  /** Duration in ms for stall / longtask events */
  ms?: number
}

const STORAGE_KEY = 'metic.diagnostics.v1'
const MAX_EVENTS = 200
/** Heartbeat cadence. */
const HEARTBEAT_MS = 1000
/**
 * Minimum drift (beyond the expected cadence) to count as a stall. Kept above
 * normal timer jitter / GC pauses so we only record genuine multi-second
 * freezes that a user would perceive as "not responding".
 */
const STALL_THRESHOLD_MS = 2500
/** Only record long tasks at least this long to avoid noise. */
const LONGTASK_THRESHOLD_MS = 300

let events: DiagnosticEvent[] = []
let started = false
let persistTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function loadPersisted(): void {
  if (!hasWindow()) return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      events = parsed.filter(
        (e): e is DiagnosticEvent =>
          e && typeof e.t === 'number' && typeof e.kind === 'string' && typeof e.detail === 'string',
      )
    }
  } catch {
    // Corrupt or unavailable storage — start fresh.
  }
}

function persistNow(): void {
  if (!hasWindow()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch {
    // Storage full / unavailable — diagnostics are best-effort.
  }
}

function schedulePersist(): void {
  if (persistTimer !== null || !hasWindow()) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    persistNow()
  }, 500)
}

/**
 * Record a diagnostic event. Safe to call before {@link startDiagnostics} and
 * from any environment (guards missing window/storage).
 */
export function recordDiagnostic(kind: DiagnosticKind, detail: string, ms?: number): void {
  const event: DiagnosticEvent = { t: Date.now(), kind, detail }
  if (typeof ms === 'number') event.ms = Math.round(ms)
  events.push(event)
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS)
  }
  schedulePersist()
}

/** Snapshot of collected events (oldest first). */
export function getDiagnosticEvents(): DiagnosticEvent[] {
  return events.slice()
}

/** Clear all collected events and persisted storage. */
export function clearDiagnostics(): void {
  events = []
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  if (hasWindow()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}

function environmentLines(): string[] {
  const lines: string[] = []
  const version =
    (globalThis as Record<string, unknown>).__APP_VERSION__ !== undefined
      ? String((globalThis as Record<string, unknown>).__APP_VERSION__)
      : 'unknown'
  lines.push(`App: ${version}`)

  if (hasWindow()) {
    const cap = (window as unknown as Record<string, unknown>).Capacitor as
      | { getPlatform?: () => string; isNativePlatform?: () => boolean }
      | undefined
    const platform = cap?.getPlatform?.() ?? 'web'
    const native = cap?.isNativePlatform?.() ?? false
    lines.push(`Platform: ${platform} (native=${native})`)
    if (typeof navigator !== 'undefined') {
      lines.push(`UA: ${navigator.userAgent}`)
    }
    if (typeof screen !== 'undefined') {
      const dpr = window.devicePixelRatio ?? 1
      lines.push(`Screen: ${screen.width}x${screen.height} dpr=${dpr}`)
    }
    lines.push(`Viewport: ${window.innerWidth}x${window.innerHeight}`)
  }
  return lines
}

function formatEvent(e: DiagnosticEvent): string {
  const time = new Date(e.t).toISOString().slice(11, 23)
  const dur = typeof e.ms === 'number' ? ` ${e.ms}ms` : ''
  return `[${time}] ${e.kind.toUpperCase()}${dur} ${e.detail}`
}

/** Build a human-readable, copy-pasteable diagnostics report. */
export function getDiagnosticsReport(): string {
  const header = ['Metic Diagnostics', ...environmentLines()]
  if (events.length === 0) {
    header.push('', 'No events recorded yet.')
    return header.join('\n')
  }
  const stalls = events.filter(e => e.kind === 'stall').length
  const errors = events.filter(e => e.kind === 'error' || e.kind === 'rejection').length
  header.push(`Summary: ${events.length} events (${stalls} stalls, ${errors} errors)`)
  header.push('', '--- events (oldest first) ---')
  return [...header, ...events.map(formatEvent)].join('\n')
}

function startHeartbeat(): void {
  if (typeof performance === 'undefined') return
  let last = performance.now()
  heartbeatTimer = window.setInterval(() => {
    const now = performance.now()
    const drift = now - last - HEARTBEAT_MS
    last = now
    // A hidden document (backgrounded app) legitimately throttles timers, which
    // would look like a stall — ignore those to avoid false positives.
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (drift >= STALL_THRESHOLD_MS && !hidden) {
      recordDiagnostic('stall', `Main thread blocked ~${Math.round(drift)}ms`, drift)
    }
  }, HEARTBEAT_MS)
}

function startLongTaskObserver(): void {
  if (typeof PerformanceObserver === 'undefined') return
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= LONGTASK_THRESHOLD_MS) {
          recordDiagnostic('longtask', `Long task (${entry.name})`, entry.duration)
        }
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    // longtask not supported on this engine.
  }
}

function startErrorHandlers(): void {
  window.addEventListener('error', event => {
    const where = event.filename
      ? ` @ ${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`
      : ''
    const message = event.message || safeStringify(event.error) || 'unknown error'
    recordDiagnostic('error', `${message}${where}`)
  })
  window.addEventListener('unhandledrejection', event => {
    recordDiagnostic('rejection', `Unhandled rejection: ${safeStringify(event.reason)}`)
  })
  // Persist immediately when the app is backgrounded / torn down so a
  // subsequent hard freeze or kill does not lose the latest events.
  window.addEventListener('pagehide', persistNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow()
  })
}

/**
 * Initialize diagnostics. Idempotent — safe to call once at app startup.
 * Loads any previously persisted events, records a boot marker, and starts the
 * heartbeat / observers / error handlers.
 */
export function startDiagnostics(): void {
  if (started || !hasWindow()) return
  started = true
  loadPersisted()
  recordDiagnostic('boot', 'App started')
  startHeartbeat()
  startLongTaskObserver()
  startErrorHandlers()
}

/**
 * Stop the heartbeat and flush pending persistence. Primarily useful for tests
 * and teardown; the app itself keeps diagnostics running for its whole
 * lifetime. Does not remove global error listeners.
 */
export function stopDiagnostics(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  started = false
}
