import { describe, it, expect } from 'vitest'
import { buildAnalyzeLlmPrompt } from './analyzeLlmPrompt'
import { computeRichLocalAnalysis } from './DirectModeInterceptor'
import { buildShotFacts } from '../../lib/shotFacts'
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

  it('includes expert profiling knowledge AND analysis framework (parity with server)', () => {
    const p = buildAnalyzeLlmPrompt({
      profileName: 'Test', temperature: 93, targetWeight: 36, profileDescription: 'desc',
      profileVars: [], cleanStages: [], facts, tasteContext: '',
    })
    expect(p).toContain('ESPRESSO PROFILING GUIDE')
    expect(p).toContain('EXIT TRIGGER CLASSIFICATION')
  })

  it('populates the fact sheet from a rich local analysis (guards the empty-facts bug)', () => {
    // Realistic entry: a pressure-controlled stage with a weight exit trigger that fires.
    const entry = {
      id: 's1', time: Date.now(), name: 'Test Shot',
      profile: {
        name: 'Test Profile', final_weight: 36, temperature: 93,
        stages: [
          {
            name: 'Extraction', type: 'pressure', key: 'extraction',
            dynamics: { points: [[0, 9]], over: 'time' },
            exit_triggers: [{ type: 'weight', value: 36, comparison: '>=' }],
            limits: [],
          },
        ],
        variables: [],
      },
      data: [
        { status: 'Extraction', time: 0, profile_time: 0, shot: { pressure: 8.5, flow: 2.0, weight: 0 } },
        { status: 'Extraction', time: 5000, profile_time: 5000, shot: { pressure: 9.0, flow: 2.1, weight: 12 } },
        { status: 'Extraction', time: 15000, profile_time: 15000, shot: { pressure: 9.0, flow: 2.0, weight: 30 } },
        { status: 'Extraction', time: 28000, profile_time: 28000, shot: { pressure: 9.0, flow: 1.8, weight: 36 } },
      ],
    }
    const richAnalysis = computeRichLocalAnalysis(entry, 'Test Profile')
    const populatedFacts = buildShotFacts(richAnalysis as Parameters<typeof buildShotFacts>[0])
    const p = buildAnalyzeLlmPrompt({
      profileName: 'Test Profile', temperature: 93, targetWeight: 36, profileDescription: 'desc',
      profileVars: [], cleanStages: [], facts: populatedFacts, tasteContext: '',
    })
    // Fact sheet must reference the real stage and its targeted exit — not just an empty header.
    expect(p).toContain('Extraction')
    expect(p).toContain('Targeted')
  })
})
