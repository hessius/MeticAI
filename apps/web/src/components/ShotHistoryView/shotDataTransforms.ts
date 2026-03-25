import { format } from 'date-fns'
import { STAGE_COLORS } from '@/components/charts/chartConstants'
import type { ShotData, ChartDataPoint, StageRange, ProfileTargetPoint } from './types'

/**
 * Transform shot data into chart-compatible format.
 * Handles 3 data formats: Meticulous nested shot, parallel arrays, log entries.
 */
export function getChartData(data: ShotData): ChartDataPoint[] {
  const dataEntries = (data.data as unknown as Array<{
    shot?: { pressure?: number; flow?: number; weight?: number; gravimetric_flow?: number };
    time?: number;
    profile_time?: number;
    status?: string;
  }>) || []
  
  if (Array.isArray(dataEntries) && dataEntries.length > 0 && dataEntries[0]?.shot) {
    return dataEntries.map(entry => ({
      time: (entry.time || entry.profile_time || 0) / 1000,
      pressure: entry.shot?.pressure,
      flow: entry.shot?.flow,
      weight: entry.shot?.weight,
      gravimetricFlow: entry.shot?.gravimetric_flow,
      stage: entry.status
    }))
  }
  
  const telemetry = data.data || data
  const timeArray = (telemetry as Record<string, unknown>).time as number[] || []
  const pressureArray = (telemetry as Record<string, unknown>).pressure as number[] || []
  const flowArray = (telemetry as Record<string, unknown>).flow as number[] || []
  const weightArray = (telemetry as Record<string, unknown>).weight as number[] || []
  
  if (Array.isArray(timeArray) && timeArray.length > 0) {
    const chartData: ChartDataPoint[] = []
    for (let i = 0; i < timeArray.length; i++) {
      chartData.push({
        time: timeArray[i],
        pressure: pressureArray[i],
        flow: flowArray[i],
        weight: weightArray[i]
      })
    }
    return chartData
  }
  
  const logEntries = (data as Record<string, unknown>).log as Array<Record<string, number>> || []
  if (logEntries.length > 0) {
    return logEntries.map(entry => ({
      time: entry.time || entry.t || 0,
      pressure: entry.pressure || entry.p,
      flow: entry.flow || entry.f,
      weight: entry.weight || entry.w
    }))
  }
  
  return []
}

/** Extract stage ranges for chart background coloring */
export function getStageRanges(chartData: ChartDataPoint[]): StageRange[] {
  const ranges: StageRange[] = []
  let currentStage: string | null = null
  let stageStart = 0
  let colorIndex = 0
  const stageColorMap = new Map<string, number>()
  
  chartData.forEach((point, index) => {
    if (point.stage && point.stage !== currentStage) {
      if (currentStage !== null) {
        ranges.push({
          name: currentStage,
          startTime: stageStart,
          endTime: point.time,
          colorIndex: stageColorMap.get(currentStage) || 0
        })
      }
      
      currentStage = point.stage
      stageStart = point.time
      
      if (!stageColorMap.has(currentStage)) {
        stageColorMap.set(currentStage, colorIndex % STAGE_COLORS.length)
        colorIndex++
      }
    }
    
    if (index === chartData.length - 1 && currentStage) {
      ranges.push({
        name: currentStage,
        startTime: stageStart,
        endTime: point.time,
        colorIndex: stageColorMap.get(currentStage) || 0
      })
    }
  })
  
  return ranges
}

/** Binary search helper to find upper bound (first element > time) */
function findUpperBound(points: ProfileTargetPoint[], time: number): number {
  let left = 0
  let right = points.length
  
  while (left < right) {
    const mid = left + Math.floor((right - left) / 2)
    if (points[mid].time <= time) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  
  return left
}

/** Merge shot chart data with profile target curves for overlay */
export function mergeWithTargetCurves(
  chartData: ChartDataPoint[], 
  targetCurves: ProfileTargetPoint[] | undefined
): (ChartDataPoint & { targetPressure?: number; targetFlow?: number; targetPower?: number })[] {
  if (!targetCurves || targetCurves.length === 0) {
    return chartData
  }
  
  const pressurePoints = targetCurves
    .filter(c => c.target_pressure !== undefined)
    .sort((a, b) => a.time - b.time)
  
  const flowPoints = targetCurves
    .filter(c => c.target_flow !== undefined)
    .sort((a, b) => a.time - b.time)
  
  const powerPoints = targetCurves
    .filter(c => c.target_power !== undefined)
    .sort((a, b) => a.time - b.time)
  
  return chartData.map(point => {
    let targetPressure: number | undefined
    let targetFlow: number | undefined
    let targetPower: number | undefined
    
    if (pressurePoints.length > 0) {
      const afterIndex = findUpperBound(pressurePoints, point.time)
      
      if (afterIndex === 0) {
        targetPressure = pressurePoints[0].target_pressure
      } else if (afterIndex === pressurePoints.length) {
        targetPressure = pressurePoints[pressurePoints.length - 1].target_pressure
      } else {
        const before = pressurePoints[afterIndex - 1]
        const after = pressurePoints[afterIndex]
        const timeDiff = after.time - before.time
        if (timeDiff === 0) {
          targetPressure = before.target_pressure!
        } else {
          const t = (point.time - before.time) / timeDiff
          targetPressure = before.target_pressure! + t * (after.target_pressure! - before.target_pressure!)
        }
      }
    }
    
    if (flowPoints.length > 0) {
      const afterIndex = findUpperBound(flowPoints, point.time)
      
      if (afterIndex === 0) {
        targetFlow = flowPoints[0].target_flow
      } else if (afterIndex === flowPoints.length) {
        targetFlow = flowPoints[flowPoints.length - 1].target_flow
      } else {
        const before = flowPoints[afterIndex - 1]
        const after = flowPoints[afterIndex]
        const timeDiff = after.time - before.time
        if (timeDiff === 0) {
          targetFlow = before.target_flow!
        } else {
          const t = (point.time - before.time) / timeDiff
          targetFlow = before.target_flow! + t * (after.target_flow! - before.target_flow!)
        }
      }
    }
    
    if (powerPoints.length > 0) {
      const afterIndex = findUpperBound(powerPoints, point.time)
      
      if (afterIndex === 0) {
        targetPower = powerPoints[0].target_power
      } else if (afterIndex === powerPoints.length) {
        targetPower = powerPoints[powerPoints.length - 1].target_power
      } else {
        const before = powerPoints[afterIndex - 1]
        const after = powerPoints[afterIndex]
        const timeDiff = after.time - before.time
        if (timeDiff === 0) {
          targetPower = before.target_power!
        } else {
          const t = (point.time - before.time) / timeDiff
          targetPower = before.target_power! + t * (after.target_power! - before.target_power!)
        }
      }
    }
    
    return { ...point, targetPressure, targetFlow, targetPower }
  })
}

/** Get chart data from a shot in simplified format for comparison */
export function getComparisonChartData(data: ShotData): { time: number; pressure: number; flow: number; weight: number }[] {
  const dataEntries = data.data as unknown
  
  if (Array.isArray(dataEntries) && dataEntries.length > 0 && dataEntries[0]?.shot) {
    return dataEntries.map((entry: { shot?: { pressure?: number; flow?: number; weight?: number }; time?: number; profile_time?: number }) => ({
      time: (entry.time || entry.profile_time || 0) / 1000,
      pressure: entry.shot?.pressure || 0,
      flow: entry.shot?.flow || 0,
      weight: entry.shot?.weight || 0
    }))
  }
  
  const telemetry = (data.data || data) as Record<string, unknown>
  const timeArray = telemetry.time as number[] | undefined
  const pressureArray = telemetry.pressure as number[] | undefined
  const flowArray = telemetry.flow as number[] | undefined
  const weightArray = telemetry.weight as number[] | undefined
  
  if (Array.isArray(timeArray) && timeArray.length > 0) {
    return timeArray.map((t, i) => ({
      time: t,
      pressure: pressureArray?.[i] || 0,
      flow: flowArray?.[i] || 0,
      weight: weightArray?.[i] || 0
    }))
  }
  
  return []
}

/** Build combined chart data for comparison overlay */
export function getCombinedChartData(
  shotData: ShotData,
  comparisonShotData: ShotData | null
): { time: number; pressureA?: number; flowA?: number; weightA?: number; pressureB?: number; flowB?: number; weightB?: number }[] {
  const dataA = getComparisonChartData(shotData)
  
  if (!comparisonShotData) {
    return dataA.map(d => ({
      time: d.time,
      pressureA: d.pressure,
      flowA: d.flow,
      weightA: d.weight,
      pressureB: undefined as number | undefined,
      flowB: undefined as number | undefined,
      weightB: undefined as number | undefined,
    }))
  }
  
  const dataB = getComparisonChartData(comparisonShotData)
  
  const useAAsBase = dataA.length >= dataB.length
  const baseData = useAAsBase ? dataA : dataB
  const otherData = useAAsBase ? dataB : dataA
  
  const findClosestPoint = (time: number, data: typeof dataA) => {
    if (data.length === 0) return null
    if (time < data[0].time || time > data[data.length - 1].time) return null
    
    let left = 0, right = data.length - 1
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (data[mid].time < time) left = mid + 1
      else right = mid
    }
    
    const idx = left
    if (idx === 0 || data[idx].time === time) return data[idx]
    
    const before = data[idx - 1], after = data[idx]
    const t = (time - before.time) / (after.time - before.time)
    return {
      pressure: before.pressure + t * (after.pressure - before.pressure),
      flow: before.flow + t * (after.flow - before.flow),
      weight: before.weight + t * (after.weight - before.weight)
    }
  }
  
  return baseData.map(basePoint => {
    const otherPoint = findClosestPoint(basePoint.time, otherData)
    if (useAAsBase) {
      return {
        time: basePoint.time,
        pressureA: basePoint.pressure, flowA: basePoint.flow, weightA: basePoint.weight,
        pressureB: otherPoint?.pressure, flowB: otherPoint?.flow, weightB: otherPoint?.weight
      }
    } else {
      return {
        time: basePoint.time,
        pressureA: otherPoint?.pressure, flowA: otherPoint?.flow, weightA: otherPoint?.weight,
        pressureB: basePoint.pressure, flowB: basePoint.flow, weightB: basePoint.weight
      }
    }
  })
}

/** Calculate comparison statistics between two shots */
export function getComparisonStats(
  selectedShot: { total_time: number | null; final_weight: number | null },
  comparisonShot: { total_time: number | null; final_weight: number | null },
  shotData: ShotData,
  comparisonShotData: ShotData
) {
  const dataA = getComparisonChartData(shotData)
  const dataB = getComparisonChartData(comparisonShotData)
  
  const durationA = selectedShot.total_time || 0
  const durationB = comparisonShot.total_time || 0
  const yieldA = selectedShot.final_weight || 0
  const yieldB = comparisonShot.final_weight || 0
  const maxPressureA = Math.max(...dataA.map(d => d.pressure))
  const maxPressureB = Math.max(...dataB.map(d => d.pressure))
  const maxFlowA = Math.max(...dataA.map(d => d.flow))
  const maxFlowB = Math.max(...dataB.map(d => d.flow))
  
  const calcDiff = (a: number, b: number) => ({
    a, b,
    diff: a - b,
    diffPercent: b !== 0 ? ((a - b) / b) * 100 : 0
  })
  
  return {
    duration: calcDiff(durationA, durationB),
    yield: calcDiff(yieldA, yieldB),
    maxPressure: calcDiff(maxPressureA, maxPressureB),
    maxFlow: calcDiff(maxFlowA, maxFlowB)
  }
}

/** Format a shot's timestamp for display */
export function formatShotTime(shot: { timestamp: string | null; filename: string; date: string }) {
  try {
    if (shot.timestamp && (typeof shot.timestamp === 'string' || typeof shot.timestamp === 'number')) {
      const ts = typeof shot.timestamp === 'string' ? parseFloat(shot.timestamp) : shot.timestamp
      if (!isNaN(ts) && ts > 0) {
        const date = new Date(ts * 1000)
        return format(date, 'MMM d, HH:mm')
      }
    }
    if (shot.filename && typeof shot.filename === 'string') {
      const timeMatch = shot.filename.match(/^(\d{2}):(\d{2}):(\d{2})/)
      if (timeMatch) {
        return `${shot.date || ''} ${timeMatch[0]}`
      }
    }
    return shot.date || 'Unknown'
  } catch {
    return shot.date || 'Unknown'
  }
}
