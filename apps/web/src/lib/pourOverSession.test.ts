import { describe, it, expect, beforeEach } from 'vitest'
import {
  savePourOverSession,
  loadPourOverSession,
  clearPourOverSession,
  type PourOverSessionSnapshot,
} from './pourOverSession'

function snapshot(overrides: Partial<PourOverSessionSnapshot> = {}): PourOverSessionSnapshot {
  return {
    isRunning: true,
    baseElapsedMs: 1200,
    startedAtMs: 5000,
    weightTrend: [{ t: 0, w: 0 }, { t: 1, w: 12, flow: 2.1 }],
    recipeCurrentStep: 1,
    stepTimeOffsetMs: 300,
    machineEndElapsedMs: null,
    previousWeight: 12,
    previousWeightTimestamp: 6000,
    trendStartTimestamp: 4000,
    emaWeight: 11.5,
    prevEmaWeight: 10.9,
    emaFlow: 2.0,
    ...overrides,
  }
}

describe('pourOverSession', () => {
  beforeEach(() => {
    clearPourOverSession()
  })

  it('defaults to null', () => {
    expect(loadPourOverSession()).toBeNull()
  })

  it('persists and restores an in-progress run', () => {
    const s = snapshot()
    savePourOverSession(s)
    expect(loadPourOverSession()).toEqual(s)
  })

  it('overwrites the previous snapshot on subsequent saves', () => {
    savePourOverSession(snapshot({ baseElapsedMs: 1000 }))
    savePourOverSession(snapshot({ baseElapsedMs: 9000 }))
    expect(loadPourOverSession()?.baseElapsedMs).toBe(9000)
  })

  it('clears the saved run', () => {
    savePourOverSession(snapshot())
    clearPourOverSession()
    expect(loadPourOverSession()).toBeNull()
  })
})
