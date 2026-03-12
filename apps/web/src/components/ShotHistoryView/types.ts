import type { ShotInfo, ShotData } from '@/hooks/useShotHistory'

// Re-export for convenience
export type { ShotInfo, ShotData }

// Analysis result types (local analysis)
export interface ExitTrigger {
  type: string
  value: number
  comparison: string
  description: string
}

export interface ExitTriggerResult {
  triggered: {
    type: string
    target: number
    actual: number
    description: string
  } | null
  not_triggered: {
    type: string
    target: number
    actual: number
    description: string
  }[]
}

export interface LimitHit {
  type: string
  limit_value: number
  actual_value: number
  description: string
}

export interface StageExecutionData {
  duration: number
  weight_gain: number
  start_weight: number
  end_weight: number
  start_pressure: number
  end_pressure: number
  avg_pressure: number
  max_pressure: number
  min_pressure: number
  start_flow: number
  end_flow: number
  avg_flow: number
  max_flow: number
  description?: string
}

export interface StageAssessment {
  status: 'reached_goal' | 'hit_limit' | 'not_reached' | 'failed' | 'incomplete' | 'executed'
  message: string
}

export interface StageAnalysisLocal {
  stage_name: string
  stage_key: string
  stage_type: string
  profile_target: string
  exit_triggers: ExitTrigger[]
  limits: { type: string; value: number; description: string }[]
  executed: boolean
  execution_data: StageExecutionData | null
  exit_trigger_result: ExitTriggerResult | null
  limit_hit: LimitHit | null
  assessment: StageAssessment | null
}

export interface WeightAnalysisLocal {
  status: 'on_target' | 'under' | 'over'
  target: number | null
  actual: number
  deviation_percent: number
}

export interface PreinfusionIssue {
  type: string
  severity: 'warning' | 'concern'
  message: string
  detail: string
}

export interface PreinfusionSummary {
  stages: string[]
  total_time: number
  proportion_of_shot: number
  weight_accumulated: number
  weight_percent_of_total: number
  issues: PreinfusionIssue[]
  recommendations: string[]
}

export interface ShotSummary {
  final_weight: number
  target_weight: number | null
  total_time: number
  max_pressure: number
  max_flow: number
}

export interface ProfileInfo {
  name: string
  temperature: number | null
  stage_count: number
}

export interface ProfileTargetPoint {
  time: number
  target_pressure?: number
  target_flow?: number
  target_power?: number
  stage_name: string
}

export interface LocalAnalysisResult {
  shot_summary: ShotSummary
  weight_analysis: WeightAnalysisLocal
  stage_analyses: StageAnalysisLocal[]
  unreached_stages: string[]
  preinfusion_summary: PreinfusionSummary
  profile_info: ProfileInfo
  profile_target_curves?: ProfileTargetPoint[]
}

export interface ChartDataPoint {
  time: number
  pressure?: number
  flow?: number
  weight?: number
  gravimetricFlow?: number
  stage?: string
}

export interface StageRange {
  name: string
  startTime: number
  endTime: number
  colorIndex: number
}

export interface CombinedDataPoint {
  time: number
  pressureA?: number
  flowA?: number
  weightA?: number
  pressureB?: number
  flowB?: number
  weightB?: number
}

// Playback speed options
export const SPEED_OPTIONS: number[] = [0.5, 1, 2, 3, 5]
