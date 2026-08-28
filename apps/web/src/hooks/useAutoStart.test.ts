import { describe, it, expect } from 'vitest'
import {
  bothWithinBand,
  stepAutoStart,
  autoStartStatus,
  initialAutoStartState,
  type AutoStartInputs,
  type AutoStartState,
} from './useAutoStart'

const BAND = 2.3
const DWELL = 30_000

function inputs(partial: Partial<AutoStartInputs> = {}): AutoStartInputs {
  return {
    enabled: true,
    isReady: true,
    headTemp: 93,
    chamberTemp: 93,
    targetTemp: 93,
    band: BAND,
    dwellMs: DWELL,
    ...partial,
  }
}

describe('bothWithinBand', () => {
  it('true when both temps within band', () => {
    expect(bothWithinBand(inputs({ headTemp: 91.5, chamberTemp: 94.2, targetTemp: 93 }))).toBe(true)
  })
  it('false when head temp out of band', () => {
    expect(bothWithinBand(inputs({ headTemp: 89, chamberTemp: 93, targetTemp: 93 }))).toBe(false)
  })
  it('false when chamber temp out of band', () => {
    expect(bothWithinBand(inputs({ headTemp: 93, chamberTemp: 96, targetTemp: 93 }))).toBe(false)
  })
  it('false when any value is nullish', () => {
    expect(bothWithinBand(inputs({ headTemp: null }))).toBe(false)
    expect(bothWithinBand(inputs({ chamberTemp: undefined }))).toBe(false)
    expect(bothWithinBand(inputs({ targetTemp: null }))).toBe(false)
  })
})

describe('stepAutoStart', () => {
  it('does not fire before the dwell has elapsed', () => {
    const s0 = stepAutoStart(initialAutoStartState, inputs(), 0)
    expect(s0.fire).toBe(false)
    expect(s0.state.inBandSince).toBe(0)
    const s1 = stepAutoStart(s0.state, inputs(), DWELL - 1)
    expect(s1.fire).toBe(false)
  })

  it('fires once the dwell has elapsed', () => {
    const s0 = stepAutoStart(initialAutoStartState, inputs(), 1000)
    const s1 = stepAutoStart(s0.state, inputs(), 1000 + DWELL)
    expect(s1.fire).toBe(true)
    expect(s1.state.fired).toBe(true)
  })

  it('fires only once', () => {
    const s0 = stepAutoStart(initialAutoStartState, inputs(), 0)
    const s1 = stepAutoStart(s0.state, inputs(), DWELL)
    expect(s1.fire).toBe(true)
    const s2 = stepAutoStart(s1.state, inputs(), DWELL + 5000)
    expect(s2.fire).toBe(false)
  })

  it('resets the dwell clock when temp drifts out of band', () => {
    const s0 = stepAutoStart(initialAutoStartState, inputs(), 0)
    expect(s0.state.inBandSince).toBe(0)
    const drift = stepAutoStart(s0.state, inputs({ headTemp: 80 }), 10_000)
    expect(drift.state.inBandSince).toBe(null)
    // Back in band — clock restarts from the new time.
    const back = stepAutoStart(drift.state, inputs(), 12_000)
    expect(back.state.inBandSince).toBe(12_000)
    expect(stepAutoStart(back.state, inputs(), 12_000 + DWELL - 1).fire).toBe(false)
  })

  it('never fires when the machine is not at the ready gate', () => {
    const s0 = stepAutoStart(initialAutoStartState, inputs({ isReady: false }), 0)
    const s1 = stepAutoStart(s0.state, inputs({ isReady: false }), DWELL * 2)
    expect(s1.fire).toBe(false)
    expect(s1.state.inBandSince).toBe(null)
  })

  it('resets to initial state when disabled', () => {
    const prev: AutoStartState = { inBandSince: 5000, fired: false }
    const s = stepAutoStart(prev, inputs({ enabled: false }), 40_000)
    expect(s.fire).toBe(false)
    expect(s.state).toEqual(initialAutoStartState)
  })
})

describe('autoStartStatus', () => {
  it('reports armed with remaining time while dwelling', () => {
    const state: AutoStartState = { inBandSince: 1000, fired: false }
    const status = autoStartStatus(state, inputs(), 1000 + 10_000)
    expect(status.armed).toBe(true)
    expect(status.remainingMs).toBe(DWELL - 10_000)
  })
  it('not armed before dwell starts', () => {
    expect(autoStartStatus(initialAutoStartState, inputs(), 0).armed).toBe(false)
  })
  it('not armed once fired', () => {
    const state: AutoStartState = { inBandSince: 0, fired: true }
    expect(autoStartStatus(state, inputs(), DWELL).armed).toBe(false)
  })
  it('clamps remaining at zero', () => {
    const state: AutoStartState = { inBandSince: 0, fired: false }
    expect(autoStartStatus(state, inputs(), DWELL + 5000).remainingMs).toBe(0)
  })
})
