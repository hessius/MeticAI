/**
 * Deterministic shot-fact derivation (#423 + diagnostic signals).
 * TS parity of apps/server/services/shot_facts.py — keep thresholds identical.
 */

// Threshold constants — keep identical to shot_facts.py
export const STALL_MIN_WEIGHT_GAIN_G = 0.5
export const CHANNELING_PRESSURE_DROP_BAR = 1.5
export const CHANNELING_FLOW_RISE_MLS = 1.5
// #423 effective-mode thresholds (from the superseding issue comment):
export const EFFECTIVE_FLOW_TARGET_MIN = 6.0
export const EFFECTIVE_FLOW_LIMIT_MAX = 3.0

export type TriggerKind = 'targeted' | 'failsafe' | 'unknown'
export interface TriggerClass { kind: TriggerKind; label: string; reason: string }
export interface StallResult { stalled: boolean; weight_gain: number }
export interface ChannelingResult { channeling: boolean; pressure_drop: number; flow_rise: number }

interface ExecutionData {
  duration?: number; weight_gain?: number; end_weight?: number
  start_pressure?: number; end_pressure?: number; avg_pressure?: number; max_pressure?: number; min_pressure?: number
  start_flow?: number; end_flow?: number; avg_flow?: number; max_flow?: number
}
interface StageAnalysis {
  stage_name?: string; stage_type?: string; type?: string
  exit_triggers?: Array<{ type?: string }>
  exit_trigger_result?: { triggered?: { type?: string } | null } | null
  execution_data?: ExecutionData | null
  profile_target?: { target_value?: number } | unknown
  profile_target_value?: number | null
  profile_max_target?: number | null
  limits?: Array<{ type?: string; value?: number }>
}
export interface ShotFactStage {
  stage_name?: string
  reached: boolean
  control_mode?: string
  declared_mode?: string
  mode_overridden?: boolean
  trigger_type?: string
  trigger_class?: TriggerClass
  stall?: StallResult
  channeling?: ChannelingResult
  curve_adherence?: { target: number; measured: number; delta: number } | null
}
export interface ShotFacts {
  stages: ShotFactStage[]
  phases: Array<{ stage_name?: string; phase: string; avg_pressure?: number; avg_flow?: number; weight_gain?: number }>
  weight: { actual?: number; target?: number; deviation_pct?: number }
  total_time_s?: number
}

const n = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : 0)
const r2 = (v: number): number => Math.round(v * 100) / 100

export function classifyTrigger(stageControlMode: string, triggerType: string, totalTriggers: number): TriggerClass {
  if (triggerType === 'weight') {
    return { kind: 'targeted', label: 'Targeted (yield reached)', reason: 'Weight is the ultimate goal of the shot.' }
  }
  if (triggerType === 'time') {
    return totalTriggers === 1
      ? { kind: 'targeted', label: 'Targeted (planned duration)', reason: 'Time is the only trigger, so this is an intentional timed stage.' }
      : { kind: 'failsafe', label: 'Failsafe (timeout limit)', reason: 'Stage hit its time backstop before another target was reached.' }
  }
  if ((stageControlMode === 'flow' || stageControlMode === 'power') && triggerType === 'pressure') {
    return { kind: 'targeted', label: 'Targeted (puck resistance achieved)', reason: 'Flow-controlled stage reached its intended pressure.' }
  }
  if (stageControlMode === 'pressure' && triggerType === 'flow') {
    return totalTriggers === 1
      ? { kind: 'targeted', label: 'Targeted (planned flow transition)', reason: 'Flow is the only trigger, so the transition is intentional.' }
      : { kind: 'failsafe', label: 'Failsafe (caught channeling or choking)', reason: 'Pressure-controlled stage exited on a flow backstop.' }
  }
  if (stageControlMode === 'pressure' && triggerType === 'pressure') {
    return { kind: 'targeted', label: 'Targeted (pressure threshold reached)', reason: 'Pressure-controlled stage reached its target pressure.' }
  }
  return { kind: 'unknown', label: 'Unknown', reason: 'Trigger/control-mode combination is not classified.' }
}

function resolveStageControlMode(stage: StageAnalysis): string {
  const t = (stage.stage_type ?? stage.type ?? '').toLowerCase()
  if (t.includes('flow')) return 'flow'
  if (t.includes('pressure')) return 'pressure'
  if (t.includes('power')) return 'power'
  return 'unknown'
}

function limitValue(stage: StageAnalysis, limitType: string): number | null {
  const lim = (stage.limits ?? []).find(l => l.type === limitType)
  if (!lim || typeof lim.value !== 'number' || Number.isNaN(lim.value)) return null
  return lim.value
}

/**
 * Determine a stage's *effective* control mode, correcting for #423 cases where
 * the declared type does not reflect the true intent.
 *
 *   1. Aggressive flow (peak target ≥ 6 ml/s) with a pressure limit ⇒ effectively
 *      pressure-controlled (the pressure limit governs).
 *   2. A pressure stage with a highly restricted flow limit (≤ 3 ml/s) ⇒
 *      effectively flow-controlled (can't build pressure).
 *   3. Power stages are raw mechanical drive.
 *
 * Falls back to the declared control mode when no override applies. Mirror of
 * shot_facts.effective_control_mode — keep the two in sync.
 */
export function effectiveControlMode(stage: StageAnalysis): string {
  const declared = resolveStageControlMode(stage)
  if (declared === 'power') return 'power'
  const maxTarget = typeof stage.profile_max_target === 'number' ? stage.profile_max_target : null
  const pressureLimit = limitValue(stage, 'pressure')
  const flowLimit = limitValue(stage, 'flow')
  if (declared === 'flow' && maxTarget != null && maxTarget >= EFFECTIVE_FLOW_TARGET_MIN && pressureLimit != null) {
    return 'pressure'
  }
  if (declared === 'pressure' && flowLimit != null && flowLimit <= EFFECTIVE_FLOW_LIMIT_MAX) {
    return 'flow'
  }
  return declared
}

export function detectStall(stage: StageAnalysis): StallResult {
  const trigType = stage.exit_trigger_result?.triggered?.type ?? ''
  const total = (stage.exit_triggers ?? []).length
  const gain = n(stage.execution_data?.weight_gain)
  const klass = classifyTrigger(effectiveControlMode(stage), trigType, total)
  const stalled = klass.kind === 'failsafe' && trigType === 'time' && gain < STALL_MIN_WEIGHT_GAIN_G
  return { stalled, weight_gain: r2(gain) }
}

export function detectChanneling(ed: ExecutionData): ChannelingResult {
  const pDrop = n(ed.start_pressure) - n(ed.end_pressure)
  const fRise = n(ed.end_flow) - n(ed.start_flow)
  return {
    channeling: pDrop >= CHANNELING_PRESSURE_DROP_BAR && fRise >= CHANNELING_FLOW_RISE_MLS,
    pressure_drop: r2(pDrop),
    flow_rise: r2(fRise),
  }
}

function buildPhases(stages: StageAnalysis[]): ShotFacts['phases'] {
  return stages
    .filter(s => s.execution_data)
    .map(s => {
      const ed = s.execution_data as ExecutionData
      const avgP = n(ed.avg_pressure)
      let phase: string
      if (avgP < 3.0) phase = 'pre-infusion'
      else if (n(ed.end_pressure) > n(ed.start_pressure)) phase = 'ramp'
      else if (n(ed.end_pressure) < n(ed.start_pressure)) phase = 'decline'
      else phase = 'peak'
      return { stage_name: s.stage_name, phase, avg_pressure: ed.avg_pressure, avg_flow: ed.avg_flow, weight_gain: ed.weight_gain }
    })
}

function curveAdherence(stage: StageAnalysis): ShotFactStage['curve_adherence'] {
  const target = typeof stage.profile_target_value === 'number' ? stage.profile_target_value : null
  if (target == null) return null
  const mode = resolveStageControlMode(stage)
  const measured = mode === 'pressure' ? stage.execution_data?.avg_pressure : stage.execution_data?.avg_flow
  if (measured == null) return null
  return { target, measured, delta: r2(measured - target) }
}

export function buildShotFacts(analysis: {
  stage_analyses?: StageAnalysis[]
  weight_analysis?: { actual?: number; target?: number; deviation_percent?: number }
  shot_summary?: { total_time?: number }
  overall_metrics?: { total_time?: number }
}): ShotFacts {
  const stages = analysis.stage_analyses ?? []
  const stagesOut: ShotFactStage[] = stages.map(s => {
    if (!s.execution_data) return { stage_name: s.stage_name, reached: false }
    const trigType = s.exit_trigger_result?.triggered?.type ?? ''
    const total = (s.exit_triggers ?? []).length
    const declaredMode = resolveStageControlMode(s)
    const effectiveMode = effectiveControlMode(s)
    return {
      stage_name: s.stage_name,
      reached: true,
      control_mode: effectiveMode,
      declared_mode: declaredMode,
      mode_overridden: effectiveMode !== declaredMode,
      trigger_type: trigType,
      trigger_class: classifyTrigger(effectiveMode, trigType, total),
      stall: detectStall(s),
      channeling: detectChanneling(s.execution_data),
      curve_adherence: curveAdherence(s),
    }
  })
  const wa = analysis.weight_analysis ?? {}
  return {
    stages: stagesOut,
    phases: buildPhases(stages),
    weight: { actual: wa.actual, target: wa.target, deviation_pct: wa.deviation_percent },
    total_time_s: analysis.shot_summary?.total_time ?? analysis.overall_metrics?.total_time,
  }
}
