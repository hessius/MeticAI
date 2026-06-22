import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { CHAMBER_COLOR, HEAD_COLOR } from './heatingColors'

interface HeatingNumbersProps {
  chamberTemp: number
  headTemp: number
  setTemp: number
  lanceReadyCutoff: number
}

const AMBIENT_BASELINE = 20

function progressPercent(temp: number, setTemp: number): number {
  const span = setTemp - AMBIENT_BASELINE
  if (span <= 0) return 100
  return Math.max(0, Math.min(100, ((temp - AMBIENT_BASELINE) / span) * 100))
}

function SensorRow({
  label,
  temp,
  setTemp,
  lanceReadyCutoff,
  color,
}: {
  label: string
  temp: number
  setTemp: number
  lanceReadyCutoff: number
  color: string
}) {
  const fillPercent = progressPercent(temp, setTemp)
  const readyPercent = progressPercent(lanceReadyCutoff, setTemp)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-lg tabular-nums text-foreground">{temp.toFixed(1)}°C</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full"
          style={{ width: `${fillPercent}%`, backgroundColor: color }}
        />
        <div
          data-testid="ready-marker"
          className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-foreground/70"
          style={{ left: `${readyPercent}%` }}
        />
      </div>
    </div>
  )
}

export function HeatingNumbers({
  chamberTemp,
  headTemp,
  setTemp,
  lanceReadyCutoff,
}: HeatingNumbersProps) {
  const { t } = useTranslation()
  const delta = setTemp - headTemp

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <SensorRow
        label={t('controlCenter.heating.brewChamber')}
        temp={chamberTemp}
        setTemp={setTemp}
        lanceReadyCutoff={lanceReadyCutoff}
        color={CHAMBER_COLOR}
      />
      <SensorRow
        label={t('controlCenter.heating.brewHead')}
        temp={headTemp}
        setTemp={setTemp}
        lanceReadyCutoff={lanceReadyCutoff}
        color={HEAD_COLOR}
      />
      <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">{t('controlCenter.heating.deltaToTarget')}</span>
        <span data-testid="delta-readout" className="font-mono font-semibold tabular-nums text-foreground">
          {delta.toFixed(1)}°C
        </span>
      </div>
    </div>
  )
}
