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

describe('buildAnalyzeLlmPrompt (compact / on-device)', () => {
  const bigVars = Array.from({ length: 12 }, (_, i) => ({
    name: `Variable ${i}`, key: `var_${i}`, type: 'pressure', value: i,
  }))
  const bigStages = Array.from({ length: 6 }, (_, i) => ({
    name: `Stage ${i}`, type: 'pressure', key: `stage_${i}`,
    dynamics_points: [[0, 9], [3, 6]], dynamics_over: 'time',
    exit_triggers: [{ type: 'weight', value: 36, comparison: '>=' }],
    limits: [{ type: 'flow', value: 5 }],
  }))
  const base = {
    profileName: 'Test', temperature: 93, targetWeight: 36, profileDescription: 'desc',
    profileVars: bigVars, cleanStages: bigStages, facts, tasteContext: '',
  }

  it('is materially smaller than the full prompt', () => {
    const full = buildAnalyzeLlmPrompt(base)
    const compact = buildAnalyzeLlmPrompt({ ...base, compact: true })
    expect(compact.length).toBeLessThan(full.length * 0.6)
  })

  it('fits a ~4096-token window with headroom for output', () => {
    // ~4 chars/token: keep the compacted input well under the window so the
    // model has room to generate the full analysis without overflowing.
    const compact = buildAnalyzeLlmPrompt({ ...base, compact: true })
    expect(compact.length).toBeLessThan(12_000)
  })

  it('drops the heavy knowledge blocks and worked example', () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true })
    expect(p).not.toContain('ESPRESSO PROFILING GUIDE')
    expect(p).not.toContain('Worked Example')
    expect(p).not.toContain('EXIT TRIGGER CLASSIFICATION')
  })

  it('preserves the output contract the parser needs', () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true })
    expect(p).toContain('## 1. Shot Performance')
    expect(p).toContain('## 2. Root Cause Analysis')
    expect(p).toContain('## 3. Setup Recommendations')
    expect(p).toContain('## 4. Profile Recommendations')
    expect(p).toContain('## 5. Profile Design Observations')
    expect(p).toContain('**Assessment:**')
    expect(p).toContain('RECOMMENDATIONS_JSON:')
    expect(p).toContain('END_RECOMMENDATIONS_JSON')
  })

  it('keeps the authoritative fact sheet and profile identity', () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true })
    expect(p).toContain('Shot Facts')
    expect(p).toContain('Test')
  })

  it('serialises profile JSON without pretty-printing (no indented newlines)', () => {
    const p = buildAnalyzeLlmPrompt({ ...base, compact: true })
    // Compact JSON contains the keys inline, not on their own indented lines.
    expect(p).toContain('"key":"var_0"')
  })

  it('still includes taste context when provided', () => {
    const p = buildAnalyzeLlmPrompt({
      ...base, compact: true, tasteContext: '## Taste Goal\nLess sour.',
    })
    expect(p).toContain('Taste Goal')
  })
})
