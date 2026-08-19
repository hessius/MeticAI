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
 *
 * Opt-in: collection and the automatic boot overlay only run when the user
 * enables diagnostics in Settings (persisted flag, default OFF). The manual
 * `#diagnostics` URL escape hatch always works so support can talk any user
 * through reaching it.
 */

import { STORAGE_KEYS } from '@/lib/constants'

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
/**
 * Timestamp (epoch ms) of the freeze the user has already been shown. The boot
 * overlay only auto-appears when there is a stall newer than this, so it does
 * not nag on every launch after the user has seen / sent a report.
 */
const ACK_KEY = 'metic.diagnostics.ack'
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

/**
 * Whether the user has opted in to on-device diagnostics. Default OFF so passive
 * capture and the automatic boot overlay never run — and never nag — unless the
 * user explicitly enables them in Settings. Read synchronously from
 * localStorage so it is available during the earliest boot, before React mounts.
 */
export function isDiagnosticsEnabled(): boolean {
  if (!hasWindow()) return false
  try {
    return window.localStorage.getItem(STORAGE_KEYS.DIAGNOSTICS_ENABLED) === 'true'
  } catch {
    return false
  }
}

/**
 * Persist the opt-in flag and start or stop collection accordingly, so toggling
 * it in Settings takes effect immediately without an app restart. Disabling also
 * clears any captured data so a stale freeze can never resurface later.
 */
export function setDiagnosticsEnabled(enabled: boolean): void {
  if (hasWindow()) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.DIAGNOSTICS_ENABLED, enabled ? 'true' : 'false')
    } catch {
      // best-effort
    }
  }
  if (enabled) {
    startDiagnostics()
  } else {
    stopDiagnostics()
    clearDiagnostics()
  }
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

function ackTimestamp(): number {
  if (!hasWindow()) return 0
  try {
    const raw = window.localStorage.getItem(ACK_KEY)
    return raw ? Number(raw) || 0 : 0
  } catch {
    return 0
  }
}

function setAck(t: number): void {
  if (!hasWindow()) return
  try {
    window.localStorage.setItem(ACK_KEY, String(t))
  } catch {
    // best-effort
  }
}

/**
 * Timestamp of the most recent stall the user has not yet acknowledged, or 0 if
 * none. A stall is the fingerprint of a freeze/ANR, so this answers "did the app
 * freeze since we last showed the user a report?".
 */
export function lastUnacknowledgedFreeze(): number {
  const ack = ackTimestamp()
  let latest = 0
  for (const e of events) {
    if (e.kind === 'stall' && e.t > latest) latest = e.t
  }
  return latest > ack ? latest : 0
}

/** True when the current URL explicitly requests the diagnostics overlay. */
function overlayForcedByUrl(): boolean {
  if (!hasWindow() || typeof window.location === 'undefined') return false
  const { hash, search } = window.location
  return /(?:^|[#?&])diagnostics?(?:$|[=&])/i.test(hash || '') || /[?&]diagnostics?(?:=|&|$)/i.test(search || '')
}

function isNativePlatform(): boolean {
  if (!hasWindow()) return false
  const cap = (window as unknown as Record<string, unknown>).Capacitor as
    | { isNativePlatform?: () => boolean }
    | undefined
  return cap?.isNativePlatform?.() ?? false
}

async function copyReportToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

async function shareReport(text: string, title: string): Promise<boolean> {
  try {
    const mod = await import('@capacitor/share')
    await mod.Share.share({ title, text, dialogTitle: title })
    return true
  } catch {
    return false
  }
}

/**
 * Emergency escape hatch for the "app is frozen and I can never reach Settings"
 * case. Rendered as plain DOM (not React) as early as possible during boot, so
 * it is interactive even if the React tree / native plugins later deadlock, and
 * it surfaces the PREVIOUS session's captured freeze data (which was persisted
 * before the freeze).
 *
 * It appears automatically on native platforms when diagnostics are enabled and
 * there is an unacknowledged freeze, and on any platform when the URL contains
 * `#diagnostics` (so we can always talk a user through reaching it, even when
 * diagnostics are disabled). Copying or sharing the report, or dismissing it, acknowledges the freeze so it does not reappear until the next
 * one.
 *
 * @returns true when the overlay was shown.
 */
export function showBootDiagnosticsIfNeeded(options?: { force?: boolean }): boolean {
  if (!hasWindow() || typeof document === 'undefined' || !document.body) return false
  if (document.getElementById('metic-diag-overlay')) return true

  loadPersisted()
  const freezeAt = lastUnacknowledgedFreeze()
  const forced = options?.force === true || overlayForcedByUrl()
  // Auto-show only when the user has opted in; the URL escape hatch (forced)
  // always works so support can reach it even when diagnostics are disabled.
  const autoShow = isDiagnosticsEnabled() && freezeAt > 0 && isNativePlatform()
  if (!forced && !autoShow) return false

  const t = (key: string, fallback: string): string => {
    try {
      // i18next is exposed on globalThis by src/i18n/config.ts. Translations may
      // not be loaded this early (HTTP backend), so always pass an English
      // default to keep the overlay readable.
      const i18n = (globalThis as Record<string, unknown>).i18next as
        | { t?: (k: string, o?: Record<string, unknown>) => string }
        | undefined
      const translated = i18n?.t?.(key, { defaultValue: fallback })
      return typeof translated === 'string' && translated.length > 0 ? translated : fallback
    } catch {
      return fallback
    }
  }

  const report = getDiagnosticsReport()
  const title = t('settings.diagnostics.overlay.title', 'Metic diagnostics')
  const intro = t(
    'settings.diagnostics.overlay.intro',
    'Metic detected a freeze. Copy or share this report and send it to the developers so they can fix it.',
  )

  const overlay = document.createElement('div')
  overlay.id = 'metic-diag-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:#030202;color:#f5f5f5;' +
    'font:14px/1.4 -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;' +
    'padding:16px;box-sizing:border-box;-webkit-user-select:text;user-select:text;'

  const h = document.createElement('div')
  h.textContent = title
  h.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:8px;'

  const p = document.createElement('div')
  p.textContent = intro
  p.style.cssText = 'margin-bottom:12px;opacity:0.85;'

  const pre = document.createElement('pre')
  pre.textContent = report
  pre.style.cssText =
    'flex:1;overflow:auto;background:#141010;border-radius:8px;padding:12px;margin:0 0 12px;' +
    'white-space:pre-wrap;word-break:break-word;font-size:12px;'

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;'

  const acknowledge = () => setAck(freezeAt > 0 ? freezeAt : Date.now())

  const makeButton = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText =
      'flex:1;min-width:96px;padding:12px;border-radius:10px;border:0;font-size:15px;font-weight:600;' +
      (primary ? 'background:#c9773a;color:#fff;' : 'background:#2a2222;color:#f5f5f5;') +
      'cursor:pointer;-webkit-tap-highlight-color:transparent;'
    b.addEventListener('click', onClick)
    return b
  }

  const copyBtn = makeButton(t('settings.diagnostics.overlay.copy', 'Copy report'), true, async () => {
    const ok = await copyReportToClipboard(report)
    copyBtn.textContent = ok
      ? t('settings.diagnostics.overlay.copied', 'Copied')
      : t('settings.diagnostics.overlay.copyFailed', 'Copy failed')
    acknowledge()
  })

  const shareBtn = makeButton(t('settings.diagnostics.overlay.share', 'Share'), false, async () => {
    const ok = await shareReport(report, title)
    if (!ok) {
      const copied = await copyReportToClipboard(report)
      shareBtn.textContent = copied
        ? t('settings.diagnostics.overlay.copied', 'Copied')
        : t('settings.diagnostics.overlay.share', 'Share')
    }
    acknowledge()
  })

  const closeBtn = makeButton(t('settings.diagnostics.overlay.dismiss', 'Dismiss'), false, () => {
    acknowledge()
    overlay.remove()
  })

  row.append(copyBtn, shareBtn, closeBtn)
  overlay.append(h, p, pre, row)
  document.body.appendChild(overlay)
  return true
}

/**
 * Stop the heartbeat and flush pending persistence. Primarily useful for tests

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
