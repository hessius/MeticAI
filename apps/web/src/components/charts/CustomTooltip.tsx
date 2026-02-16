/**
 * CustomTooltip — shared Recharts tooltip used by shot charts.
 */
import type { TooltipPayloadItem, ProfileTargetPoint } from './chartConstants'
import { CHART_COLORS } from './chartConstants'

/** Linearly interpolate a target value at the given time */
function interpolateTarget(
  curves: ProfileTargetPoint[],
  time: number,
  key: 'target_pressure' | 'target_flow',
): number | null {
  const pts = curves
    .filter(p => p[key] !== undefined)
    .sort((a, b) => a.time - b.time)
  if (pts.length === 0) return null
  if (time <= pts[0].time) return pts[0][key]!
  if (time >= pts[pts.length - 1].time) return pts[pts.length - 1][key]!
  for (let i = 0; i < pts.length - 1; i++) {
    if (time >= pts[i].time && time <= pts[i + 1].time) {
      const t = (time - pts[i].time) / (pts[i + 1].time - pts[i].time)
      return pts[i][key]! + t * (pts[i + 1][key]! - pts[i][key]!)
    }
  }
  return null
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: number
  targetCurves?: ProfileTargetPoint[]
}

export function CustomTooltip({ active, payload, label, targetCurves }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null

  const stageData = payload[0]?.payload
  const stageName = stageData?.stage

  // Interpolate goal values at current time
  const time = typeof label === 'number' ? label : 0
  const goalPressure = targetCurves ? interpolateTarget(targetCurves, time, 'target_pressure') : null
  const goalFlow = targetCurves ? interpolateTarget(targetCurves, time, 'target_flow') : null

  return (
    <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground mb-1.5">
        Time: {typeof label === 'number' ? label.toFixed(1) : '0'}s
      </p>
      {stageName && typeof stageName === 'string' && (
        <p className="text-xs font-medium text-primary mb-1.5">
          Stage: {stageName}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((item, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: item.color || '#888' }}
            />
            <span className="capitalize">
              {typeof item.name === 'string' ? item.name : 'Value'}:
            </span>
            <span className="font-medium">
              {typeof item.value === 'number' ? item.value.toFixed(2) : '-'}
            </span>
          </div>
        ))}
      </div>
      {/* Goal values from profile target curves */}
      {(goalPressure !== null || goalFlow !== null) && (
        <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Goals</p>
          {goalPressure !== null && (
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.targetPressure }} />
              <span>Pressure:</span>
              <span className="font-medium">{goalPressure.toFixed(2)}</span>
            </div>
          )}
          {goalFlow !== null && (
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.targetFlow }} />
              <span>Flow:</span>
              <span className="font-medium">{goalFlow.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
