import { describe, it, expect } from 'vitest'
import { classifyTrigger, detectStall, detectChanneling, buildShotFacts, effectiveControlMode } from './shotFacts'

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

describe('effectiveControlMode (#423)', () => {
  it('aggressive flow with a pressure limit is effectively pressure', () => {
    // Slayer "Extraction": flow 10.8 ml/s capped by a 6 bar pressure limit.
    expect(effectiveControlMode({
      stage_type: 'flow', profile_max_target: 10.8,
      limits: [{ type: 'pressure', value: 6 }],
    })).toBe('pressure')
  })
  it('gentle flow with a pressure limit stays flow', () => {
    // Slayer "PreBrew": flow 1.2 ml/s + 1.8 bar limit — genuinely flow-led.
    expect(effectiveControlMode({
      stage_type: 'flow', profile_max_target: 1.2,
      limits: [{ type: 'pressure', value: 1.8 }],
    })).toBe('flow')
  })
  it('pressure with a restricted flow limit is effectively flow', () => {
    expect(effectiveControlMode({
      stage_type: 'pressure', profile_max_target: 9,
      limits: [{ type: 'flow', value: 2.5 }],
    })).toBe('flow')
  })
  it('pressure with a loose flow limit stays pressure', () => {
    // Damian "Fill": pressure 2 bar + 8 ml/s limit — limit isn't restrictive.
    expect(effectiveControlMode({
      stage_type: 'pressure', profile_max_target: 2,
      limits: [{ type: 'flow', value: 8 }],
    })).toBe('pressure')
  })
  it('power stage is power', () => {
    expect(effectiveControlMode({ stage_type: 'power' })).toBe('power')
  })
  it('buildShotFacts exposes effective + declared mode and override flag', () => {
    const facts = buildShotFacts({
      stage_analyses: [{
        stage_name: 'Extraction', stage_type: 'flow', profile_max_target: 10.8,
        limits: [{ type: 'pressure', value: 6 }],
        exit_triggers: [{ type: 'pressure' }],
        exit_trigger_result: { triggered: { type: 'pressure' } },
        execution_data: { duration: 25, weight_gain: 20, end_weight: 36, start_pressure: 1, end_pressure: 6, avg_pressure: 6, max_pressure: 6.5, min_pressure: 1, start_flow: 10, end_flow: 2, avg_flow: 4, max_flow: 10 },
      }],
    })
    const stage = facts.stages[0]
    expect(stage.control_mode).toBe('pressure')
    expect(stage.declared_mode).toBe('flow')
    expect(stage.mode_overridden).toBe(true)
    expect(stage.trigger_class?.kind).toBe('targeted')
  })
})

describe('puck-failure detection (#423)', () => {
  // Slayer-style: declared flow, high flow target capped by a 6 bar pressure
  // limit ⇒ effective pressure, ending on a near-final weight trigger.
  const pressureGovernedStage = (maxPressure: number, weightTarget = 36) => ({
    stage_name: 'Extraction', stage_type: 'flow', profile_max_target: 10.8,
    limits: [{ type: 'pressure', value: 6 }],
    exit_triggers: [{ type: 'weight' }],
    exit_trigger_result: { triggered: { type: 'weight', target: weightTarget } },
    execution_data: { duration: 25, weight_gain: 30, end_weight: 36, start_pressure: 1, end_pressure: 3, avg_pressure: 2.5, max_pressure: maxPressure, min_pressure: 1, start_flow: 10, end_flow: 8, avg_flow: 9, max_flow: 10 },
  })

  it('flags puck failure when yield is hit but pressure never built', () => {
    const facts = buildShotFacts({ weight_analysis: { target: 36 }, stage_analyses: [pressureGovernedStage(3.0)] })
    const tc = facts.stages[0].trigger_class
    expect(tc?.kind).toBe('failsafe')
    expect(tc?.label.toLowerCase()).toContain('puck failure')
  })

  it('normal completion when yield is hit on-target', () => {
    const facts = buildShotFacts({ weight_analysis: { target: 36 }, stage_analyses: [pressureGovernedStage(6.2)] })
    const tc = facts.stages[0].trigger_class
    expect(tc?.kind).toBe('targeted')
    expect(tc?.label.toLowerCase()).not.toContain('puck failure')
  })

  it('never flags puck failure on a flow-governed volumetric pour', () => {
    const facts = buildShotFacts({
      weight_analysis: { target: 36 },
      stage_analyses: [{
        stage_name: 'Pour', stage_type: 'flow', profile_max_target: 2, limits: [],
        exit_triggers: [{ type: 'weight' }],
        exit_trigger_result: { triggered: { type: 'weight', target: 36 } },
        execution_data: { duration: 25, weight_gain: 30, end_weight: 36, start_pressure: 1, end_pressure: 2, avg_pressure: 2, max_pressure: 2, min_pressure: 1, start_flow: 2, end_flow: 2, avg_flow: 2, max_flow: 2 },
      }],
    })
    const tc = facts.stages[0].trigger_class
    expect(tc?.kind).toBe('targeted')
    expect(tc?.label.toLowerCase()).not.toContain('puck failure')
  })

  it('intermediate weight milestone is a first-drip check', () => {
    const facts = buildShotFacts({ weight_analysis: { target: 36 }, stage_analyses: [pressureGovernedStage(3.0, 4)] })
    const tc = facts.stages[0].trigger_class
    expect(tc?.kind).toBe('targeted')
    expect(tc?.label.toLowerCase()).toContain('first-drip')
  })

  it('classifyTrigger weight is backward compatible without context', () => {
    const r = classifyTrigger('pressure', 'weight', 1)
    expect(r.kind).toBe('targeted')
    expect(r.label.toLowerCase()).toContain('yield')
  })
})
