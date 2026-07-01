import { describe, it, expect } from 'vitest'
import { classifyTrigger, detectStall, detectChanneling, buildShotFacts } from './shotFacts'

describe('classifyTrigger (#423)', () => {
  it('weight is always targeted', () => {
    expect(classifyTrigger('pressure', 'weight', 2).kind).toBe('targeted')
  })
  it('time-only trigger is planned duration', () => {
    expect(classifyTrigger('flow', 'time', 1).kind).toBe('targeted')
  })
  it('time with other triggers is failsafe timeout', () => {
    const r = classifyTrigger('flow', 'time', 2)
    expect(r.kind).toBe('failsafe')
    expect(r.label.toLowerCase()).toContain('timeout')
  })
  it('flow control + pressure trigger is puck resistance', () => {
    expect(classifyTrigger('flow', 'pressure', 2).kind).toBe('targeted')
  })
  it('pressure control + flow-only trigger is planned transition', () => {
    expect(classifyTrigger('pressure', 'flow', 1).kind).toBe('targeted')
  })
  it('pressure control + flow with others is failsafe channeling', () => {
    expect(classifyTrigger('pressure', 'flow', 2).kind).toBe('failsafe')
  })
  it('pressure control + pressure trigger is threshold', () => {
    expect(classifyTrigger('pressure', 'pressure', 1).kind).toBe('targeted')
  })
  it('unknown combo returns unknown', () => {
    expect(classifyTrigger('power', 'weird', 1).kind).toBe('unknown')
  })
})

describe('detectStall / detectChanneling', () => {
  const ed = {
    duration: 10, weight_gain: 2, end_weight: 8,
    start_pressure: 1, end_pressure: 6, avg_pressure: 4, max_pressure: 6.5, min_pressure: 1,
    start_flow: 4, end_flow: 0.5, avg_flow: 2, max_flow: 4.5,
  }
  it('flags stall on time failsafe with low gain', () => {
    const stage = {
      stage_type: 'pressure',
      exit_triggers: [{ type: 'flow' }, { type: 'time' }],
      exit_trigger_result: { triggered: { type: 'time' } },
      execution_data: { ...ed, weight_gain: 0.3 },
    }
    expect(detectStall(stage).stalled).toBe(true)
  })
  it('no stall when weight trigger', () => {
    const stage = { stage_type: 'flow', exit_triggers: [{ type: 'weight' }], exit_trigger_result: { triggered: { type: 'weight' } }, execution_data: ed }
    expect(detectStall(stage).stalled).toBe(false)
  })
  it('flags channeling on pressure drop with flow rise', () => {
    expect(detectChanneling({ ...ed, start_pressure: 8, end_pressure: 3, start_flow: 1, end_flow: 5 }).channeling).toBe(true)
  })
  it('no channeling on stable stage', () => {
    expect(detectChanneling({ ...ed, start_pressure: 6, end_pressure: 6.2, start_flow: 2, end_flow: 2.1 }).channeling).toBe(false)
  })
})

describe('buildShotFacts', () => {
  it('classifies each stage and reads total time from shot_summary', () => {
    const analysis = {
      shot_summary: { total_time: 30 },
      weight_analysis: { actual: 36, target: 36, deviation_percent: 0 },
      stage_analyses: [{
        stage_name: 'Infusion', stage_type: 'pressure',
        exit_triggers: [{ type: 'weight' }],
        exit_trigger_result: { triggered: { type: 'weight' } },
        execution_data: { duration: 10, weight_gain: 2, end_weight: 8, start_pressure: 6, end_pressure: 6, avg_pressure: 6, max_pressure: 6, min_pressure: 6, start_flow: 2, end_flow: 2, avg_flow: 2, max_flow: 2 },
      }],
    }
    const facts = buildShotFacts(analysis)
    expect(facts.stages).toHaveLength(1)
    expect(facts.stages[0].trigger_class?.kind).toBe('targeted')
    expect(facts.total_time_s).toBe(30)
  })

  it('computes curve adherence from profile_target_value', () => {
    const analysis = {
      shot_summary: { total_time: 30 },
      weight_analysis: { actual: 36, target: 36, deviation_percent: 0 },
      stage_analyses: [{
        stage_name: 'Ramp', stage_type: 'pressure', profile_target_value: 9,
        exit_triggers: [{ type: 'pressure' }],
        exit_trigger_result: { triggered: { type: 'pressure' } },
        execution_data: { duration: 10, weight_gain: 2, end_weight: 8, start_pressure: 6, end_pressure: 9, avg_pressure: 8.5, max_pressure: 9, min_pressure: 6, start_flow: 2, end_flow: 2, avg_flow: 2, max_flow: 2 },
      }],
    }
    const ca = buildShotFacts(analysis).stages[0].curve_adherence
    expect(ca).not.toBeNull()
    expect(ca?.target).toBe(9)
    expect(ca?.measured).toBe(8.5)
    expect(ca?.delta).toBe(-0.5)
  })

  it('curve adherence is null without a numeric target', () => {
    const analysis = {
      stage_analyses: [{
        stage_name: 'Ramp', stage_type: 'pressure',
        exit_triggers: [{ type: 'pressure' }],
        exit_trigger_result: { triggered: { type: 'pressure' } },
        execution_data: { duration: 10, weight_gain: 2, end_weight: 8, start_pressure: 6, end_pressure: 9, avg_pressure: 8.5, max_pressure: 9, min_pressure: 6, start_flow: 2, end_flow: 2, avg_flow: 2, max_flow: 2 },
      }],
    }
    expect(buildShotFacts(analysis).stages[0].curve_adherence).toBeNull()
  })
})
