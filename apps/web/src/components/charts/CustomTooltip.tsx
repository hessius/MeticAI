/**
 * CustomTooltip — shared Recharts tooltip used by shot charts.
 */
import type { TooltipPayloadItem } from './chartConstants'

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: number
}

export function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null

  const stageData = payload[0]?.payload
  const stageName = stageData?.stage

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
    </div>
  )
}
