import { describe, it, expect } from 'vitest'
import { ANALYSIS_KNOWLEDGE, buildFactSheet } from '../../src/ai/analysisKnowledge'
import type { ShotFacts } from '../../src/logic/shotFacts'

describe('ANALYSIS_KNOWLEDGE', () => {
  it('covers trigger classes + channeling', () => {
    expect(ANALYSIS_KNOWLEDGE).toContain('Targeted')
    expect(ANALYSIS_KNOWLEDGE).toContain('Failsafe')
    expect(ANALYSIS_KNOWLEDGE.toLowerCase()).toContain('channeling')
  })
})

describe('buildFactSheet', () => {
  const facts: ShotFacts = {
    stages: [
      { stage_name: 'Infusion', reached: true, control_mode: 'pressure', trigger_type: 'weight',
        trigger_class: { kind: 'targeted', label: 'Targeted (yield reached)', reason: '' },
        stall: { stalled: false, weight_gain: 30 },
        channeling: { channeling: false, pressure_drop: 0.1, flow_rise: 0.1 },
        curve_adherence: { target: 9, measured: 8.5, delta: -0.5 } },
      { stage_name: 'Decline', reached: true, control_mode: 'pressure', trigger_type: 'time',
        trigger_class: { kind: 'failsafe', label: 'Failsafe (timeout limit)', reason: '' },
        stall: { stalled: true, weight_gain: 0.2 },
        channeling: { channeling: true, pressure_drop: 3, flow_rise: 2 },
        curve_adherence: null },
    ],
    phases: [],
    weight: { actual: 36, target: 36, deviation_pct: 0 },
    total_time_s: 30,
  }

  it('renders stage classifications and weight', () => {
    const sheet = buildFactSheet(facts)
    expect(sheet).toContain('Infusion')
    expect(sheet).toContain('Targeted (yield reached)')
    expect(sheet).toContain('36')
  })

  it('flags stall and channeling', () => {
    const sheet = buildFactSheet(facts).toLowerCase()
    expect(sheet).toContain('stall')
    expect(sheet).toContain('channel')
  })
})
