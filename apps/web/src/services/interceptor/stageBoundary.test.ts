import { describe, expect, it } from 'vitest'
import { computeRichLocalAnalysis } from './DirectModeInterceptor'

// The Meticulous machine flips a telemetry sample's status to the next stage on
// the control tick where the current stage's exit condition becomes true, so the
// sample that satisfies a rising pressure/flow trigger is labeled as the FIRST
// sample of the next stage. Boundary-aware exit evaluation must credit the stage
// for that transition value instead of falsely reporting "failed".

type Sample = [status: string, pressure: number, flow: number, weight: number]

function buildEntry(samples: Sample[], stages: unknown[]) {
  let t = 0
  const data = samples.map(([status, pressure, flow, weight]) => {
    const point = { status, time: t, profile_time: t, shot: { pressure, flow, weight } }
    t += 130
    return point
  })
  return {
    id: 'shot-1',
    data,
    profile: { name: 'Test', stages, variables: [], final_weight: 36 },
  } as unknown as Parameters<typeof computeRichLocalAnalysis>[0]
}

type StageAnalysis = {
  stage_name: string
  assessment: { status: string; message: string }
  exit_trigger_result: { triggered: { type: string; target: number; actual: number } | null; not_triggered: unknown[] } | null
}

function stageOf(analysis: ReturnType<typeof computeRichLocalAnalysis>, name: string): StageAnalysis {
  const list = (analysis as { stage_analyses: StageAnalysis[] }).stage_analyses
  return list.find(s => s.stage_name === name)!
}

describe('computeRichLocalAnalysis boundary-aware exit triggers', () => {
  it('does not mark a stage failed when its pressure target is reached at the transition', () => {
    const samples: Sample[] = [
      ...([0.2, 0.5, 0.9, 1.3, 1.7, 2.0, 2.2].map(p => ['Fill', p, 7.5, 0] as Sample)),
      ...([3.1, 3.4, 2.0, 1.5, 1.2].map(p => ['Bloom', p, 1.0, 0.5] as Sample)),
    ]
    const analysis = computeRichLocalAnalysis(
      buildEntry(samples, [
        { name: 'Fill', type: 'flow', exit_triggers: [{ type: 'pressure', value: 3, comparison: '>=' }], limits: [], dynamics: { points: [[0, 8.1]] } },
        { name: 'Bloom', type: 'pressure', exit_triggers: [], limits: [], dynamics: { points: [[0, 3]] } },
      ]),
      'Test',
    )
    const fill = stageOf(analysis, 'Fill')
    expect(fill.assessment.status).toBe('reached_goal')
    const triggered = fill.exit_trigger_result?.triggered
    expect(triggered).toBeTruthy()
    expect(triggered!.actual).toBeGreaterThanOrEqual(3.0)
  })

  it('still reports failed when neither the stage nor the transition reaches the target', () => {
    const samples: Sample[] = [
      ...([0.2, 0.5, 0.9, 1.3, 1.7].map(p => ['Fill', p, 7.5, 0] as Sample)),
      ...([1.9, 1.8, 1.5].map(p => ['Bloom', p, 1.0, 0.5] as Sample)),
    ]
    const analysis = computeRichLocalAnalysis(
      buildEntry(samples, [
        { name: 'Fill', type: 'flow', exit_triggers: [{ type: 'pressure', value: 3, comparison: '>=' }], limits: [], dynamics: { points: [[0, 8.1]] } },
        { name: 'Bloom', type: 'pressure', exit_triggers: [], limits: [], dynamics: { points: [[0, 3]] } },
      ]),
      'Test',
    )
    expect(stageOf(analysis, 'Fill').assessment.status).toBe('failed')
  })
})
