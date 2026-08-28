import { describe, expect, it } from 'vitest'
import {
  isActionableRecommendation,
  isRecommendationPatchable,
  parseRecommendationsJson,
  termMatches,
} from '../../src/logic/recommendationsParse'

describe('parseRecommendationsJson', () => {
  it('parses a valid recommendations block and filters non-actionable records', () => {
    const text = `Analysis text

RECOMMENDATIONS_JSON:
[
  {"variable":"temperature","current_value":93,"recommended_value":94,"stage":"global"},
  {"variable":"","current_value":1,"recommended_value":2,"stage":"global"},
  {"variable":"flow","current_value":"NaN","recommended_value":2,"stage":"Pour"},
  "not a record"
]
END_RECOMMENDATIONS_JSON`

    expect(parseRecommendationsJson(text)).toEqual([
      { variable: 'temperature', current_value: 93, recommended_value: 94, stage: 'global' },
    ])
  })

  it('returns an empty array when the block is missing', () => {
    expect(parseRecommendationsJson('plain analysis')).toEqual([])
  })

  it('returns an empty array when JSON is malformed', () => {
    const text = `RECOMMENDATIONS_JSON:
[{"variable":"temperature",]
END_RECOMMENDATIONS_JSON`

    expect(parseRecommendationsJson(text)).toEqual([])
  })
})

describe('isActionableRecommendation', () => {
  it('rejects an empty variable', () => {
    expect(isActionableRecommendation({ variable: '   ', current_value: 1, recommended_value: 2 })).toBe(false)
  })

  it('rejects non-finite current and recommended values', () => {
    expect(isActionableRecommendation({ variable: 'temperature', current_value: 'NaN', recommended_value: 94 })).toBe(false)
    expect(isActionableRecommendation({ variable: 'temperature', current_value: 93, recommended_value: Infinity })).toBe(false)
  })

  it('keeps recommendations with missing numeric values', () => {
    expect(isActionableRecommendation({ variable: 'temperature' })).toBe(true)
  })
})

describe('isRecommendationPatchable', () => {
  const variables = [
    { key: 'pressure_Max Pressure', name: 'Max Pressure', adjustable: true },
    { key: 'info_roast', name: 'Roast', adjustable: true },
    { key: 'flow_Static', name: 'Static Flow', adjustable: false },
  ]

  it('allows global temperature and final weight recommendations', () => {
    expect(isRecommendationPatchable({ variable: 'temperature', stage: 'global' }, variables)).toBe(true)
    expect(isRecommendationPatchable({ variable: 'final_weight', stage: 'global' }, variables)).toBe(true)
  })

  it('allows exit and limit variables on non-global stages', () => {
    expect(isRecommendationPatchable({ variable: 'exit_weight', stage: 'Extraction' }, variables)).toBe(true)
    expect(isRecommendationPatchable({ variable: 'limit_flow', stage: 'Extraction' }, variables)).toBe(true)
  })

  it('rejects info variables and adjustable false variables', () => {
    expect(isRecommendationPatchable({ variable: 'info_roast', stage: 'global' }, variables)).toBe(false)
    expect(isRecommendationPatchable({ variable: 'flow_Static', stage: 'Pour' }, variables)).toBe(false)
  })

  it('allows unknown variables and term-matched adjustable variables', () => {
    expect(isRecommendationPatchable({ variable: 'unknown_variable', stage: 'Pour' }, variables)).toBe(true)
    expect(isRecommendationPatchable({ variable: 'Max Pressure', stage: 'Pour' }, variables)).toBe(true)
  })
})

describe('termMatches', () => {
  it('matches normalized terms in either direction', () => {
    expect(termMatches('Max Pressure', 'pressure_Max Pressure')).toBe(true)
    expect(termMatches('pressure_Max Pressure', 'Max Pressure')).toBe(true)
  })

  it('does not match empty or unrelated terms', () => {
    expect(termMatches('', 'pressure')).toBe(false)
    expect(termMatches('temperature', 'flow')).toBe(false)
  })
})
