import { describe, it, expect } from 'vitest'
import { estimateTimeToReady, type TempSample } from './estimateTimeToReady'

function syntheticCurve(opts: {
  T0: number
  target: number
  k: number
  dt: number
  count: number
}): TempSample[] {
  const { T0, target, k, dt, count } = opts
  const out: TempSample[] = []
  for (let i = 0; i < count; i++) {
    const t = i * dt
    const temp = target - (target - T0) * Math.exp(-k * t)
    out.push({ t, temp })
  }
  return out
}

describe('estimateTimeToReady', () => {
  it('returns null when there are too few samples', () => {
    const samples: TempSample[] = [
      { t: 0, temp: 20 },
      { t: 1, temp: 30 },
    ]
    expect(
      estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    ).toBeNull()
  })

  it('estimates a sane time-to-cutoff for a rapid-then-slow curve', () => {
    const samples = syntheticCurve({ T0: 20, target: 93, k: 0.05, dt: 2, count: 8 })
    const eta = estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    expect(eta).not.toBeNull()
    expect(eta!).toBeCloseTo(71.81, 1)
  })

  it('keeps a reasonable estimate with deterministic temperature noise', () => {
    const samples = syntheticCurve({ T0: 20, target: 93, k: 0.05, dt: 2, count: 8 })
    const noisySamples = samples.map((sample, i) => ({
      ...sample,
      temp: sample.temp + ((i % 3) - 1) * 0.1,
    }))
    const eta = estimateTimeToReady({ samples: noisySamples, target: 93, cutoff: 92, minSamples: 5 })
    expect(eta).not.toBeNull()
    expect(eta!).toBeGreaterThan(60)
    expect(eta!).toBeLessThan(85)
  })

  it('returns 0 when the current temperature is already at/above the cutoff', () => {
    const samples = syntheticCurve({ T0: 90, target: 93, k: 0.05, dt: 2, count: 8 })
    samples[samples.length - 1] = { t: 14, temp: 92.5 }
    const eta = estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    expect(eta).toBe(0)
  })

  it('clamps absurd estimates to the max cap', () => {
    const samples = syntheticCurve({ T0: 20, target: 93, k: 0.0005, dt: 2, count: 8 })
    const eta = estimateTimeToReady({
      samples, target: 93, cutoff: 92, minSamples: 5, maxSeconds: 600,
    })
    expect(eta).toBe(600)
  })

  it('returns null when the fit is degenerate (no temperature rise)', () => {
    const samples: TempSample[] = Array.from({ length: 8 }, (_, i) => ({
      t: i * 2,
      temp: 50,
    }))
    expect(
      estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    ).toBeNull()
  })
})
