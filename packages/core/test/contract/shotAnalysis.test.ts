import { describe, expect, it } from 'vitest'
import { computeRichLocalAnalysis, type HistEntry } from '../../src/logic/shotAnalysis'

describe('computeRichLocalAnalysis', () => {
  const representativeEntry: HistEntry = {
    id: 'shot-1',
    time: 1710000000,
    name: 'Bloom Ramp',
    profile: {
      name: 'Bloom Ramp',
      final_weight: 36,
      temperature: 93,
      variables: [
        { key: 'pre_flow', name: 'Pre Flow', type: 'flow', value: 1.2 },
        { key: 'peak_pressure', name: 'Peak Pressure', type: 'pressure', value: 9 },
      ],
      stages: [
        {
          name: 'Bloom Soak',
          type: 'flow',
          dynamics: { points: [[0, '$pre_flow'], [4, '$pre_flow']], over: 'time' },
          exit_triggers: [{ type: 'weight', value: 2, comparison: '>=' }],
          limits: [{ type: 'pressure', value: 2 }],
        },
        {
          name: 'Extraction',
          type: 'pressure',
          dynamics: { points: [[0, 6], [5, '$peak_pressure']], over: 'time' },
          exit_triggers: [{ type: 'weight', value: 36, comparison: '>=' }],
          limits: [{ type: 'flow', value: 3 }],
        },
        {
          name: 'Taper',
          type: 'pressure',
          dynamics: { points: [[0, 9], [5, 6]], over: 'time' },
          exit_triggers: [{ type: 'time', value: 5, comparison: '>=' }],
        },
      ],
    },
    data: [
      { time: 0, profile_time: 0, status: 'Bloom Soak', shot: { pressure: 0.5, flow: 0, weight: 0 } },
      { time: 2000, profile_time: 2000, status: 'Bloom Soak', shot: { pressure: 1.1, flow: 1.0, weight: 1 } },
      { time: 4000, profile_time: 4000, status: 'Bloom Soak', shot: { pressure: 2.0, flow: 1.4, weight: 2 } },
      { time: 5000, profile_time: 5000, status: 'Extraction', shot: { pressure: 6, flow: 2.4, weight: 5 } },
      { time: 10000, profile_time: 10000, status: 'Extraction', shot: { pressure: 8, flow: 2.0, weight: 20 } },
      { time: 15000, profile_time: 15000, status: 'Extraction', shot: { pressure: 9, flow: 1.8, weight: 36 } },
      { time: 17000, profile_time: 17000, status: 'retracting', shot: { pressure: 0, flow: 0, weight: 36.4 } },
    ],
  }

  it('computes shot summary, weight status, preinfusion summary, and unreached stages', () => {
    const analysis = computeRichLocalAnalysis(representativeEntry, 'Bloom Ramp')

    expect(analysis.shot_summary).toEqual({
      final_weight: 36.4,
      target_weight: 36,
      total_time: 17,
      max_pressure: 9,
      max_flow: 2.4,
    })
    expect(analysis.weight_analysis).toEqual({
      status: 'on_target',
      target: 36,
      actual: 36.4,
      deviation_percent: 1.1,
    })
    expect(analysis.preinfusion_summary).toMatchObject({
      stages: ['Bloom Soak'],
      total_time: 4,
      proportion_of_shot: 23.5,
      weight_accumulated: 2,
      weight_percent_of_total: 5.5,
    })
    expect(analysis.unreached_stages).toEqual(['Taper'])
    expect(analysis.profile_info).toEqual({ name: 'Bloom Ramp', temperature: 93, stage_count: 3 })
  })

  it('computes stage analyses, exit triggers, target curves, and shot facts', () => {
    const analysis = computeRichLocalAnalysis(representativeEntry, 'Bloom Ramp')

    expect(analysis.stage_analyses[0]).toMatchObject({
      stage_name: 'Bloom Soak',
      stage_key: 'bloom_soak',
      stage_type: 'flow',
      profile_target: 'Constant flow at 1.2 ml/s for 4s',
      profile_target_value: 1.2,
      profile_max_target: 1.2,
      exit_triggers: [{ type: 'weight', value: 2, comparison: '>=', description: 'weight ≥ 2g' }],
      limits: [{ type: 'pressure', value: 2, description: 'Limit pressure to 2bar' }],
      executed: true,
      execution_data: {
        duration: 4,
        weight_gain: 2,
        start_weight: 0,
        end_weight: 2,
        start_pressure: 0.5,
        end_pressure: 2,
        avg_pressure: 1.2,
        max_pressure: 2,
        min_pressure: 0.5,
        start_flow: 0,
        end_flow: 1.4,
        avg_flow: 1.4,
        max_flow: 1.4,
        description: 'Pressure rose from 0.5 to 2 bar, Flow increased from 0 to 1.4 ml/s, extracted 2g, over 4s',
      },
      exit_trigger_result: { triggered: { type: 'weight', target: 2, actual: 2, description: 'weight >= 2g' }, not_triggered: [] },
      limit_hit: { type: 'pressure', limit_value: 2, actual_value: 2, description: 'Hit pressure limit of 2bar' },
      assessment: { status: 'hit_limit', message: 'Stage exited but hit a limit (Hit pressure limit of 2bar)' },
    })
    expect(analysis.stage_analyses[1].profile_target).toBe('Pressure ramp up from 6 to 9 bar over 5s')
    expect(analysis.stage_analyses[1].execution_data).toMatchObject({ duration: 10, weight_gain: 31, avg_pressure: 7.7, avg_flow: 2.1 })
    expect(analysis.stage_analyses[2]).toMatchObject({ executed: false, assessment: { status: 'not_reached' } })
    expect(analysis.profile_target_curves).toEqual([
      { time: 0, stage_name: 'Bloom Soak', target_flow: 1.2 },
      { time: 4, stage_name: 'Bloom Soak', target_flow: 1.2 },
      { time: 5, stage_name: 'Extraction', target_pressure: 6 },
      { time: 10, stage_name: 'Extraction', target_pressure: 9 },
      { time: 15, stage_name: 'Extraction', target_pressure: 9 },
    ])
    expect(analysis.shot_facts.stages).toHaveLength(3)
    expect(analysis.shot_facts.stages[0]).toMatchObject({ reached: true, control_mode: 'flow', trigger_type: 'weight' })
  })

  it('handles weight-based target curves and under-target shots', () => {
    const entry: HistEntry = {
      id: 'shot-2',
      time: 1710000001,
      name: 'Weight Curve',
      profile: {
        name: 'Weight Curve',
        final_weight: 30,
        stages: [{
          name: 'Pour',
          type: 'flow',
          dynamics: { points: [[0, 1.5], [10, 2.5], [20, 1.0]], over: 'weight' },
          exit_triggers: [{ type: 'time', value: 12, comparison: '>=' }],
        }],
      },
      data: [
        { time: 0, profile_time: 0, status: 'Pour', shot: { pressure: 1, flow: 1, weight: 0 } },
        { time: 5000, profile_time: 5000, status: 'Pour', shot: { pressure: 2, flow: 2, weight: 10 } },
        { time: 10000, profile_time: 10000, status: 'Pour', shot: { pressure: 2, flow: 1.5, weight: 20 } },
      ],
    }

    const analysis = computeRichLocalAnalysis(entry, 'Weight Curve')

    expect(analysis.shot_summary).toMatchObject({ final_weight: 20, target_weight: 30, total_time: 10, max_flow: 2 })
    expect(analysis.weight_analysis).toMatchObject({ status: 'under', actual: 20, deviation_percent: -33.3 })
    expect(analysis.stage_analyses[0].profile_target).toBe('Flow curve: 1.5 → 2.5 → 1 ml/s')
    expect(analysis.profile_target_curves).toEqual([
      { time: 0, stage_name: 'Pour', target_flow: 1.5 },
      { time: 5, stage_name: 'Pour', target_flow: 2.5 },
      { time: 10, stage_name: 'Pour', target_flow: 1 },
    ])
  })
})
