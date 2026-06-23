import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { getChartTheme } from '../charts/chartConstants'
import type { TempSample } from './estimateTimeToReady'
import { CHAMBER_COLOR, HEAD_COLOR } from './heatingColors'

// Solid red target line — visually distinct from the two sensor series and
// consistent with the red "Target" treatment used in the temperatures card.
const TARGET_COLOR = 'var(--destructive)'

// The x-axis starts at 6 minutes so a typical heat-up fits without rescaling,
// and extends only when a heat-up runs longer.
const MIN_X_SECONDS = 360
// The y-axis uses a rolling window fitted to the visible data (sensor temps +
// the target line) rather than a fixed 0–100°C range, so the sensor curves stay
// readable as they converge near the target. A minimum span keeps the window
// from over-zooming when the readings are close together.
const MIN_Y_SPAN = 20
const Y_PADDING = 3
const Y_FLOOR = 0
const Y_CEIL = 120

function computeYDomain(samples: TempSample[], setTemp: number): [number, number] {
  const temps: number[] = []
  for (const s of samples) {
    if (Number.isFinite(s.temp)) temps.push(s.temp)
    if (s.chamber != null && Number.isFinite(s.chamber)) temps.push(s.chamber)
  }
  if (Number.isFinite(setTemp)) temps.push(setTemp)
  if (temps.length === 0) return [Y_FLOOR, MIN_Y_SPAN]

  let lo = Math.min(...temps) - Y_PADDING
  let hi = Math.max(...temps) + Y_PADDING
  if (hi - lo < MIN_Y_SPAN) {
    const mid = (lo + hi) / 2
    lo = mid - MIN_Y_SPAN / 2
    hi = mid + MIN_Y_SPAN / 2
  }
  return [Math.max(Y_FLOOR, Math.floor(lo)), Math.min(Y_CEIL, Math.ceil(hi))]
}

interface HeatingTempChartProps {
  samples: TempSample[]
  setTemp: number
}

export function HeatingTempChart({ samples, setTemp }: HeatingTempChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const theme = getChartTheme(resolvedTheme === 'dark')

  const lastT = samples.length > 0 ? samples[samples.length - 1].t : 0
  const xMax = Math.max(MIN_X_SECONDS, Math.ceil(lastT))
  const yDomain = computeYDomain(samples, setTemp)

  return (
    <div
      className="h-48 w-full select-none [&_.recharts-surface]:outline-none [&_svg]:outline-none"
      role="img"
      aria-label={t('controlCenter.heating.temperatureChart')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={samples} margin={{ top: 5, right: 0, left: -5, bottom: 5 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={theme.gridColor}
            opacity={theme.gridOpacity}
          />
          <XAxis
            dataKey="t"
            stroke={theme.axisStroke}
            fontSize={10}
            tickFormatter={v => `${Math.round(Number(v))}s`}
            axisLine={{ stroke: theme.axisLineStroke }}
            tickLine={{ stroke: theme.axisLineStroke }}
            type="number"
            domain={[0, xMax]}
            allowDataOverflow={false}
          />
          <YAxis
            stroke={theme.axisStroke}
            fontSize={10}
            axisLine={{ stroke: theme.axisLineStroke }}
            tickLine={{ stroke: theme.axisLineStroke }}
            width={35}
            domain={yDomain}
            allowDataOverflow={false}
          />
          <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} iconType="circle" iconSize={8} />
          {/* Solid red target line. */}
          <ReferenceLine
            y={setTemp}
            stroke={TARGET_COLOR}
            strokeWidth={2}
            label={{ value: t('controlCenter.heating.target'), fill: TARGET_COLOR, fontSize: 10, position: 'insideTopRight' }}
          />
          <Line
            type="monotone"
            dataKey="temp"
            stroke={HEAD_COLOR}
            strokeWidth={2}
            dot={false}
            name={t('controlCenter.heating.brewHead')}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="chamber"
            stroke={CHAMBER_COLOR}
            strokeWidth={2}
            dot={false}
            name={t('controlCenter.heating.brewChamber')}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
