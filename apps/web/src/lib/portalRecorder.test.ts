import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MachineState } from '@/hooks/useWebSocket'
import {
  recordPortalTelemetry,
  getPortalSnapshot,
  retryPendingPortalRecordings,
  stopPortalRecordingNow,
  __resetPortalRecorder,
  __setPortalRecorderDeps,
  __injectPortalMeasurement,
  __setPortalConnection,
} from './portalRecorder'
import { savePortalSettings, __resetPortalSettings } from './portalSettings'
import { STORAGE_KEYS } from './constants'

function ms(partial: Partial<MachineState>): MachineState {
  return {
    connected: true,
    availability: 'online',
    boiler_temperature: null,
    brew_head_temperature: null,
    target_temperature: null,
    brewing: false,
    state: 'idle',
    pressure: null,
    flow_rate: null,
    power: null,
    shot_weight: null,
    shot_timer: null,
    target_weight: null,
    preheat_countdown: null,
    active_profile: null,
    total_shots: null,
    brightness: null,
    sounds_enabled: null,
    voltage: null,
    firmware_version: null,
    last_shot_time: null,
    last_shot_name: null,
    _ts: null,
    _stale: false,
    _wsConnected: true,
    ...partial,
  }
}

const T0 = 1_700_000_000_000

describe('portalRecorder', () => {
  let now = T0
  let lastShot: { date: string; filename: string; timestamp: number } | null
  const put = vi.fn(async () => ({}) as never)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    localStorage.clear()
    __resetPortalSettings()
    __resetPortalRecorder()
    now = T0
    lastShot = null
    put.mockClear()
    __setPortalRecorderDeps({
      now: () => now,
      lastShot: async () => (lastShot ? { ...lastShot, profile_name: 'p', final_weight: 40, total_time: 30 } : null),
      put,
    })
    savePortalSettings({ enabled: true, settleSec: 2, lagSec: 0.5, autoGraph: false, lastCoffee: 'Hatch', lastDoseG: 18 })
    __setPortalConnection('connected', 'PORTAL-1')
  })

  afterEach(() => {
    __resetPortalRecorder()
    __setPortalRecorderDeps({})
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does nothing while the feature is disabled', () => {
    savePortalSettings({ enabled: false })
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    __injectPortalMeasurement({ ec: 2, wall: now + 500 })
    expect(getPortalSnapshot().recording).toBe('idle')
    expect(getPortalSnapshot().liveSamples).toEqual([])
    // but the live readout still shows the latest packet
    expect(getPortalSnapshot().ec).toBe(2)
  })

  it('anchors Portal samples to the machine shot clock', () => {
    // The machine reports 1.2 s into the shot when we first see brewing=true.
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 1.2 }))
    expect(getPortalSnapshot().recording).toBe('recording')
    __injectPortalMeasurement({ ec: 1.5, tOut: 61, wall: now + 300 })
    const s = getPortalSnapshot()
    expect(s.liveSamples.length).toBe(1)
    expect(s.liveSamples[0].t).toBeCloseTo(1.5, 3) // 1.2 s anchor + 0.3 s
    expect(s.liveSamples[0].ec).toBe(1.5)
    expect(s.liveSamples[0].tOut).toBe(61)
  })

  it('settles after the pump stops, then binds the recording to the machine\'s saved shot', async () => {
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    for (let i = 0; i < 40; i++) __injectPortalMeasurement({ ec: 2 - i * 0.02, wall: now + i * 125 })
    now += 30_000
    recordPortalTelemetry(ms({ brewing: false, shot_timer: 30 }))
    expect(getPortalSnapshot().recording).toBe('settling')
    // drips during the settle window are still captured
    __injectPortalMeasurement({ ec: 0.4, wall: now + 500 })
    expect(getPortalSnapshot().liveSamples.length).toBe(41)
    // The machine saves the shot file a moment later.
    lastShot = { date: '2023-11-14', filename: 'shot_7.json', timestamp: Math.round(T0 / 1000) + 1 }
    await vi.advanceTimersByTimeAsync(2_100)
    expect(put).toHaveBeenCalledTimes(1)
    const [date, filename, body] = put.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(date).toBe('2023-11-14')
    expect(filename).toBe('shot_7.json')
    expect((body.samples as unknown[]).length).toBe(41)
    expect(body.startedAt).toBe(T0)
    expect(body.stopTimeSec).toBe(30)
    expect(body.lagSec).toBe(0.5)
    expect(body.coffee).toBe('Hatch')
    expect(body.doseG).toBe(18)
    expect(body.deviceName).toBe('PORTAL-1')
    const s = getPortalSnapshot()
    expect(s.recording).toBe('idle')
    expect(s.lastSaved?.filename).toBe('shot_7.json')
    expect(s.liveSamples).toEqual([])
  })

  it('drops recordings with too few samples (Portal not connected)', async () => {
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    __injectPortalMeasurement({ ec: 1, wall: now + 100 })
    recordPortalTelemetry(ms({ brewing: false, shot_timer: 20 }))
    await vi.advanceTimersByTimeAsync(2_100)
    expect(put).not.toHaveBeenCalled()
    expect(getPortalSnapshot().recording).toBe('idle')
    expect(getPortalSnapshot().pendingCount).toBe(0)
  })

  it('parks the recording when the machine never lists the shot, and attaches it later', async () => {
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    for (let i = 0; i < 20; i++) __injectPortalMeasurement({ ec: 2, wall: now + i * 125 })
    recordPortalTelemetry(ms({ brewing: false, shot_timer: 25 }))
    // settle (2 s) + 10 bind attempts × 3 s with no shot appearing
    await vi.advanceTimersByTimeAsync(2_100 + 10 * 3_100)
    expect(put).not.toHaveBeenCalled()
    expect(getPortalSnapshot().recording).toBe('idle')
    expect(getPortalSnapshot().pendingCount).toBe(1)
    const parked = JSON.parse(localStorage.getItem(STORAGE_KEYS.PORTAL_PENDING) ?? '[]')
    expect(parked.length).toBe(1)
    expect(parked[0].samples.length).toBe(20)

    // Next session: the machine is reachable and lists the shot.
    lastShot = { date: '2023-11-14', filename: 'shot_8.json', timestamp: Math.round(T0 / 1000) }
    const n = await retryPendingPortalRecordings()
    expect(n).toBe(1)
    expect(put).toHaveBeenCalledTimes(1)
    expect(getPortalSnapshot().pendingCount).toBe(0)
  })

  it('does not bind to a shot that started long before or after the recording', async () => {
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    for (let i = 0; i < 20; i++) __injectPortalMeasurement({ ec: 2, wall: now + i * 125 })
    recordPortalTelemetry(ms({ brewing: false, shot_timer: 25 }))
    lastShot = { date: '2023-11-14', filename: 'old.json', timestamp: Math.round(T0 / 1000) - 3600 } // an hour earlier
    await vi.advanceTimersByTimeAsync(2_100 + 10 * 3_100)
    expect(put).not.toHaveBeenCalled()
    expect(getPortalSnapshot().pendingCount).toBe(1)
  })

  it('a manual stop finalises an open recording', async () => {
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    for (let i = 0; i < 20; i++) __injectPortalMeasurement({ ec: 2, wall: now + i * 125 })
    now += 12_000
    lastShot = { date: '2023-11-14', filename: 'shot_9.json', timestamp: Math.round(T0 / 1000) }
    stopPortalRecordingNow()
    await vi.advanceTimersByTimeAsync(100)
    expect(put).toHaveBeenCalledTimes(1)
    const body = (put.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2]
    expect(body.stopTimeSec).toBeCloseTo(12, 3)
  })

  it('a second shot starts a fresh buffer', async () => {
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    for (let i = 0; i < 20; i++) __injectPortalMeasurement({ ec: 2, wall: now + i * 125 })
    recordPortalTelemetry(ms({ brewing: false, shot_timer: 25 }))
    // back-to-back: brewing rises again before the settle window ends
    now += 1_000
    recordPortalTelemetry(ms({ brewing: true, shot_timer: 0 }))
    expect(getPortalSnapshot().recording).toBe('recording')
    expect(getPortalSnapshot().liveSamples).toEqual([])
  })
})
