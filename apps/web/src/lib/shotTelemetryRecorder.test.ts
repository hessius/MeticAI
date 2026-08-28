import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MachineState } from '@/hooks/useWebSocket'
import {
  recordTelemetry,
  getSnapshot,
  subscribe,
  resetShotTelemetry,
  __setNowFn,
} from './shotTelemetryRecorder'

/** Build a MachineState with sensible telemetry defaults. */
function ms(partial: Partial<MachineState>): MachineState {
  return {
    connected: true,
    availability: 'online',
    boiler_temperature: null,
    brew_head_temperature: null,
    target_temperature: null,
    brewing: false,
    state: null,
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

describe('shotTelemetryRecorder', () => {
  beforeEach(() => {
    // Make rAF-coalesced notify synchronous so getSnapshot reflects writes immediately.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    resetShotTelemetry()
    __setNowFn(() => 0)
  })

  afterEach(() => {
    resetShotTelemetry()
    __setNowFn()
    vi.unstubAllGlobals()
  })

  it('records heating samples with elapsed timing and chamber temp', () => {
    let clock = 1000
    __setNowFn(() => clock)

    recordTelemetry(ms({ state: 'heating', brew_head_temperature: 80, boiler_temperature: 92 }))
    clock = 1500
    recordTelemetry(ms({ state: 'heating', brew_head_temperature: 88, boiler_temperature: 94 }))

    const { heatingSamples } = getSnapshot()
    expect(heatingSamples).toHaveLength(2)
    expect(heatingSamples[0]).toEqual({ t: 0, temp: 80, chamber: 92 })
    expect(heatingSamples[1]).toEqual({ t: 0.5, temp: 88, chamber: 94 })
  })

  it('ignores out-of-range temperature glitches', () => {
    recordTelemetry(ms({ state: 'heating', brew_head_temperature: 999 }))
    recordTelemetry(ms({ state: 'heating', brew_head_temperature: -5 }))
    expect(getSnapshot().heatingSamples).toHaveLength(0)
  })

  it('records shot samples keyed by shot_timer', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 0.5, pressure: 6, flow_rate: 2, shot_weight: 1, state: 'Preinfusion' }))
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 9, flow_rate: 3, shot_weight: 4, state: 'Infusion' }))

    const { shotSamples } = getSnapshot()
    expect(shotSamples).toHaveLength(2)
    expect(shotSamples[0]).toMatchObject({ time: 0.5, pressure: 6, flow: 2, weight: 1, stage: 'Preinfusion' })
    expect(shotSamples[1]).toMatchObject({ time: 1.0, pressure: 9, flow: 3, weight: 4, stage: 'Infusion' })
  })

  it('de-dupes frames sharing the same shot_timer (keeps the latest)', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 6 }))
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 8 }))

    const { shotSamples } = getSnapshot()
    expect(shotSamples).toHaveLength(1)
    expect(shotSamples[0].pressure).toBe(8)
  })

  it('starts a fresh shot buffer on the brewing rising edge', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 6 }))
    recordTelemetry(ms({ brewing: true, shot_timer: 2.0, pressure: 7 }))
    // Non-brewing transient (e.g. drawdown) between shots
    recordTelemetry(ms({ brewing: false, state: 'drawdown' }))
    // Next shot begins — rising edge resets the buffer
    recordTelemetry(ms({ brewing: true, shot_timer: 0.2, pressure: 5 }))

    const { shotSamples } = getSnapshot()
    expect(shotSamples).toHaveLength(1)
    expect(shotSamples[0].time).toBe(0.2)
  })

  it('starts a fresh shot buffer when shot_timer regresses within a brew', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0 }))
    recordTelemetry(ms({ brewing: true, shot_timer: 2.0 }))
    recordTelemetry(ms({ brewing: true, shot_timer: 0.3 }))

    const { shotSamples } = getSnapshot()
    expect(shotSamples).toHaveLength(1)
    expect(shotSamples[0].time).toBe(0.3)
  })

  it('clears buffers when the machine returns to idle', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 6 }))
    expect(getSnapshot().shotSamples).toHaveLength(1)

    recordTelemetry(ms({ brewing: false, state: 'idle' }))
    expect(getSnapshot().shotSamples).toHaveLength(0)
    expect(getSnapshot().heatingSamples).toHaveLength(0)
  })

  it('does NOT clear on transient post-shot states (drawdown/purge/retracting)', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 6 }))
    recordTelemetry(ms({ brewing: false, state: 'drawdown' }))
    recordTelemetry(ms({ brewing: false, state: 'purge' }))
    recordTelemetry(ms({ brewing: false, state: 'retracting' }))

    // The just-finished shot survives until a genuine idle return.
    expect(getSnapshot().shotSamples).toHaveLength(1)
  })

  it('caps and downsamples long shot buffers', () => {
    for (let i = 0; i < 4100; i++) {
      recordTelemetry(ms({ brewing: true, shot_timer: i * 0.01, pressure: 6 }))
    }
    const { shotSamples } = getSnapshot()
    // Downsampling fires at the 4000 cap, so the buffer stays bounded well
    // below the number of frames fed in.
    expect(shotSamples.length).toBeLessThanOrEqual(4000)
    expect(shotSamples.length).toBeLessThan(4100)
    // First and last points are preserved through downsampling.
    expect(shotSamples[0].time).toBeCloseTo(0, 5)
    expect(shotSamples[shotSamples.length - 1].time).toBeCloseTo(40.99, 2)
  })

  it('back-fills without any subscriber (late-open scenario)', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 0.5, pressure: 6 }))
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 7 }))
    // A view mounting later reads the already-recorded history.
    expect(getSnapshot().shotSamples).toHaveLength(2)
  })

  it('notifies subscribers and bumps version on change', () => {
    const listener = vi.fn()
    const unsub = subscribe(listener)
    const v0 = getSnapshot().version

    recordTelemetry(ms({ brewing: true, shot_timer: 0.5, pressure: 6 }))
    expect(listener).toHaveBeenCalled()
    expect(getSnapshot().version).toBeGreaterThan(v0)

    unsub()
    listener.mockClear()
    recordTelemetry(ms({ brewing: true, shot_timer: 1.0, pressure: 7 }))
    expect(listener).not.toHaveBeenCalled()
  })

  it('returns a stable snapshot reference when nothing changed', () => {
    recordTelemetry(ms({ brewing: true, shot_timer: 0.5 }))
    const a = getSnapshot()
    const b = getSnapshot()
    expect(a).toBe(b)
  })
})
