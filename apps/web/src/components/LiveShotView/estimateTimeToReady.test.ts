import { describe, it, expect } from 'vitest'
import { estimateTimeToReady } from './estimateTimeToReady'

const TARGET = 93
// Default ready band used across the heating view (target − 2.3°C).
const CUTOFF = TARGET - 2.3

describe('estimateTimeToReady', () => {
  it('predicts ~3 minutes to ready from a cold (room-temp) start', () => {
    const eta = estimateTimeToReady({ current: 20, target: TARGET, cutoff: CUTOFF })
    expect(eta).not.toBeNull()
    // Calibrated so ambient → cutoff ≈ 180s.
    expect(eta!).toBeCloseTo(180, 0)
  })

  it('predicts a much faster ready time for a hot (kettle-filled) start', () => {
    const eta = estimateTimeToReady({ current: 80, target: TARGET, cutoff: CUTOFF })
    expect(eta).not.toBeNull()
    // ~90s faster than a cold start, matching observed boil-fill behaviour.
    expect(eta!).toBeGreaterThan(60)
    expect(eta!).toBeLessThan(110)
  })

  it('decreases monotonically as the current temperature rises', () => {
    const cold = estimateTimeToReady({ current: 30, target: TARGET, cutoff: CUTOFF })!
    const warm = estimateTimeToReady({ current: 60, target: TARGET, cutoff: CUTOFF })!
    const hot = estimateTimeToReady({ current: 85, target: TARGET, cutoff: CUTOFF })!
    expect(cold).toBeGreaterThan(warm)
    expect(warm).toBeGreaterThan(hot)
  })

  it('returns 0 once the current temperature reaches the cutoff', () => {
    expect(estimateTimeToReady({ current: 91, target: TARGET, cutoff: CUTOFF })).toBe(0)
    expect(estimateTimeToReady({ current: 93, target: TARGET, cutoff: CUTOFF })).toBe(0)
  })

  it('returns 0 when target is at or below the cutoff', () => {
    expect(estimateTimeToReady({ current: 20, target: 90, cutoff: 90 })).toBe(0)
    expect(estimateTimeToReady({ current: 20, target: 89, cutoff: 90 })).toBe(0)
  })

  it('returns null for non-finite inputs', () => {
    expect(estimateTimeToReady({ current: NaN, target: TARGET, cutoff: CUTOFF })).toBeNull()
    expect(estimateTimeToReady({ current: 20, target: NaN, cutoff: CUTOFF })).toBeNull()
  })

  it('clamps long estimates to the max cap', () => {
    const eta = estimateTimeToReady({
      current: 20,
      target: TARGET,
      cutoff: CUTOFF,
      maxSeconds: 120,
    })
    expect(eta).toBe(120)
  })

  it('honours a custom cold-start calibration', () => {
    const eta = estimateTimeToReady({
      current: 20,
      target: TARGET,
      cutoff: CUTOFF,
      coldStartSeconds: 240,
    })
    expect(eta!).toBeCloseTo(240, 0)
  })
})
