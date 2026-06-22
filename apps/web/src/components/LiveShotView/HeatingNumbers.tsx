import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { CHAMBER_COLOR, HEAD_COLOR } from './heatingColors'
import { progressPercent } from './heatingProgress'

// Green applied to a sensor's bar + readout once it reaches the ready band.
const REACHED_COLOR = 'var(--success)'
// Red target marker, consistent with the chart's "Target" line.
const TARGET_COLOR = 'var(--destructive)'

interface HeatingNumbersProps {
  chamberTemp: number
  headTemp: number
  setTemp: number
  /** Ready cutoff (°C); a sensor counts as "on target" once it reaches this. */
  lanceReadyCutoff: number
}

function SensorCell({
  label,
  temp,
  setTemp,
  cutoff,
  color,
}: {
  label: string
  temp: number
  setTemp: number
  cutoff: number
  color: string
}) {
  const fillPercent = progressPercent(temp, setTemp)
  const reached = temp >= cutoff
  const barColor = reached ? REACHED_COLOR : color

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className="font-mono text-base tabular-nums"
          style={{ color: reached ? REACHED_COLOR : 'var(--foreground)' }}
        >
          {temp.toFixed(1)}°C
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: barColor }}
          initial={false}
          animate={{ width: `${fillPercent}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
        {/* Red target marker at the right edge (set temperature). */}
        <div
          data-testid="target-marker"
          className="absolute top-0 h-full w-0.5"
          style={{ right: 0, backgroundColor: TARGET_COLOR }}
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

  const cells: Array<{ label: string; temp: number; color: string }> = [
    { label: t('controlCenter.heating.brewChamber'), temp: chamberTemp, color: CHAMBER_COLOR },
    { label: t('controlCenter.heating.brewHead'), temp: headTemp, color: HEAD_COLOR },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4">
      {cells.map(cell => {
        const reached = cell.temp >= lanceReadyCutoff
        const toTarget = Math.max(0, setTemp - cell.temp)
        return (
          <div key={cell.label} className="space-y-1.5">
            <SensorCell
              label={cell.label}
              temp={cell.temp}
              setTemp={setTemp}
              cutoff={lanceReadyCutoff}
              color={cell.color}
            />
            <p
              className="text-[10px] tabular-nums"
              style={{ color: reached ? REACHED_COLOR : 'var(--muted-foreground)' }}
            >
              {t('controlCenter.heating.deltaToTarget')}: {toTarget.toFixed(1)}°C
            </p>
          </div>
        )
      })}
    </div>
  )
}
