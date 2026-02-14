/**
 * SensorGauge — a compact radial arc gauge built with SVG.
 *
 * Props:
 *   value   – current reading (needle position)
 *   min/max – scale range
 *   goal    – optional target tick (green)
 *   limit   – optional limit tick (red)
 *   unit    – label for the unit ("bar", "ml/s", "°C")
 *   label   – descriptive label ("Pressure")
 *   size    – diameter in px (default 120)
 */
import { useMemo } from 'react'

interface SensorGaugeProps {
  value: number | null
  min: number
  max: number
  goal?: number | null
  limit?: number | null
  unit: string
  label: string
  size?: number
  stale?: boolean
}

// Arc geometry
const START_ANGLE = 135 // degrees, measured from 12 o'clock CW
const END_ANGLE = 405
const ARC_SPAN = END_ANGLE - START_ANGLE // 270°

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToXY(cx, cy, r, startDeg)
  const end = polarToXY(cx, cy, r, endDeg)
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

function valueToAngle(value: number, min: number, max: number) {
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return START_ANGLE + ratio * ARC_SPAN
}

function getArcColor(value: number, goal: number | null | undefined, limit: number | null | undefined) {
  if (limit != null && value >= limit) return '#ef4444' // red-500
  if (goal != null) {
    const dist = Math.abs(value - goal)
    const range = Math.max(goal * 0.3, 1)
    if (dist < range * 0.5) return '#22c55e' // green-500
    if (dist < range) return '#f59e0b' // amber-500
  }
  return '#3b82f6' // blue-500
}

export function SensorGauge({
  value,
  min,
  max,
  goal,
  limit,
  unit,
  label,
  size = 120,
  stale,
}: SensorGaugeProps) {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.38
  const strokeWidth = size * 0.08

  const backgroundArc = useMemo(
    () => describeArc(cx, cy, r, START_ANGLE, END_ANGLE),
    [cx, cy, r],
  )

  const clampedValue = value != null ? Math.max(min, Math.min(max, value)) : null
  const valueAngle = clampedValue != null ? valueToAngle(clampedValue, min, max) : START_ANGLE
  const filledArc =
    clampedValue != null ? describeArc(cx, cy, r, START_ANGLE, valueAngle) : null
  const arcColor = clampedValue != null ? getArcColor(clampedValue, goal, limit) : '#64748b'

  // Tick helpers
  const renderTick = (val: number, color: string) => {
    const angle = valueToAngle(val, min, max)
    const inner = polarToXY(cx, cy, r - strokeWidth * 1.2, angle)
    const outer = polarToXY(cx, cy, r + strokeWidth * 1.2, angle)
    return (
      <line
        key={`tick-${val}`}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke={color}
        strokeWidth={strokeWidth * 0.35}
        strokeLinecap="round"
      />
    )
  }

  // Needle
  const needleEnd = clampedValue != null ? polarToXY(cx, cy, r - strokeWidth * 0.5, valueAngle) : null

  return (
    <div
      className={`flex flex-col items-center gap-0.5 ${stale ? 'opacity-50' : ''}`}
      style={{ width: size }}
    >
      <svg
        width={size}
        height={size * 0.72}
        viewBox={`0 0 ${size} ${size * 0.72}`}
        className="overflow-visible"
      >
        {/* Background track */}
        <path
          d={backgroundArc}
          fill="none"
          stroke="currentColor"
          className="text-muted/30"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Filled arc */}
        {filledArc && (
          <path
            d={filledArc}
            fill="none"
            stroke={arcColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className="transition-all duration-200"
          />
        )}

        {/* Goal tick */}
        {goal != null && goal >= min && goal <= max && renderTick(goal, '#22c55e')}

        {/* Limit tick */}
        {limit != null && limit >= min && limit <= max && renderTick(limit, '#ef4444')}

        {/* Needle */}
        {needleEnd && (
          <line
            x1={cx}
            y1={cy}
            x2={needleEnd.x}
            y2={needleEnd.y}
            stroke={arcColor}
            strokeWidth={strokeWidth * 0.3}
            strokeLinecap="round"
            className="transition-all duration-200"
          />
        )}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={strokeWidth * 0.35} fill={arcColor} className="transition-colors duration-200" />

        {/* Value text */}
        <text
          x={cx}
          y={cy + size * 0.12}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-bold"
          style={{ fontSize: size * 0.18 }}
        >
          {value != null ? value.toFixed(1) : '—'}
        </text>

        {/* Unit */}
        <text
          x={cx}
          y={cy + size * 0.24}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-muted-foreground"
          style={{ fontSize: size * 0.1 }}
        >
          {unit}
        </text>
      </svg>

      <span className="text-[11px] text-muted-foreground font-medium truncate max-w-full">
        {label}
      </span>
    </div>
  )
}
