import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getChartTheme } from '../charts/chartConstants'
import type { TempSample } from './estimateTimeToReady'
import { CHAMBER_COLOR, HEAD_COLOR } from './heatingColors'

// Neutral token for the dashed target/threshold lines so they are visually
// distinct from the two sensor series (which own CHART_COLORS).
const THRESHOLD_COLOR = 'var(--muted-foreground)'

interface HeatingTempChartProps {
  samples: TempSample[]
  setTemp: number
  lanceReadyCutoff: number
}

export function HeatingTempChart({ samples, setTemp, lanceReadyCutoff }: HeatingTempChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const theme = getChartTheme(resolvedTheme === 'dark')

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
            allowDataOverflow={false}
          />
          <YAxis
            stroke={theme.axisStroke}
            fontSize={10}
            axisLine={{ stroke: theme.axisLineStroke }}
            tickLine={{ stroke: theme.axisLineStroke }}
            width={35}
            allowDataOverflow={false}
          />
          <Tooltip
            labelFormatter={label => `${Math.round(Number(label))}s`}
            formatter={(value, name) => [`${Number(value).toFixed(1)}°C`, name]}
          />
          <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} iconType="circle" iconSize={8} />
          {/* Threshold lines use a neutral token so they read as targets, not as either sensor series. */}
          <ReferenceLine
            y={setTemp}
            stroke={THRESHOLD_COLOR}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            label={{ value: t('controlCenter.heating.setTemp'), fill: THRESHOLD_COLOR, fontSize: 10, position: 'insideTopRight' }}
          />
          <ReferenceLine
            y={lanceReadyCutoff}
            stroke={THRESHOLD_COLOR}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            label={{ value: t('controlCenter.heating.lanceReady'), fill: THRESHOLD_COLOR, fontSize: 10, position: 'insideBottomRight' }}
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
