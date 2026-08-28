import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  recordDiagnostic,
  getDiagnosticEvents,
  getDiagnosticsReport,
  clearDiagnostics,
  startDiagnostics,
  stopDiagnostics,
  lastUnacknowledgedFreeze,
  showBootDiagnosticsIfNeeded,
  isDiagnosticsEnabled,
  setDiagnosticsEnabled,
} from './diagnostics'
import { STORAGE_KEYS } from '@/lib/constants'

const STORAGE_KEY = 'metic.diagnostics.v1'
const ACK_KEY = 'metic.diagnostics.ack'
const enableDiagnostics = () => localStorage.setItem(STORAGE_KEYS.DIAGNOSTICS_ENABLED, 'true')

describe('diagnostics', () => {
  beforeEach(() => {
    clearDiagnostics()
    localStorage.clear()
    document.getElementById('metic-diag-overlay')?.remove()
    delete (window as unknown as Record<string, unknown>).Capacitor
  })

  describe('recordDiagnostic / getDiagnosticEvents', () => {
    it('records events in order with kind and detail', () => {
      recordDiagnostic('info', 'first')
      recordDiagnostic('error', 'second')
      const events = getDiagnosticEvents()
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ kind: 'info', detail: 'first' })
      expect(events[1]).toMatchObject({ kind: 'error', detail: 'second' })
      expect(typeof events[0].t).toBe('number')
    })

    it('stores a rounded duration when provided', () => {
      recordDiagnostic('stall', 'blocked', 1234.7)
      expect(getDiagnosticEvents()[0].ms).toBe(1235)
    })

    it('caps the ring buffer and keeps the most recent events', () => {
      for (let i = 0; i < 250; i++) {
        recordDiagnostic('info', `event-${i}`)
      }
      const events = getDiagnosticEvents()
      expect(events).toHaveLength(200)
      // Oldest 50 dropped; newest retained.
      expect(events[0].detail).toBe('event-50')
      expect(events[events.length - 1].detail).toBe('event-249')
    })

    it('persists events to localStorage', () => {
      vi.useFakeTimers()
      try {
        recordDiagnostic('info', 'persisted')
        // Persist is debounced by 500ms.
        vi.advanceTimersByTime(600)
        const raw = localStorage.getItem(STORAGE_KEY)
        expect(raw).toBeTruthy()
        expect(JSON.parse(raw!)[0].detail).toBe('persisted')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('clearDiagnostics', () => {
    it('empties events and removes persisted storage', () => {
      recordDiagnostic('info', 'x')
      localStorage.setItem(STORAGE_KEY, '[]')
      clearDiagnostics()
      expect(getDiagnosticEvents()).toHaveLength(0)
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
  })

  describe('getDiagnosticsReport', () => {
    it('includes a header and an empty-state message when no events', () => {
      const report = getDiagnosticsReport()
      expect(report).toContain('Metic Diagnostics')
      expect(report).toContain('No events recorded yet.')
    })

    it('includes a summary and formatted event lines', () => {
      recordDiagnostic('stall', 'Main thread blocked ~3000ms', 3000)
      recordDiagnostic('error', 'boom')
      const report = getDiagnosticsReport()
      expect(report).toContain('Summary: 2 events (1 stalls, 1 errors)')
      expect(report).toContain('STALL 3000ms Main thread blocked ~3000ms')
      expect(report).toContain('ERROR boom')
    })
  })

  describe('startDiagnostics heartbeat', () => {
    afterEach(() => {
      stopDiagnostics()
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('records a stall when the heartbeat drifts past the threshold', () => {
      vi.useFakeTimers()
      // Simulate wall-clock jumping far beyond the 1s cadence between ticks,
      // as if the main thread had been blocked (ANR).
      const nowSpy = vi.spyOn(performance, 'now')
      let virtual = 0
      nowSpy.mockImplementation(() => virtual)

      startDiagnostics()
      // First heartbeat tick establishes baseline at t=1000 (no drift).
      virtual = 1000
      vi.advanceTimersByTime(1000)
      // Next tick: pretend 6s of wall-clock elapsed while only one interval
      // fired -> ~5s of drift, which exceeds the 2.5s stall threshold.
      virtual = 7000
      vi.advanceTimersByTime(1000)

      const stalls = getDiagnosticEvents().filter(e => e.kind === 'stall')
      expect(stalls.length).toBeGreaterThanOrEqual(1)
      expect(stalls[0].ms).toBeGreaterThanOrEqual(2500)
    })
  })

  describe('lastUnacknowledgedFreeze', () => {
    const seed = (evts: unknown[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(evts))

    it('returns 0 when there are no stalls', () => {
      seed([{ t: 10, kind: 'info', detail: 'x' }])
      showBootDiagnosticsIfNeeded() // loads persisted
      expect(lastUnacknowledgedFreeze()).toBe(0)
    })

    it('returns the latest stall timestamp when unacknowledged', () => {
      seed([
        { t: 100, kind: 'stall', detail: 'a', ms: 3000 },
        { t: 500, kind: 'stall', detail: 'b', ms: 4000 },
        { t: 300, kind: 'info', detail: 'c' },
      ])
      showBootDiagnosticsIfNeeded({ force: true })
      expect(lastUnacknowledgedFreeze()).toBe(500)
    })

    it('returns 0 once the freeze has been acknowledged', () => {
      seed([{ t: 500, kind: 'stall', detail: 'b', ms: 4000 }])
      localStorage.setItem(ACK_KEY, '500')
      showBootDiagnosticsIfNeeded()
      expect(lastUnacknowledgedFreeze()).toBe(0)
    })
  })

  describe('showBootDiagnosticsIfNeeded', () => {
    const seed = (evts: unknown[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(evts))

    afterEach(() => {
      document.getElementById('metic-diag-overlay')?.remove()
      delete (window as unknown as Record<string, unknown>).Capacitor
    })

    it('does not show when there is no freeze and it is not forced', () => {
      seed([{ t: 1, kind: 'info', detail: 'x' }])
      expect(showBootDiagnosticsIfNeeded()).toBe(false)
      expect(document.getElementById('metic-diag-overlay')).toBeNull()
    })

    it('shows when explicitly forced, regardless of platform', () => {
      seed([])
      expect(showBootDiagnosticsIfNeeded({ force: true })).toBe(true)
      const overlay = document.getElementById('metic-diag-overlay')
      expect(overlay).not.toBeNull()
      expect(overlay!.textContent).toContain('Metic diagnostics')
    })

    it('auto-shows on native platforms when there is an unacknowledged freeze', () => {
      enableDiagnostics()
      ;(window as unknown as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => true,
      }
      seed([{ t: Date.now(), kind: 'stall', detail: 'blocked', ms: 3000 }])
      expect(showBootDiagnosticsIfNeeded()).toBe(true)
      expect(document.getElementById('metic-diag-overlay')).not.toBeNull()
    })

    it('does not auto-show on native when diagnostics are disabled (default)', () => {
      ;(window as unknown as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => true,
      }
      seed([{ t: Date.now(), kind: 'stall', detail: 'blocked', ms: 3000 }])
      expect(showBootDiagnosticsIfNeeded()).toBe(false)
      expect(document.getElementById('metic-diag-overlay')).toBeNull()
    })

    it('still shows when forced via URL even if diagnostics are disabled', () => {
      seed([])
      expect(showBootDiagnosticsIfNeeded({ force: true })).toBe(true)
      expect(document.getElementById('metic-diag-overlay')).not.toBeNull()
    })

    it('does not auto-show on web even with a freeze (only native or forced)', () => {
      enableDiagnostics()
      seed([{ t: Date.now(), kind: 'stall', detail: 'blocked', ms: 3000 }])
      expect(showBootDiagnosticsIfNeeded()).toBe(false)
      expect(document.getElementById('metic-diag-overlay')).toBeNull()
    })

    it('dismiss acknowledges the freeze so it does not reappear', () => {
      enableDiagnostics()
      ;(window as unknown as Record<string, unknown>).Capacitor = {
        isNativePlatform: () => true,
      }
      const freezeAt = Date.now()
      seed([{ t: freezeAt, kind: 'stall', detail: 'blocked', ms: 3000 }])
      expect(showBootDiagnosticsIfNeeded()).toBe(true)

      const overlay = document.getElementById('metic-diag-overlay')!
      const dismiss = Array.from(overlay.querySelectorAll('button')).find(
        b => b.textContent === 'Dismiss',
      )
      expect(dismiss).toBeTruthy()
      dismiss!.click()

      expect(document.getElementById('metic-diag-overlay')).toBeNull()
      expect(Number(localStorage.getItem(ACK_KEY))).toBe(freezeAt)
      // A second boot with the same persisted freeze must not re-show.
      expect(showBootDiagnosticsIfNeeded()).toBe(false)
    })
  })

  describe('isDiagnosticsEnabled / setDiagnosticsEnabled', () => {
    afterEach(() => {
      stopDiagnostics()
    })

    it('is disabled by default (opt-in)', () => {
      expect(isDiagnosticsEnabled()).toBe(false)
    })

    it('persists the flag and starts collecting when enabled', () => {
      setDiagnosticsEnabled(true)
      expect(isDiagnosticsEnabled()).toBe(true)
      expect(localStorage.getItem(STORAGE_KEYS.DIAGNOSTICS_ENABLED)).toBe('true')
      // startDiagnostics records a boot marker.
      expect(getDiagnosticEvents().some(e => e.kind === 'boot')).toBe(true)
    })

    it('clears captured data and the flag when disabled', () => {
      setDiagnosticsEnabled(true)
      recordDiagnostic('stall', 'blocked', 3000)
      setDiagnosticsEnabled(false)
      expect(isDiagnosticsEnabled()).toBe(false)
      expect(localStorage.getItem(STORAGE_KEYS.DIAGNOSTICS_ENABLED)).toBe('false')
      expect(getDiagnosticEvents()).toHaveLength(0)
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
  })
})
