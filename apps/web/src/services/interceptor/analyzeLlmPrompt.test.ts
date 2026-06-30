import { describe, it, expect } from 'vitest'
import { buildAnalyzeLlmPrompt } from './analyzeLlmPrompt'
import type { ShotFacts } from '../../lib/shotFacts'

const facts: ShotFacts = {
  stages: [{ stage_name: 'Hold', reached: true, control_mode: 'pressure', trigger_type: 'weight',
    trigger_class: { kind: 'targeted', label: 'Targeted (yield reached)', reason: '' },
    stall: { stalled: false, weight_gain: 30 },
    channeling: { channeling: false, pressure_drop: 0, flow_rise: 0 },
    curve_adherence: null }],
  phases: [], weight: { actual: 36, target: 36, deviation_pct: 0 }, total_time_s: 28,
}

describe('buildAnalyzeLlmPrompt', () => {
  it('includes knowledge, fact sheet, few-shot', () => {
    const p = buildAnalyzeLlmPrompt({
      profileName: 'Test', temperature: 93, targetWeight: 36, profileDescription: 'desc',
      profileVars: [], cleanStages: [], facts, tasteContext: '',
    })
    expect(p).toContain('EXIT TRIGGER CLASSIFICATION')
    expect(p).toContain('Deterministic Shot Facts')
    expect(p).toContain('Worked Example')
  })
  it('includes taste section when compass taste provided', () => {
    const p = buildAnalyzeLlmPrompt({
      profileName: 'Test', temperature: 93, targetWeight: 36, profileDescription: 'desc',
      profileVars: [], cleanStages: [], facts,
      tasteContext: '## Taste Goal\nUser wants less sour.',
    })
    expect(p).toContain('Taste Goal')
  })
})
