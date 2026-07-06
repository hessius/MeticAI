import { describe, expect, it } from 'vitest'
import { convertGeminiToOEPF } from '../../src/logic/oepf'

function variableByKey(profile: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return (profile.variables as Array<Record<string, unknown>>).find((variable) => variable.key === key)
}

function firstStage(profile: Record<string, unknown>): Record<string, unknown> {
  return (profile.stages as Array<Record<string, unknown>>)[0]
}

describe('convertGeminiToOEPF', () => {
  it('keeps adjustable variables with valid OEPF types', () => {
    const pressureVariable = { key: 'bloom_pressure', name: 'Bloom Pressure', type: 'pressure', value: 3 }

    const profile = convertGeminiToOEPF({ variables: [pressureVariable] })

    expect(profile.variables).toEqual([pressureVariable])
  })

  it('converts info variables to info keys with mapped emoji names', () => {
    const profile = convertGeminiToOEPF({
      variables: [
        { key: 'dose', name: 'Dose', type: 'info', value: 18 },
        { key: 'barista_tip', name: 'Barista Tip', type: 'information', value: 1 },
      ],
    })

    expect(variableByKey(profile, 'info_dose')).toMatchObject({
      key: 'info_dose',
      name: '☕ Dose',
      type: 'power',
      value: 18,
    })
    expect(variableByKey(profile, 'info_barista_tip')).toMatchObject({
      key: 'info_barista_tip',
      name: 'ℹ️ Barista Tip',
      type: 'power',
      value: 1,
    })
  })

  it('drops variables with unknown non-info types', () => {
    const profile = convertGeminiToOEPF({
      variables: [
        { key: 'mystery', name: 'Mystery', type: 'temperature', value: 92 },
        { key: 'flow_target', name: 'Flow Target', type: 'flow', value: 2.5 },
      ],
    })

    expect(profile.variables).toEqual([
      { key: 'flow_target', name: 'Flow Target', type: 'flow', value: 2.5 },
    ])
  })

  it('resolves stage variable references to numbers and unknown references to 0', () => {
    const profile = convertGeminiToOEPF({
      variables: [{ key: 'target_weight', name: 'Target Weight', type: 'weight', value: 36 }],
      stages: [
        {
          name: 'Extract',
          type: 'flowRate',
          dynamics: [
            { time: '$missing_time', value: '$target_weight' },
          ],
          exit_triggers: [{ type: 'weight', value: '$target_weight' }],
          limits: [{ type: 'flow', value: '$missing_limit' }],
        },
      ],
    })

    const stage = firstStage(profile)
    expect((stage.dynamics as Record<string, unknown>).points).toEqual([[0, 36]])
    expect(stage.exit_triggers).toEqual([
      { type: 'weight', value: 36, relative: true, comparison: '>=' },
    ])
    expect(stage.limits).toEqual([{ type: 'flow', value: 0 }])
  })

  it('returns the expected top-level OEPF shape with defaults', () => {
    const profile = convertGeminiToOEPF({})

    expect(profile.name).toBe('AI Generated Profile')
    expect(profile.author).toBe('MeticAI')
    expect(profile.temperature).toBe(93)
    expect(profile.final_weight).toBe(36)
    expect(profile.previous_authors).toEqual([])
    expect(profile.display).toEqual({ accentColor: '#6366f1' })
    expect(profile.variables).toEqual([])
    expect(profile.stages).toEqual([])
    expect(typeof profile.id).toBe('string')
    expect(typeof profile.author_id).toBe('string')
    expect(typeof profile.last_changed).toBe('number')
  })

  it('carries stage triggers, limits, and dynamics through with native mappings', () => {
    const profile = convertGeminiToOEPF({
      variables: [{ key: 'end_weight', name: 'End Weight', type: 'weight', value: 40 }],
      stages: [
        {
          name: 'Ramp Up',
          type: 'flow_rate',
          dynamics: {
            points: [
              { time: 0, value: 2 },
              { time: '$end_weight', value: '$end_weight' },
            ],
          },
          exit_triggers: [
            { type: 'dose grams', value: '$end_weight', relative: false, comparator: '>' },
            { type: 'duration', value: 20, comparison: '<=' },
          ],
          limits: [
            { type: 'flowLimit', value: 6 },
            { type: 'temperature', value: '$end_weight', comparator: '<' },
          ],
        },
      ],
    })

    const stage = firstStage(profile)
    expect(stage).toMatchObject({
      name: 'Ramp Up',
      key: 'ramp_up',
      type: 'flow',
    })
    expect(stage.dynamics).toEqual({
      points: [[0, 2], [40, 40]],
      over: 'time',
      interpolation: 'linear',
    })
    expect(stage.exit_triggers).toEqual([
      { type: 'weight', value: 40, relative: false, comparison: '>' },
      { type: 'time', value: 20, relative: true, comparison: '<=' },
    ])
    expect(stage.limits).toEqual([
      { type: 'flow', value: 6 },
      { type: 'pressure', value: 40 },
    ])
  })

  it('resolves object-form dynamics whose points are already [t, v] arrays', () => {
    const profile = convertGeminiToOEPF({
      variables: [
        { key: 'peak_pressure', name: 'Peak Pressure', type: 'pressure', value: 8 },
        { key: 'taper_pressure', name: 'Taper Pressure', type: 'pressure', value: 4 },
        { key: 'extraction_ratio', name: 'Extraction Ratio', type: 'number', value: 2.5 },
      ],
      stages: [
        {
          name: 'Flavor Fade-Out',
          type: 'pressure',
          dynamics: {
            points: [
              [0, '$peak_pressure'],
              ['10000 * ($extraction_ratio / 2.5)', '$taper_pressure'],
            ],
            over: 'time',
            interpolation: 'curve',
          },
        },
      ],
    })

    const stage = firstStage(profile)
    expect(stage.dynamics).toEqual({
      points: [[0, 8], [0, 4]],
      over: 'time',
      interpolation: 'curve',
    })
  })
})
