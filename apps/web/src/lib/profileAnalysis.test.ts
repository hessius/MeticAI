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
  weightRange,
  pressureRange,
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
    expect(tags).toContain('Normale (36–44g)')
    expect(tags).toContain('Standard pressure (8–9 bar)')
  })

  it('derives flow-controlled + bloom + pre-infusion for flow profile', () => {
    const tags = deriveStructuralTags(FLOW_PROFILE)
    expect(tags).toContain('Flow-controlled')
    expect(tags).toContain('Bloom')
    expect(tags).toContain('Pre-infusion')
    expect(tags).toContain('Medium temp (88–90°C)')
    expect(tags).toContain('Normale (36–44g)')
  })

  it('derives flat profile + pressure-controlled for flat profile', () => {
    const tags = deriveStructuralTags(FLAT_PROFILE)
    expect(tags).toContain('Flat profile')
    expect(tags).toContain('Pressure-controlled')
    expect(tags).toContain('High temp (91–93°C)')
    expect(tags).toContain('Normale (36–44g)')
    expect(tags).toContain('Medium pressure (5–7 bar)')
  })

  it('derives turbo + flow-controlled + very high temp for turbo profile', () => {
    const tags = deriveStructuralTags(TURBO_PROFILE)
    expect(tags).toContain('Turbo')
    expect(tags).toContain('Flow-controlled')
    expect(tags).toContain('Very high temp (94°C+)')
    expect(tags).toContain('Ristretto (≤35g)')
  })

  it('derives decline + pressure-controlled for lever profile', () => {
    const tags = deriveStructuralTags(LEVER_PROFILE)
    expect(tags).toContain('Decline')
    expect(tags).toContain('Pressure-controlled')
    expect(tags).toContain('Pre-infusion')
    expect(tags).toContain('High temp (91–93°C)')
    expect(tags).toContain('Normale (36–44g)')
    expect(tags).toContain('Standard pressure (8–9 bar)')
  })

  it('returns only flat tag for explicitly empty stages array (no temperature)', () => {
    const profile: AnalyzableProfile = { name: 'Empty', stages: [] }
    const tags = deriveStructuralTags(profile)
    expect(tags).toEqual(['Flat profile'])
  })

  it('includes flat + temperature + weight tag when stages is empty array', () => {
    const profile: AnalyzableProfile = { name: 'Bare', stages: [], temperature: 90, final_weight: 40 }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Flat profile')
    expect(tags).toContain('Medium temp (88–90°C)')
    expect(tags).toContain('Normale (36–44g)')
  })

  it('returns empty tags when stages is undefined and no data (partial profile)', () => {
    const profile: AnalyzableProfile = { name: 'Partial' }
    const tags = deriveStructuralTags(profile)
    expect(tags).toEqual([])
  })

  it('returns temp + weight tags for partial profile', () => {
    const profile: AnalyzableProfile = { name: 'Partial', temperature: 94, final_weight: 50 }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Very high temp (94°C+)')
    expect(tags).toContain('Lungo (45–54g)')
  })

  it('name-based bloom fallback for partial profile', () => {
    const profile: AnalyzableProfile = { name: 'Ramp Bloom Special', temperature: 90 }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Bloom')
    expect(tags).toContain('Medium temp (88–90°C)')
  })

  it('name-based pre-infusion fallback for partial profile', () => {
    const profile: AnalyzableProfile = { name: 'Slow Preinfusion for High Extraction', temperature: 90 }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Pre-infusion')
  })

  it('name-based soak fallback for partial profile', () => {
    const profile: AnalyzableProfile = { name: 'Long Soak Profile' }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Bloom')
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

  // ── Structural bloom detection ──
  it('detects bloom from zero-flow stage with time exit', () => {
    const bloomStage: ProfileStage = {
      name: 'Stage 1',
      type: 'flow',
      dynamics: { points: [[0, 0.0], [300, 0.0]], over: 'time', interpolation: 'linear' },
      exit_triggers: [{ type: 'time', value: 300, relative: true, comparison: '>=' }],
    }
    const extractionStage = makeStage('Stage 2', 'flow', [[0, 2.5], [20, 2.0]])
    const profile = makeProfile('No Bloom In Name', [bloomStage, extractionStage], 90)
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Bloom')
  })

  it('detects bloom from low-power stage with time exit', () => {
    const bloomStage: ProfileStage = {
      name: 'Stage 1',
      type: 'power',
      dynamics: { points: [[0, 0], [30, 0]], over: 'time', interpolation: 'linear' },
      exit_triggers: [{ type: 'time', value: 30, relative: true, comparison: '>=' }],
    }
    const extractionStage = makeStage('Stage 2', 'pressure', [[0, 6], [20, 6]])
    const profile = makeProfile('No Bloom Name', [bloomStage, extractionStage], 88)
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Bloom')
  })

  // ── Structural pre-infusion detection ──
  it('detects pre-infusion from power-type first stage', () => {
    const fillStage: ProfileStage = {
      name: 'Fill',
      type: 'power',
      dynamics: { points: [[0, 100]], over: 'time', interpolation: 'linear' },
      exit_triggers: [{ type: 'pressure', value: 1.0, relative: false, comparison: '>=' }],
    }
    const extractionStage = makeStage('Extract', 'pressure', [[0, 9], [20, 9]])
    const profile = makeProfile('No PI Name', [fillStage, extractionStage], 88)
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Pre-infusion')
  })

  it('detects pre-infusion from low-pressure first stage', () => {
    const piStage = makeStage('Stage 1', 'pressure', [[0, 2], [5, 3]])
    const mainStage = makeStage('Stage 2', 'pressure', [[0, 9], [20, 8]])
    const profile = makeProfile('No PI Name', [piStage, mainStage], 90)
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Pre-infusion')
  })

  it('detects pre-infusion from low-flow first stage', () => {
    const piStage = makeStage('Stage 1', 'flow', [[0, 1.5], [5, 1.5]])
    const mainStage = makeStage('Stage 2', 'pressure', [[0, 9], [20, 8]])
    const profile = makeProfile('No PI Name', [piStage, mainStage], 90)
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Pre-infusion')
  })

  it('does not detect pre-infusion when first stage has high pressure', () => {
    const mainStage = makeStage('Stage 1', 'pressure', [[0, 9], [20, 8]])
    const secondStage = makeStage('Stage 2', 'pressure', [[0, 6], [10, 6]])
    const profile = makeProfile('High Start', [mainStage, secondStage], 90)
    const tags = deriveStructuralTags(profile)
    expect(tags).not.toContain('Pre-infusion')
  })

  // ── Adaptive detection ──
  it('detects adaptive tag from $variable in dynamics', () => {
    const adaptiveStage: ProfileStage = {
      name: 'Hold',
      type: 'flow',
      dynamics: { points: [[0, '$flow_Hold_Rate']], over: 'time', interpolation: 'curve' },
    }
    const profile: AnalyzableProfile = {
      name: 'Adaptive Test',
      stages: [adaptiveStage],
      temperature: 88,
    }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Adaptive')
  })

  it('detects adaptive tag from $variable in limits', () => {
    const stage: ProfileStage = {
      name: 'Ramp',
      type: 'flow',
      dynamics: { points: [[0, 8], [20, 8]], over: 'time', interpolation: 'curve' },
      limits: [{ type: 'pressure', value: '$pressure_Peak' }],
    }
    const profile: AnalyzableProfile = { name: 'Var Limit', stages: [stage], temperature: 88 }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Adaptive')
  })

  it('detects adaptive tag from $variable in exit_triggers', () => {
    const stage: ProfileStage = {
      name: 'Fill',
      type: 'power',
      dynamics: { points: [[0, 100]], over: 'time', interpolation: 'linear' },
      exit_triggers: [{ type: 'pressure', value: '$pressure_1', relative: false, comparison: '>=' }],
    }
    const secondStage = makeStage('Extract', 'pressure', [[0, 9], [20, 9]])
    const profile: AnalyzableProfile = { name: 'Var Exit', stages: [stage, secondStage], temperature: 84 }
    const tags = deriveStructuralTags(profile)
    expect(tags).toContain('Adaptive')
    expect(tags).toContain('Pre-infusion')
  })

  it('does not detect adaptive for profiles without $variables', () => {
    const tags = deriveStructuralTags(PRESSURE_PROFILE)
    expect(tags).not.toContain('Adaptive')
  })
})

// ── weightRange tests ─────────────────────────────────────────────────────

describe('weightRange', () => {
  it('maps ≤35g to Ristretto', () => {
    expect(weightRange(20)).toBe('Ristretto (≤35g)')
    expect(weightRange(35)).toBe('Ristretto (≤35g)')
  })

  it('maps 36-44g to Normale', () => {
    expect(weightRange(36)).toBe('Normale (36–44g)')
    expect(weightRange(44)).toBe('Normale (36–44g)')
  })

  it('maps 45-54g to Lungo', () => {
    expect(weightRange(45)).toBe('Lungo (45–54g)')
    expect(weightRange(54)).toBe('Lungo (45–54g)')
  })

  it('maps 55g+ to Allongé', () => {
    expect(weightRange(55)).toBe('Allongé (55g+)')
    expect(weightRange(100)).toBe('Allongé (55g+)')
    expect(weightRange(300)).toBe('Allongé (55g+)')
  })
})

// ── pressureRange tests ───────────────────────────────────────────────────

describe('pressureRange', () => {
  it('maps ≤4 bar to Low', () => {
    expect(pressureRange(2)).toBe('Low pressure (≤4 bar)')
    expect(pressureRange(4)).toBe('Low pressure (≤4 bar)')
  })

  it('maps 5-7 bar to Medium', () => {
    expect(pressureRange(5)).toBe('Medium pressure (5–7 bar)')
    expect(pressureRange(7)).toBe('Medium pressure (5–7 bar)')
  })

  it('maps 8-9 bar to Standard', () => {
    expect(pressureRange(8)).toBe('Standard pressure (8–9 bar)')
    expect(pressureRange(9)).toBe('Standard pressure (8–9 bar)')
  })

  it('maps 10+ bar to High', () => {
    expect(pressureRange(10)).toBe('High pressure (10+ bar)')
    expect(pressureRange(12)).toBe('High pressure (10+ bar)')
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
