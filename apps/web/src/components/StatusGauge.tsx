interface StatusGaugeProps {
  value: number
  max: number
  label: string
  unit?: string
  /** Color of the filled arc */
  color?: string
  size?: number
}

export function StatusGauge({ value, max, label, unit = '', color, size = 120 }: StatusGaugeProps) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const displayPct = Math.round(pct * 100)

  // Derive color from percentage if not provided
  const arcColor = color ?? (pct < 0.7 ? '#22c55e' : pct < 0.9 ? '#eab308' : '#ef4444')

  const r = (size - 12) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = Math.PI * r // semicircle
  const strokeDashoffset = circumference * (1 - pct)

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={size}
        height={size / 2 + 16}
        viewBox={`0 0 ${size} ${size / 2 + 16}`}
        aria-label={`${label}: ${displayPct}%`}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        {/* Background arc */}
        <path
          d={describeArc(cx, cy, r, 180, 360)}
          fill="none"
          stroke="currentColor"
          className="text-muted-foreground/20"
          strokeWidth={8}
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d={describeArc(cx, cy, r, 180, 360)}
          fill="none"
          stroke={arcColor}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        {/* Percentage text */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-foreground text-lg font-bold"
          fontSize={size * 0.18}
        >
          {displayPct}%
        </text>
        {/* Value text */}
        {unit && (
          <text
            x={cx}
            y={cy + size * 0.1}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={size * 0.1}
          >
            {Math.round(value)}{unit} / {Math.round(max)}{unit}
          </text>
        )}
      </svg>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </div>
  )
}

/** Describe a circular arc as an SVG path. Angles in degrees, 0 = 3 o'clock. */
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const startRad = (startAngle * Math.PI) / 180
  const endRad = (endAngle * Math.PI) / 180
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
}
