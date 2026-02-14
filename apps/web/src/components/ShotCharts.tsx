import React from 'react'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ChartLine, Play } from '@phosphor-icons/react'
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
  Customized
} from 'recharts'

// Chart colors matching Meticulous app style (muted to fit dark theme)
const CHART_COLORS = {
  pressure: '#4ade80',      // Green (muted)
  flow: '#67e8f9',          // Light cyan/blue (muted)
  weight: '#fbbf24',        // Amber/Yellow (muted)
  gravimetricFlow: '#c2855a', // Brown-orange (muted to fit dark theme)
  // Profile target curves (lighter/dashed versions of main colors)
  targetPressure: '#86efac',  // Lighter green for target pressure
  targetFlow: '#a5f3fc'       // Lighter cyan for target flow
}

// Stage colors for background areas (matching tag colors)
const STAGE_COLORS = [
  'rgba(239, 68, 68, 0.25)',   // Red
  'rgba(249, 115, 22, 0.25)',  // Orange  
  'rgba(234, 179, 8, 0.25)',   // Yellow
  'rgba(34, 197, 94, 0.25)',   // Green
  'rgba(59, 130, 246, 0.25)',  // Blue
  'rgba(168, 85, 247, 0.25)',  // Purple
  'rgba(236, 72, 153, 0.25)',  // Pink
  'rgba(20, 184, 166, 0.25)',  // Teal
]

const STAGE_BORDER_COLORS = [
  'rgba(239, 68, 68, 0.5)',
  'rgba(249, 115, 22, 0.5)',
  'rgba(234, 179, 8, 0.5)',
  'rgba(34, 197, 94, 0.5)',
  'rgba(59, 130, 246, 0.5)',
  'rgba(168, 85, 247, 0.5)',
  'rgba(236, 72, 153, 0.5)',
  'rgba(20, 184, 166, 0.5)',
]

// Darker text colors for stage pills — legible on both light and dark backgrounds
const STAGE_TEXT_COLORS_LIGHT = [
  'rgb(153, 27, 27)',    // Red-800
  'rgb(154, 52, 18)',    // Orange-800
  'rgb(133, 77, 14)',    // Yellow-800
  'rgb(22, 101, 52)',    // Green-800
  'rgb(30, 64, 175)',    // Blue-800
  'rgb(107, 33, 168)',   // Purple-800
  'rgb(157, 23, 77)',    // Pink-800
  'rgb(17, 94, 89)',     // Teal-800
]
const STAGE_TEXT_COLORS_DARK = [
  'rgb(252, 165, 165)',  // Red-300
  'rgb(253, 186, 116)',  // Orange-300
  'rgb(253, 224, 71)',   // Yellow-300
  'rgb(134, 239, 172)',  // Green-300
  'rgb(147, 197, 253)',  // Blue-300
  'rgb(216, 180, 254)',  // Purple-300
  'rgb(249, 168, 212)',  // Pink-300
  'rgb(94, 234, 212)',   // Teal-300
]

// Comparison chart colors
const COMPARISON_COLORS = {
  pressure: '#4ade80',
  flow: '#67e8f9',
  weight: '#fbbf24'
}

interface ChartDataPoint {
  time: number
  pressure?: number
  flow?: number
  weight?: number
  gravimetricFlow?: number
  stage?: string
  targetPressure?: number
  targetFlow?: number
}

interface StageRange {
  name: string
  startTime: number
  endTime: number
  colorIndex: number
}

interface ProfileTargetPoint {
  time: number
  target_pressure?: number
  target_flow?: number
}

// Custom tooltip payload type (extends Recharts default)
interface TooltipPayloadItem {
  name: string
  value: number
  color: string
  dataKey: string
  payload?: ChartDataPoint
}

// Custom tooltip for the chart
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: number }) {
  if (!active || !payload || !payload.length) return null
  
  // Find stage from the first payload item if available
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
        {payload.map((entry, index) => (
          <p key={index} className="text-xs font-medium" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : '-'}
          </p>
        ))}
      </div>
    </div>
  )
}

interface ReplayChartProps {
  displayData: ChartDataPoint[]
  displayStageRanges: StageRange[]
  stageRanges: StageRange[]
  dataMaxTime: number
  maxLeftAxis: number
  maxRightAxis: number
  hasGravFlow: boolean
  isShowingReplay: boolean
  currentTime: number
  isPlaying: boolean
  playbackSpeed: string
  isDark: boolean
  variant?: 'mobile' | 'desktop'
}

export function ReplayChart({
  displayData,
  displayStageRanges,
  stageRanges,
  dataMaxTime,
  maxLeftAxis,
  maxRightAxis,
  hasGravFlow,
  isShowingReplay,
  currentTime,
  isPlaying,
  playbackSpeed,
  isDark,
  variant = 'mobile'
}: ReplayChartProps) {
  const isMobile = variant === 'mobile'
  const chartHeight = isMobile ? 'h-64' : 'h-[60vh] min-h-[400px]'
  const padding = isMobile ? 'p-1' : 'p-2'
  const rightMargin = isMobile ? 0 : 5
  const wrapperClass = isMobile ? 'space-y-2' : ''
  
  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold tracking-wide text-primary flex items-center gap-2">
          <ChartLine size={16} weight="bold" />
          Extraction Graph
        </Label>
        {isPlaying && (
          <Badge variant="secondary" className="animate-pulse">
            <Play size={10} weight="fill" className="mr-1" />
            Replaying {playbackSpeed}x
          </Badge>
        )}
      </div>
      <div className={`bg-secondary/40 rounded-xl border border-border/20 ${padding}`}>
        <div className={chartHeight}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={displayData} margin={{ top: 5, right: rightMargin, left: -5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
              {displayStageRanges.map((stage, idx) => (
                <ReferenceArea key={idx} yAxisId="left" x1={stage.startTime} x2={stage.endTime} fill={STAGE_COLORS[stage.colorIndex]} fillOpacity={1} stroke={STAGE_BORDER_COLORS[stage.colorIndex]} strokeWidth={0} ifOverflow="extendDomain" />
              ))}
              {isShowingReplay && <ReferenceLine yAxisId="left" x={currentTime} stroke="#fff" strokeWidth={2} strokeDasharray="4 2" />}
              <XAxis dataKey="time" stroke="#666" fontSize={10} tickFormatter={(v) => `${Math.round(v)}s`} axisLine={{ stroke: '#444' }} tickLine={{ stroke: '#444' }} domain={[0, dataMaxTime]} type="number" allowDataOverflow={false} />
              <YAxis yAxisId="left" stroke="#666" fontSize={10} domain={[0, maxLeftAxis]} axisLine={{ stroke: '#444' }} tickLine={{ stroke: '#444' }} width={35} allowDataOverflow={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#666" fontSize={10} domain={[0, maxRightAxis]} axisLine={{ stroke: '#444' }} tickLine={{ stroke: '#444' }} width={35} allowDataOverflow={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} iconType="circle" iconSize={8} />
              <Line yAxisId="left" type="monotone" dataKey="pressure" stroke={CHART_COLORS.pressure} strokeWidth={2} dot={false} name="Pressure (bar)" isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="flow" stroke={CHART_COLORS.flow} strokeWidth={2} dot={false} name="Flow (ml/s)" isAnimationActive={false} />
              <Line yAxisId="right" type="monotone" dataKey="weight" stroke={CHART_COLORS.weight} strokeWidth={2} dot={false} name="Weight (g)" isAnimationActive={false} />
              {hasGravFlow && <Line yAxisId="left" type="monotone" dataKey="gravimetricFlow" stroke={CHART_COLORS.gravimetricFlow} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Grav. Flow (g/s)" isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* Stage Legend */}
      {(() => {
        if (stageRanges.length === 0) return null
        return (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {stageRanges.map((stage, idx) => (
              <Badge key={idx} variant="outline" className="text-[10px] px-2 py-0.5 font-medium" style={{ backgroundColor: STAGE_COLORS[stage.colorIndex], borderColor: STAGE_BORDER_COLORS[stage.colorIndex], color: isDark ? STAGE_TEXT_COLORS_DARK[stage.colorIndex] : STAGE_TEXT_COLORS_LIGHT[stage.colorIndex] }}>
                {typeof stage.name === 'string' ? stage.name : String(stage.name || '')}
              </Badge>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

interface CombinedDataPoint {
  time: number
  pressureA?: number
  flowA?: number
  weightA?: number
  pressureB?: number
  flowB?: number
  weightB?: number
}

interface CompareChartProps {
  combinedData: CombinedDataPoint[]
  dataMaxTime: number
  leftDomain: number
  rightDomain: number
  isShowingReplay: boolean
  comparisonCurrentTime: number
  comparisonIsPlaying: boolean
  comparisonPlaybackSpeed: string
  variant?: 'mobile' | 'desktop'
}

export function CompareChart({
  combinedData,
  dataMaxTime,
  leftDomain,
  rightDomain,
  isShowingReplay,
  comparisonCurrentTime,
  comparisonIsPlaying,
  comparisonPlaybackSpeed,
  variant = 'mobile'
}: CompareChartProps) {
  const isMobile = variant === 'mobile'
  const chartHeight = isMobile ? 'h-64' : 'h-[60vh] min-h-[400px]'
  const padding = isMobile ? 'p-1' : 'p-2'
  const displayData = isShowingReplay ? combinedData.filter(d => d.time <= comparisonCurrentTime) : combinedData
  
  return (
    <>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-primary flex items-center gap-1.5">
          <ChartLine size={16} weight="bold" />
          Extraction Comparison
        </Label>
        {comparisonIsPlaying && (
          <Badge variant="secondary" className="animate-pulse text-[10px]">
            <Play size={8} weight="fill" className="mr-1" />
            {comparisonPlaybackSpeed}x
          </Badge>
        )}
      </div>
      <div className={`bg-secondary/40 rounded-xl border border-border/20 ${padding}`}>
        <div className={chartHeight}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={displayData} margin={{ top: 5, right: 5, left: -5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
              {isShowingReplay && <ReferenceLine yAxisId="left" x={comparisonCurrentTime} stroke="#fff" strokeWidth={2} strokeDasharray="4 2" />}
              <XAxis dataKey="time" stroke="#666" fontSize={10} tickFormatter={(v) => `${Math.round(v)}s`} domain={[0, dataMaxTime]} type="number" allowDataOverflow={false} />
              <YAxis yAxisId="left" stroke="#666" fontSize={10} domain={[0, leftDomain]} width={30} allowDataOverflow={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#666" fontSize={10} domain={[0, rightDomain]} width={30} allowDataOverflow={false} />
              <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', border: '1px solid #333', borderRadius: '8px', fontSize: '10px' }} />
              <Legend wrapperStyle={{ fontSize: '9px', paddingTop: '4px' }} iconSize={7} />
              <Line yAxisId="left" type="monotone" dataKey="pressureA" stroke={COMPARISON_COLORS.pressure} strokeWidth={2} dot={false} name="Pressure A" isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="flowA" stroke={COMPARISON_COLORS.flow} strokeWidth={2} dot={false} name="Flow A" isAnimationActive={false} />
              <Line yAxisId="right" type="monotone" dataKey="weightA" stroke={COMPARISON_COLORS.weight} strokeWidth={2} dot={false} name="Weight A" isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="pressureB" stroke={COMPARISON_COLORS.pressure} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Pressure B" opacity={0.6} isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="flowB" stroke={COMPARISON_COLORS.flow} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Flow B" opacity={0.6} isAnimationActive={false} />
              <Line yAxisId="right" type="monotone" dataKey="weightB" stroke={COMPARISON_COLORS.weight} strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Weight B" opacity={0.6} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><div className="w-4 h-0.5 bg-primary rounded" /> Shot A (solid)</span>
        <span className="flex items-center gap-1"><div className="w-4 h-0.5 bg-primary/50 rounded border-dashed" /> Shot B (dashed)</span>
      </div>
    </>
  )
}

interface AnalyzeChartProps {
  chartData: ChartDataPoint[]
  stageRanges: StageRange[]
  hasTargetCurves: boolean
  dataMaxTime: number
  maxLeftAxis: number
  maxFlow: number
  profileTargetCurves?: ProfileTargetPoint[]
  isDark: boolean
  variant?: 'mobile' | 'desktop'
}

export function AnalyzeChart({
  chartData,
  stageRanges,
  hasTargetCurves,
  dataMaxTime,
  maxLeftAxis,
  maxFlow,
  profileTargetCurves,
  isDark,
  variant = 'mobile'
}: AnalyzeChartProps) {
  const isMobile = variant === 'mobile'
  const chartHeight = isMobile ? 'h-64' : 'h-[60vh] min-h-[400px]'
  const padding = isMobile ? 'p-1' : 'p-2'
  
  return (
    <>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-primary flex items-center gap-1.5">
          <ChartLine size={16} weight="bold" />
          Shot vs Profile Target
        </Label>
        {hasTargetCurves && (
          <Badge variant="outline" className="text-xs bg-primary/10 border-primary/20">Target overlay</Badge>
        )}
      </div>
      <div className={`bg-secondary/40 rounded-xl border border-border/20 ${padding}`}>
        <div className={chartHeight}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              {stageRanges.map((stage, idx) => (
                <ReferenceArea key={idx} yAxisId="left" x1={stage.startTime} x2={stage.endTime} fill={STAGE_COLORS[stage.colorIndex]} fillOpacity={1} stroke={STAGE_BORDER_COLORS[stage.colorIndex]} strokeWidth={0} ifOverflow="extendDomain" />
              ))}
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#888' }} tickFormatter={(v) => `${Math.round(v)}s`} axisLine={{ stroke: '#444' }} type="number" domain={[0, dataMaxTime]} />
              <YAxis yAxisId="left" domain={[0, maxLeftAxis]} tick={{ fontSize: 10, fill: '#888' }} axisLine={{ stroke: '#444' }} width={25} />
              <YAxis yAxisId="right" orientation="right" domain={[0, Math.ceil(maxFlow * 1.1)]} hide width={0} />
              <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid #333', borderRadius: '8px', fontSize: '11px' }} formatter={(value: number, name: string) => [`${value?.toFixed(1) || '-'}`, name]} labelFormatter={(label) => `${Number(label).toFixed(1)}s`} />
              <Line yAxisId="left" type="monotone" dataKey="pressure" stroke={CHART_COLORS.pressure} strokeWidth={2} dot={false} name="Pressure (bar)" isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="flow" stroke={CHART_COLORS.flow} strokeWidth={2} dot={false} name="Flow (ml/s)" isAnimationActive={false} />
              {hasTargetCurves && profileTargetCurves && (
                <Customized
                  component={({ xAxisMap, yAxisMap }: { xAxisMap?: Record<string, { scale: (v: number) => number }>; yAxisMap?: Record<string, { scale: (v: number) => number }> }) => {
                    if (!xAxisMap || !yAxisMap) return null
                    const xAxis = Object.values(xAxisMap)[0]
                    const yAxis = yAxisMap['left']
                    if (!xAxis?.scale || !yAxis?.scale) return null
                    const curves = profileTargetCurves!
                    const pressurePoints = curves.filter(p => p.target_pressure !== undefined).sort((a, b) => a.time - b.time)
                    const flowPoints = curves.filter(p => p.target_flow !== undefined).sort((a, b) => a.time - b.time)
                    let pressurePath = ''
                    if (pressurePoints.length >= 2) pressurePath = pressurePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAxis.scale(p.time)} ${yAxis.scale(p.target_pressure!)}`).join(' ')
                    let flowPath = ''
                    if (flowPoints.length >= 2) flowPath = flowPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAxis.scale(p.time)} ${yAxis.scale(p.target_flow!)}`).join(' ')
                    return (
                      <g className="target-curves">
                        {pressurePath && <>
                          <path d={pressurePath} fill="none" stroke={CHART_COLORS.targetPressure} strokeWidth={2.5} strokeDasharray="8 4" strokeLinecap="round" />
                          {pressurePoints.map((p, i) => <circle key={`tp-${i}`} cx={xAxis.scale(p.time)} cy={yAxis.scale(p.target_pressure!)} r={4} fill={CHART_COLORS.targetPressure} />)}
                        </>}
                        {flowPath && <>
                          <path d={flowPath} fill="none" stroke={CHART_COLORS.targetFlow} strokeWidth={2.5} strokeDasharray="8 4" strokeLinecap="round" />
                          {flowPoints.map((p, i) => <circle key={`tf-${i}`} cx={xAxis.scale(p.time)} cy={yAxis.scale(p.target_flow!)} r={4} fill={CHART_COLORS.targetFlow} />)}
                        </>}
                      </g>
                    )
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ backgroundColor: CHART_COLORS.pressure }} /><span>Pressure</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ backgroundColor: CHART_COLORS.flow }} /><span>Flow</span></div>
        {hasTargetCurves && <>
          <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ backgroundColor: CHART_COLORS.targetPressure, borderStyle: 'dashed' }} /><span>Target Pressure</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ backgroundColor: CHART_COLORS.targetFlow, borderStyle: 'dashed' }} /><span>Target Flow</span></div>
        </>}
      </div>
      {/* Stage Legend */}
      {(() => {
        if (stageRanges.length === 0) return null
        return (
          <div className="flex flex-wrap gap-1.5">
            {stageRanges.map((stage, idx) => (
              <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0.5 font-medium" style={{ backgroundColor: STAGE_COLORS[stage.colorIndex], borderColor: STAGE_BORDER_COLORS[stage.colorIndex], color: isDark ? STAGE_TEXT_COLORS_DARK[stage.colorIndex] : STAGE_TEXT_COLORS_LIGHT[stage.colorIndex] }}>
                {typeof stage.name === 'string' ? stage.name : String(stage.name || '')}
              </Badge>
            ))}
          </div>
        )
      })()}
    </>
  )
}
