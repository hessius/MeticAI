/**
 * Tests for profileAnalysis.ts — parity with Python test_recommendations.py.
 *
 * Uses the same 5 fixture profiles as the Python test suite to verify
 * that the TypeScript port produces identical results.
 */

import { describe, it, expect } from 'vitest'
import {
  extractFingerprint,
  extractNameTags,
  temperatureRange,
  deriveStructuralTags,
  type AnalyzableProfile,
  type ProfileStage,
} from './profileAnalysis'

// ── Helpers (mirrors Python _make_stage / _make_profile) ───────────────────

function makeStage(
  name: string,
  type: string,
  points: number[][],
  limits?: { type: string; value: number }[],
): ProfileStage {
  return {
    name,
    type,
    dynamics: { points, over: 'time', interpolation: 'linear' },
    limits: limits ?? [],
    exit_triggers: [],
  }
}

function makeProfile(
  name: string,
  stages: ProfileStage[] = [],
  temperature = 93.0,
  finalWeight = 36.0,
): AnalyzableProfile {
  return { name, temperature, final_weight: finalWeight, stages }
}

// ── Fixture profiles (same as Python test suite) ───────────────────────────

const PRESSURE_PROFILE = makeProfile(
  'Classic Italian Espresso',
  [
    makeStage('Preinfusion', 'pressure', [[0, 2.0], [5, 4.0]]),
    makeStage('Ramp', 'pressure', [[0, 4.0], [3, 9.0]]),
    makeStage('Extraction', 'pressure', [[0, 9.0], [25, 8.5]]),
  ],
  93.0,
  36.0,
)

const FLOW_PROFILE = makeProfile(
  'Modern Flow Bloom',
  [
    makeStage('Preinfusion', 'flow', [[0, 2.0], [5, 2.0]]),
    makeStage('Bloom', 'flow', [[0, 0.5], [10, 0.5]]),
    makeStage('Main Extraction', 'flow', [[0, 2.5], [20, 2.0]]),
  ],
  90.0,
  40.0,
)

const FLAT_PROFILE = makeProfile(
  'Simple 6 Bar',
  [makeStage('Flat Pressure', 'pressure', [[0, 6.0], [30, 6.0]])],
  93.0,
  36.0,
)

const TURBO_PROFILE = makeProfile(
  'Turbo Shot',
  [makeStage('Turbo', 'flow', [[0, 5.0], [8, 5.0]])],
  96.0,
  20.0,
)

const LEVER_PROFILE = makeProfile(
  'Lever Decline',
  [
    makeStage('Preinfusion', 'pressure', [[0, 2.0], [5, 4.0]]),
    makeStage('Peak', 'pressure', [[0, 9.0], [2, 9.0]]),
    makeStage('Decline', 'pressure', [[0, 9.0], [20, 3.0]]),
  ],
  92.0,
  38.0,
)

// ── extractFingerprint tests ───────────────────────────────────────────────

describe('extractFingerprint', () => {
  it('detects pressure profile control mode and preinfusion', () => {
    const fp = extractFingerprint(PRESSURE_PROFILE)
    expect(fp.controlMode).toBe('pressure')
    expect(fp.hasPreinfusion).toBe(true)
    expect(fp.stageCount).toBe(3)
    expect(fp.peakPressure).toBeGreaterThan(0)
    expect(fp.techniqueTags.has('pressure-profile')).toBe(true)
    expect(fp.techniqueTags.has('preinfusion')).toBe(true)
  })

  it('detects flow profile with bloom', () => {
    const fp = extractFingerprint(FLOW_PROFILE)
    expect(fp.controlMode).toBe('flow')
    expect(fp.hasBloom).toBe(true)
    expect(fp.hasPreinfusion).toBe(true)
    expect(fp.techniqueTags.has('flow-profile')).toBe(true)
    expect(fp.techniqueTags.has('bloom')).toBe(true)
  })

  it('detects flat profile', () => {
    const fp = extractFingerprint(FLAT_PROFILE)
    expect(fp.isFlat).toBe(true)
    expect(fp.stageCount).toBe(1)
    expect(fp.techniqueTags.has('flat')).toBe(true)
  })

  it('detects turbo profile attributes', () => {
    const fp = extractFingerprint(TURBO_PROFILE)
    expect(fp.controlMode).toBe('flow')
    expect(fp.temperature).toBe(96.0)
    expect(fp.finalWeight).toBe(20.0)
  })

  it('detects lever with decline', () => {
    const fp = extractFingerprint(LEVER_PROFILE)
    expect(fp.hasPreinfusion).toBe(true)
    expect(fp.techniqueTags.has('decline')).toBe(true)
    expect(fp.peakPressure).toBeGreaterThanOrEqual(9.0)
  })

  it('handles empty stages', () => {
    const profile = makeProfile('Empty', [])
    const fp = extractFingerprint(profile)
    expect(fp.stageCount).toBe(0)
    expect(fp.controlMode).toBe('unknown')
    expect(fp.peakPressure).toBe(0)
  })

  it('detects pulse from many stages', () => {
    const stages = Array.from({ length: 6 }, (_, i) =>
      makeStage(`Step ${i}`, 'pressure', [[0, 3], [1, 6]])
    )
    const profile = makeProfile('Pulse Profile', stages)
    const fp = extractFingerprint(profile)
    expect(fp.hasPulse).toBe(true)
    expect(fp.techniqueTags.has('pulse')).toBe(true)
  })

  it('handles missing dynamics gracefully', () => {
    const stage: ProfileStage = { name: 'Bare', type: 'pressure' }
    const profile = makeProfile('Bare', [stage])
    const fp = extractFingerprint(profile)
    expect(fp.stageCount).toBe(1)
    expect(fp.controlMode).toBe('pressure')
  })

  it('extracts peak pressure from limits', () => {
    const stage = makeStage(
      'Limited',
      'flow',
      [[0, 2.0], [10, 2.0]],
      [{ type: 'pressure', value: 7.5 }],
    )
    const profile = makeProfile('LimitTest', [stage])
    const fp = extractFingerprint(profile)
    expect(fp.peakPressure).toBe(7.5)
  })

  it('detects non-flat profile from varying dynamics', () => {
    const stage = makeStage('Ramp', 'pressure', [[0, 3.0], [10, 9.0]])
    const profile = makeProfile('Rampy', [stage])
    const fp = extractFingerprint(profile)
    expect(fp.isFlat).toBe(false)
  })

  it('detects ramp and taper keywords', () => {
    const stages = [
      makeStage('Ramp Up', 'pressure', [[0, 3], [5, 9]]),
      makeStage('Taper Down', 'pressure', [[0, 9], [20, 3]]),
    ]
    const profile = makeProfile('Test', stages)
    const fp = extractFingerprint(profile)
    expect(fp.techniqueTags.has('ramp')).toBe(true)
    expect(fp.techniqueTags.has('taper')).toBe(true)
  })

  it('preserves temperature and final_weight', () => {
    const fp = extractFingerprint(PRESSURE_PROFILE)
    expect(fp.temperature).toBe(93.0)
    expect(fp.finalWeight).toBe(36.0)
  })

  it('handles null temperature and final_weight', () => {
    const profile: AnalyzableProfile = { name: 'Bare', stages: [] }
    const fp = extractFingerprint(profile)
    expect(fp.temperature).toBeNull()
    expect(fp.finalWeight).toBeNull()
  })

  it('detects mixed control mode', () => {
    const stages = [
      makeStage('Pressure Phase', 'pressure', [[0, 4], [5, 9]]),
      makeStage('Flow Phase', 'flow', [[0, 2], [10, 2]]),
    ]
    const profile = makeProfile('Mixed', stages)
    const fp = extractFingerprint(profile)
    expect(fp.controlMode).toBe('mixed')
    expect(fp.techniqueTags.has('mixed-profile')).toBe(true)
  })

  it('detects soak as bloom', () => {
    const stages = [makeStage('Soak Phase', 'flow', [[0, 0.5], [10, 0.5]])]
    const profile = makeProfile('Soak Test', stages)
    const fp = extractFingerprint(profile)
    expect(fp.hasBloom).toBe(true)
    expect(fp.techniqueTags.has('bloom')).toBe(true)
  })
})

// ── extractNameTags tests ──────────────────────────────────────────────────

describe('extractNameTags', () => {
  it('extracts keywords from profile name', () => {
    const profile = makeProfile('Fruity Bloom Light', [])
    const tags = extractNameTags(profile)
    expect(tags.has('fruity')).toBe(true)
    expect(tags.has('bloom')).toBe(true)
    expect(tags.has('light')).toBe(true)
  })

  it('extracts keywords from stage names', () => {
    const stages = [makeStage('Preinfusion', 'pressure', [[0, 3], [5, 6]])]
    const profile = makeProfile('Test', stages)
    const tags = extractNameTags(profile)
    expect(tags.has('preinfusion')).toBe(true)
  })

  it('returns empty set for unmatched names', () => {
    const profile = makeProfile('Standard', [])
    const tags = extractNameTags(profile)
    expect(tags.size).toBe(0)
  })

  it('is case-insensitive', () => {
    const profile = makeProfile('CHOCOLATE LEVER RISTRETTO', [])
    const tags = extractNameTags(profile)
    expect(tags.has('chocolate')).toBe(true)
    expect(tags.has('lever')).toBe(true)
    expect(tags.has('ristretto')).toBe(true)
  })

  it('extracts multiple stage keywords', () => {
    const stages = [
      makeStage('Pre-infusion', 'pressure', [[0, 2], [5, 4]]),
      makeStage('Bloom Soak', 'flow', [[0, 0.5], [10, 0.5]]),
      makeStage('Extraction Hold', 'pressure', [[0, 9], [20, 9]]),
    ]
    const profile = makeProfile('Test', stages)
    const tags = extractNameTags(profile)
    expect(tags.has('pre-infusion')).toBe(true)
    expect(tags.has('bloom')).toBe(true)
    expect(tags.has('soak')).toBe(true)
    expect(tags.has('extraction')).toBe(true)
    expect(tags.has('hold')).toBe(true)
  })
})

// ── temperatureRange tests ─────────────────────────────────────────────────

describe('temperatureRange', () => {
  it('maps < 82 to very low', () => {
    expect(temperatureRange(80)).toBe('Very low temp (<82°C)')
    expect(temperatureRange(81.9)).toBe('Very low temp (<82°C)')
  })

  it('maps 82–84 to low', () => {
    expect(temperatureRange(82)).toBe('Low temp (82–84°C)')
    expect(temperatureRange(84)).toBe('Low temp (82–84°C)')
  })

  it('maps 85–87 to warm', () => {
    expect(temperatureRange(85)).toBe('Warm (85–87°C)')
    expect(temperatureRange(87)).toBe('Warm (85–87°C)')
  })

  it('maps 88–90 to medium', () => {
    expect(temperatureRange(88)).toBe('Medium temp (88–90°C)')
    expect(temperatureRange(90)).toBe('Medium temp (88–90°C)')
  })

  it('maps 91–93 to high', () => {
    expect(temperatureRange(91)).toBe('High temp (91–93°C)')
    expect(temperatureRange(93)).toBe('High temp (91–93°C)')
  })

  it('maps 94+ to very high', () => {
    expect(temperatureRange(94)).toBe('Very high temp (94°C+)')
    expect(temperatureRange(100)).toBe('Very high temp (94°C+)')
  })
})

// ── deriveStructuralTags tests ────────────────────────────────────────────

describe('deriveStructuralTags', () => {
  it('derives pressure-controlled + pre-infusion + temperature for pressure profile', () => {
    const tags = deriveStructuralTags(PRESSURE_PROFILE)
    expect(tags).toContain('Pressure-controlled')
    expect(tags).toContain('Pre-infusion')
    expect(tags).toContain('Ramp')
    expect(tags).toContain('High temp (91–93°C)')
  })

  it('derives flow-controlled + bloom + pre-infusion for flow profile', () => {
    const tags = deriveStructuralTags(FLOW_PROFILE)
    expect(tags).toContain('Flow-controlled')
    expect(tags).toContain('Bloom')
    expect(tags).toContain('Pre-infusion')
    expect(tags).toContain('Medium temp (88–90°C)')
  })

  it('derives flat profile + pressure-controlled for flat profile', () => {
    const tags = deriveStructuralTags(FLAT_PROFILE)
    expect(tags).toContain('Flat profile')
    expect(tags).toContain('Pressure-controlled')
    expect(tags).toContain('High temp (91–93°C)')
  })

  it('derives turbo + flow-controlled + very high temp for turbo profile', () => {
    const tags = deriveStructuralTags(TURBO_PROFILE)
    expect(tags).toContain('Turbo')
    expect(tags).toContain('Flow-controlled')
    expect(tags).toContain('Very high temp (94°C+)')
  })

  it('derives decline + pressure-controlled for lever profile', () => {
    const tags = deriveStructuralTags(LEVER_PROFILE)
    expect(tags).toContain('Decline')
    expect(tags).toContain('Pressure-controlled')
    expect(tags).toContain('Pre-infusion')
    expect(tags).toContain('High temp (91–93°C)')
    // Note: "Lever" is in profile NAME (extractNameTags), not stage names (extractFingerprint)
  })

  it('returns only flat + temperature for empty profile (no stages, no temperature)', () => {
    const profile: AnalyzableProfile = { name: 'Empty', stages: [] }
    const tags = deriveStructuralTags(profile)
    // 0 stages: isFlat stays true (initial value), no temperature
    expect(tags).toEqual(['Flat profile'])
  })

  it('includes flat + temperature tag when profile has no stages but has temperature', () => {
    const profile: AnalyzableProfile = { name: 'Bare', stages: [], temperature: 90 }
    const tags = deriveStructuralTags(profile)
    expect(tags).toEqual(['Flat profile', 'Medium temp (88–90°C)'])
  })

  it('returns sorted array', () => {
    const tags = deriveStructuralTags(PRESSURE_PROFILE)
    const sorted = [...tags].sort()
    expect(tags).toEqual(sorted)
  })

  it('produces no duplicate tags', () => {
    const tags = deriveStructuralTags(LEVER_PROFILE)
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('derives mixed-controlled for mixed profile', () => {
    const stages = [
      makeStage('Pressure Phase', 'pressure', [[0, 4], [5, 9]]),
      makeStage('Flow Phase', 'flow', [[0, 2], [10, 2]]),
    ]
    const profile = makeProfile('Mixed', stages, 88)
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Mixed-controlled')
    expect(tags).toContain('Medium temp (88–90°C)')
  })

  it('derives pulse for many-stage profile', () => {
    const stages = Array.from({ length: 6 }, (_, i) =>
      makeStage(`Step ${i}`, 'pressure', [[0, 3], [1, 6]])
    )
    const profile = makeProfile('Pulse Test', stages, 92)
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Pulse')
    expect(tags).toContain('Pressure-controlled')
  })
})

// Re-export fixtures for use in recommendation tests
export {
  makeStage,
  makeProfile,
  PRESSURE_PROFILE,
  FLOW_PROFILE,
  FLAT_PROFILE,
  TURBO_PROFILE,
  LEVER_PROFILE,
}
