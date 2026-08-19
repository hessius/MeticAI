import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  getChartTheme,
  type ChartDataPoint,
  type ProfileTargetPoint,
} from './chartConstants'

export interface MetricPanelDef {
  /** Primary data key on the chart data point. */
  key: string
  /** i18n key for the panel title. */
  labelKey: string
  /** Line color. */
  color: string
  /** Optional dashed overlay series (e.g. gravimetric flow on the Flow panel). */
  overlayKey?: string
  /** Optional dashed comparison series (shot B) for the comparison view. */
  compareKey?: string
  /** Optional color for the comparison series (defaults to color). */
  compareColor?: string
  /** Optional target-curve data key (from ProfileTargetPoint). */
  targetKey?: 'target_pressure' | 'target_flow' | 'target_power'
}

export interface MetricPanelsProps {
  data: ChartDataPoint[]
  panels: MetricPanelDef[]
  layout: 'stack' | 'grid'
  /** Height budget for the whole panel group (e.g. "h-[60vh] max-h-[520px]"). */
  heightClass: string
  /** Shared x-axis max (omit for auto). */
  xMax?: number
  /** Optional target curves rendered as dashed guides (per-panel via targetKey). */
  targetCurves?: ProfileTargetPoint[]
  className?: string
}

/** True when at least one point carries a finite value for the key. */
function hasSeries(data: ChartDataPoint[], key: string): boolean {
  return data.some(p => {
    const v = (p as Record<string, unknown>)[key]
    return typeof v === 'number' && Number.isFinite(v)
  })
}

const SYNC_ID = 'metric-panels'

export function MetricPanels({
  data,
  panels,
  layout,
  heightClass,
  xMax,
  targetCurves,
  className,
}: MetricPanelsProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const theme = getChartTheme(resolvedTheme === 'dark')

  const visible = panels.filter(p => hasSeries(data, p.key))
  const container =
    layout === 'grid'
      ? 'grid grid-cols-2 auto-rows-fr gap-2'
      : 'flex flex-col gap-2'

  return (
    <div className={`${container} ${heightClass} ${className ?? ''}`}>
      {visible.map(panel => {
        const showTarget =
          panel.targetKey &&
          targetCurves &&
          targetCurves.some(
            c =>
              typeof c[panel.targetKey!] === 'number' &&
              Number.isFinite(c[panel.targetKey!]),
          )
        return (
          <div
            key={panel.key}
            data-metric-panel={panel.key}
            className="min-h-0 flex flex-col rounded-lg border border-border bg-card/40 p-2"
          >
            <span
              className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: panel.color }}
            >
              {t(panel.labelKey)}
            </span>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data}
                  margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
                  syncId={SYNC_ID}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={theme.gridColor}
                    opacity={theme.gridOpacity}
                  />
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={[0, xMax ?? 'dataMax']}
                    tickFormatter={(v: number) => `${Math.round(v)}s`}
                    stroke={theme.axisStroke}
                    fontSize={10}
                    tickLine={{ stroke: theme.axisLineStroke }}
                    axisLine={{ stroke: theme.axisLineStroke }}
                  />
                  <YAxis
                    stroke={theme.axisStroke}
                    fontSize={10}
                    width={34}
                    tickLine={{ stroke: theme.axisLineStroke }}
                    axisLine={{ stroke: theme.axisLineStroke }}
                  />
                  {showTarget && (
                    <Line
                      data={targetCurves}
                      type="monotone"
                      dataKey={panel.targetKey}
                      stroke={panel.color}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      opacity={0.5}
                      isAnimationActive={false}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey={panel.key}
                    stroke={panel.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {panel.overlayKey && hasSeries(data, panel.overlayKey) && (
                    <Line
                      type="monotone"
                      dataKey={panel.overlayKey}
                      stroke={panel.color}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                      opacity={0.7}
                      isAnimationActive={false}
                    />
                  )}
                  {panel.compareKey && hasSeries(data, panel.compareKey) && (
                    <Line
                      type="monotone"
                      dataKey={panel.compareKey}
                      stroke={panel.compareColor ?? panel.color}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      opacity={0.6}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}
