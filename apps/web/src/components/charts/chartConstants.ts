/**
 * Shared chart constants — colors, stage theming, and axis styles
 * used by ShotHistoryView, LiveShotView, and EspressoChart.
 */

// ---------------------------------------------------------------------------
// Data line colors
// ---------------------------------------------------------------------------

export const CHART_COLORS = {
  pressure: '#4ade80',        // Green
  flow: '#67e8f9',            // Light cyan/blue
  weight: '#fbbf24',          // Amber/Yellow
  gravimetricFlow: '#c2855a', // Brown-orange
  targetPressure: '#86efac',  // Lighter green (dashed)
  targetFlow: '#a5f3fc',      // Lighter cyan (dashed)
} as const

export const COMPARISON_COLORS = {
  pressure: '#4ade80',
  flow: '#67e8f9',
  weight: '#fbbf24',
} as const

// ---------------------------------------------------------------------------
// Stage background / pill colors (up to 8 stages)
// ---------------------------------------------------------------------------

export const STAGE_COLORS = [
  'rgba(239, 68, 68, 0.25)',   // Red
  'rgba(249, 115, 22, 0.25)',  // Orange
  'rgba(234, 179, 8, 0.25)',   // Yellow
  'rgba(34, 197, 94, 0.25)',   // Green
  'rgba(59, 130, 246, 0.25)',  // Blue
  'rgba(168, 85, 247, 0.25)',  // Purple
  'rgba(236, 72, 153, 0.25)',  // Pink
  'rgba(20, 184, 166, 0.25)',  // Teal
]

export const STAGE_BORDER_COLORS = [
  'rgba(239, 68, 68, 0.5)',
  'rgba(249, 115, 22, 0.5)',
  'rgba(234, 179, 8, 0.5)',
  'rgba(34, 197, 94, 0.5)',
  'rgba(59, 130, 246, 0.5)',
  'rgba(168, 85, 247, 0.5)',
  'rgba(236, 72, 153, 0.5)',
  'rgba(20, 184, 166, 0.5)',
]

export const STAGE_TEXT_COLORS_LIGHT = [
  'rgb(153, 27, 27)',    // Red-800
  'rgb(154, 52, 18)',    // Orange-800
  'rgb(133, 77, 14)',    // Yellow-800
  'rgb(22, 101, 52)',    // Green-800
  'rgb(30, 64, 175)',    // Blue-800
  'rgb(107, 33, 168)',   // Purple-800
  'rgb(157, 23, 77)',    // Pink-800
  'rgb(17, 94, 89)',     // Teal-800
]

export const STAGE_TEXT_COLORS_DARK = [
  'rgb(252, 165, 165)',  // Red-300
  'rgb(253, 186, 116)',  // Orange-300
  'rgb(253, 224, 71)',   // Yellow-300
  'rgb(134, 239, 172)',  // Green-300
  'rgb(147, 197, 253)',  // Blue-300
  'rgb(216, 180, 254)',  // Purple-300
  'rgb(249, 168, 212)',  // Pink-300
  'rgb(94, 234, 212)',   // Teal-300
]

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export const SPEED_OPTIONS: number[] = [0.5, 1, 2, 3, 5]

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

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

export interface ProfileTargetPoint {
  time: number
  target_pressure?: number
  target_flow?: number
  stage_name: string
}

export interface TooltipPayloadItem {
  name: string
  value: number
  color: string
  dataKey: string
  payload?: ChartDataPoint
}

// ---------------------------------------------------------------------------
// Theme-aware chart axis/grid styling
// ---------------------------------------------------------------------------

export interface ChartTheme {
  gridColor: string
  gridOpacity: number
  axisStroke: string
  axisLineStroke: string
  tickFill: string
  replayLineStroke: string
}

export function getChartTheme(isDark: boolean): ChartTheme {
  return {
    gridColor: isDark ? '#333' : '#d4d4d8',
    gridOpacity: isDark ? 0.3 : 0.5,
    axisStroke: isDark ? '#666' : '#a1a1aa',
    axisLineStroke: isDark ? '#444' : '#d4d4d8',
    tickFill: isDark ? '#888' : '#71717a',
    replayLineStroke: isDark ? '#fff' : '#18181b',
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract StageRange[] from chart data points that carry a `stage` field.
 */
export function extractStageRanges(data: ChartDataPoint[]): StageRange[] {
  const stages: StageRange[] = []
  let currentStage: string | null = null
  let stageColorIndex = 0

  for (const point of data) {
    if (point.stage && point.stage !== currentStage) {
      if (stages.length > 0) {
        stages[stages.length - 1].endTime = point.time
      }
      stages.push({
        name: point.stage,
        startTime: point.time,
        endTime: point.time,
        colorIndex: stageColorIndex % STAGE_COLORS.length,
      })
      currentStage = point.stage
      stageColorIndex++
    } else if (point.stage === currentStage && stages.length > 0) {
      stages[stages.length - 1].endTime = point.time
    }
  }

  return stages
}
