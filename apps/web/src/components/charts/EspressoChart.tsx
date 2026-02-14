/**
 * EspressoChart — reusable Recharts LineChart for espresso shot data.
 *
 * Used by LiveShotView (real-time) and ShotHistoryView (historical).
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import { useTheme } from 'next-themes'
import {
  CHART_COLORS,
  STAGE_COLORS,
  STAGE_BORDER_COLORS,
  getChartTheme,
  type ChartDataPoint,
  type StageRange,
} from './chartConstants'
import { CustomTooltip } from './CustomTooltip'

// ---------------------------------------------------------------------------
// Reference line descriptor (for live-view limits)
// ---------------------------------------------------------------------------

export interface ChartReferenceLine {
  y: number
  axis: 'left' | 'right'
  color: string
  label?: string
  dashed?: boolean
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EspressoChartProps {
  /** Telemetry data points */
  data: ChartDataPoint[]
  /** Stage ranges for coloured background bands */
  stages?: StageRange[]
  /** CSS class applied to the outer wrapper */
  className?: string
  /** Height class — default "h-64" */
  heightClass?: string
  /** Show the weight line (right Y-axis). Default true. */
  showWeight?: boolean
  /** Show gravimetric flow line. Default false. */
  showGravimetricFlow?: boolean
  /** Replay playhead position (seconds) — omit to hide */
  replayTime?: number
  /** Fixed X-axis max (omit for auto) */
  xMax?: number
  /** Horizontal reference lines for limits / goals */
  referenceLines?: ChartReferenceLine[]
  /** When true the chart auto-scales X domain (live mode) */
  liveMode?: boolean
  /** Show legend. Default true. */
  showLegend?: boolean
  /** Override left axis max */
  leftAxisMax?: number
  /** Override right axis max */
  rightAxisMax?: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EspressoChart({
  data,
  stages = [],
  className,
  heightClass = 'h-64',
  showWeight = true,
  showGravimetricFlow = false,
  replayTime,
  xMax,
  referenceLines = [],
  liveMode = false,
  showLegend = true,
  leftAxisMax,
  rightAxisMax,
}: EspressoChartProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const theme = getChartTheme(isDark)

  // Auto-compute axis limits
  const maxPressure = Math.max(...data.map(d => d.pressure || 0), 12)
  const maxFlow = Math.max(
    ...data.map(d => Math.max(d.flow || 0, d.gravimetricFlow || 0)),
    8,
  )
  const computedLeftMax = leftAxisMax ?? Math.ceil(Math.max(maxPressure, maxFlow) * 1.1)
  const maxWeight = Math.max(...data.map(d => d.weight || 0), 50)
  const computedRightMax = rightAxisMax ?? Math.ceil(maxWeight * 1.1)

  const xDomain: [number | string, number | string] = liveMode
    ? [0, 'auto']
    : [0, xMax ?? Math.ceil(Math.max(...data.map(d => d.time), 1))]

  return (
    <div className={className}>
      <div className={heightClass}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 0, left: -5, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.gridColor}
              opacity={theme.gridOpacity}
            />

            {/* Stage background bands */}
            {stages.map((stage, idx) => (
              <ReferenceArea
                key={idx}
                yAxisId="left"
                x1={stage.startTime}
                x2={stage.endTime}
                fill={STAGE_COLORS[stage.colorIndex]}
                fillOpacity={1}
                stroke={STAGE_BORDER_COLORS[stage.colorIndex]}
                strokeWidth={0}
                ifOverflow="extendDomain"
              />
            ))}

            {/* Replay playhead */}
            {replayTime !== undefined && (
              <ReferenceLine
                yAxisId="left"
                x={replayTime}
                stroke={theme.replayLineStroke}
                strokeWidth={2}
                strokeDasharray="4 2"
              />
            )}

            {/* Horizontal reference lines (limits / goals) */}
            {referenceLines.map((rl, idx) => (
              <ReferenceLine
                key={`rl-${idx}`}
                yAxisId={rl.axis}
                y={rl.y}
                stroke={rl.color}
                strokeWidth={1.5}
                strokeDasharray={rl.dashed !== false ? '6 3' : undefined}
                label={rl.label ? { value: rl.label, fill: rl.color, fontSize: 10, position: 'insideTopRight' } : undefined}
              />
            ))}

            {/* Axes */}
            <XAxis
              dataKey="time"
              stroke={theme.axisStroke}
              fontSize={10}
              tickFormatter={v => `${Math.round(v)}s`}
              axisLine={{ stroke: theme.axisLineStroke }}
              tickLine={{ stroke: theme.axisLineStroke }}
              domain={xDomain}
              type="number"
              allowDataOverflow={false}
            />
            <YAxis
              yAxisId="left"
              stroke={theme.axisStroke}
              fontSize={10}
              domain={[0, computedLeftMax]}
              axisLine={{ stroke: theme.axisLineStroke }}
              tickLine={{ stroke: theme.axisLineStroke }}
              width={35}
              allowDataOverflow={false}
            />
            {showWeight && (
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={theme.axisStroke}
                fontSize={10}
                domain={[0, computedRightMax]}
                axisLine={{ stroke: theme.axisLineStroke }}
                tickLine={{ stroke: theme.axisLineStroke }}
                width={35}
                allowDataOverflow={false}
              />
            )}

            <Tooltip content={<CustomTooltip />} />
            {showLegend && (
              <Legend
                wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
                iconType="circle"
                iconSize={8}
              />
            )}

            {/* Data lines */}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="pressure"
              stroke={CHART_COLORS.pressure}
              strokeWidth={2}
              dot={false}
              name="Pressure (bar)"
              isAnimationActive={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="flow"
              stroke={CHART_COLORS.flow}
              strokeWidth={2}
              dot={false}
              name="Flow (ml/s)"
              isAnimationActive={false}
            />
            {showWeight && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="weight"
                stroke={CHART_COLORS.weight}
                strokeWidth={2}
                dot={false}
                name="Weight (g)"
                isAnimationActive={false}
              />
            )}
            {showGravimetricFlow && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="gravimetricFlow"
                stroke={CHART_COLORS.gravimetricFlow}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                name="Grav. Flow (g/s)"
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
