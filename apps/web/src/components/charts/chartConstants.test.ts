import { describe, it, expect } from 'vitest'
import {
  computeLeftAxisMax,
  AXIS_MAX_PRESSURE,
  AXIS_MAX_FLOW,
} from './chartConstants'

describe('computeLeftAxisMax', () => {
  it('keeps historical behaviour for normal pressure/flow values', () => {
    // ceil(max(9, 7) * 1.1) = ceil(9.9) = 10
    expect(computeLeftAxisMax(9, 7)).toBe(10)
    // ceil(max(12, 8) * 1.1) = ceil(13.2) = 14
    expect(computeLeftAxisMax(12, 8)).toBe(14)
  })

  it('clamps a flow spike so it cannot dominate the shared axis', () => {
    // Without clamping, a 45 ml/s flow spike would give ceil(45 * 1.1) = 50,
    // squashing a 9 bar pressure curve to ~18% of the chart height.
    const withSpike = computeLeftAxisMax(9, 45)
    const cap = Math.ceil(AXIS_MAX_FLOW * 1.1)
    expect(withSpike).toBe(cap)
    expect(withSpike).toBeLessThan(20)
    // Pressure now occupies a healthy share of the height.
    expect(9 / withSpike).toBeGreaterThan(0.4)
  })

  it('clamps an anomalous pressure spike too', () => {
    const withSpike = computeLeftAxisMax(40, 8)
    expect(withSpike).toBe(Math.ceil(AXIS_MAX_PRESSURE * 1.1))
  })

  it('does not clip legitimate near-ceiling readings', () => {
    // A real high-pressure shot just below the cap is unaffected.
    expect(computeLeftAxisMax(12, 9)).toBe(Math.ceil(12 * 1.1))
  })
})
