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
// Fixed 0–100°C y-axis keeps the curve shape stable across shots.
const Y_MIN = 0
const Y_MAX = 100

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
            domain={[Y_MIN, Y_MAX]}
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
