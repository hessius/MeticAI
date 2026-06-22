import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProfileBreakdown } from '@/components/ProfileBreakdown'
import type { ProfileData } from '@/components/ProfileBreakdown'
import { estimateTimeToReady } from './estimateTimeToReady'
import type { TempSample } from './estimateTimeToReady'
import { HeatingNumbers } from './HeatingNumbers'
import { HeatingTempChart } from './HeatingTempChart'

export interface HeatingDashboardProps {
  isReady: boolean
  /** Machine is actively heating/preheating (vs idle/standby). */
  isHeating?: boolean
  /** "Lance's standard" easter egg: head temp on-target while ready. */
  lancesStandard?: boolean
  profileName: string
  setTemp: number
  chamberTemp: number
  headTemp: number
  lanceReadyCutoff: number
  /** Machine's own countdown (seconds) when provided; preferred over our model. */
  preheatCountdown: number | null
  samples: TempSample[]
  profile: ProfileData | null
  description?: string
  startDisabled: boolean
  onStart: () => void
  onAbort: () => void
}

function formatMmSs(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function HeatingDashboard(props: HeatingDashboardProps) {
  const { t } = useTranslation()
  const [descOpen, setDescOpen] = useState(false)

  const modelEta = estimateTimeToReady({
    samples: props.samples,
    target: props.setTemp,
    cutoff: props.lanceReadyCutoff,
  })
  const etaSeconds =
    props.preheatCountdown != null && props.preheatCountdown > 0
      ? props.preheatCountdown
      : modelEta
  // Once the machine reports ready, the hero shows ~0:00 rather than an
  // estimate; the time-to-ready hero is only meaningful while heating or ready.
  const heroEta = props.isReady ? 0 : etaSeconds
  const showHero = props.isReady || props.isHeating
  const statusLabel = props.isReady
    ? t('controlCenter.heating.statusReady')
    : props.isHeating
      ? t('controlCenter.heating.statusHeating')
      : t('controlCenter.states.idle')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={props.isReady ? 'default' : 'secondary'}>
            {statusLabel}
          </Badge>
          <span className="truncate text-sm font-medium text-foreground">{props.profileName}</span>
          {props.lancesStandard && (
            <span className="shrink-0 text-xs font-medium italic text-emerald-600 dark:text-emerald-400">
              {t('controlCenter.states.lancesStandard')}
            </span>
          )}
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">
          {t('controlCenter.heating.setTemp')}: {props.setTemp}°C
        </span>
      </div>

      {showHero && (
        <div className="flex flex-col items-center rounded-xl border border-border bg-card px-4 py-5 text-center">
          <AnimatePresence mode="wait">
            {heroEta == null ? (
              <motion.span
                key="estimating"
                className="text-2xl font-semibold tabular-nums text-muted-foreground"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
              >
                {t('controlCenter.heating.estimating')}
              </motion.span>
            ) : (
              <motion.span
                key="eta"
                className="text-5xl font-bold tabular-nums tracking-tight text-foreground"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
              >
                {t('controlCenter.heating.estimatePrefix')}
                {formatMmSs(heroEta)}
              </motion.span>
            )}
          </AnimatePresence>
          <span className="mt-1 text-sm text-muted-foreground">
            {t('controlCenter.heating.timeToReady')}
          </span>
          <span className="mt-1 max-w-xs text-xs text-muted-foreground">
            {t('controlCenter.heating.slowsNearTarget')}
          </span>
        </div>
      )}

      <HeatingTempChart
        samples={props.samples}
        setTemp={props.setTemp}
        lanceReadyCutoff={props.lanceReadyCutoff}
      />

      <HeatingNumbers
        chamberTemp={props.chamberTemp}
        headTemp={props.headTemp}
        setTemp={props.setTemp}
        lanceReadyCutoff={props.lanceReadyCutoff}
      />

      <div>
        <h3 className="mb-2 text-sm font-medium text-foreground">
          {t('controlCenter.heating.whatsHappening')}
        </h3>
        <ProfileBreakdown profile={props.profile} />
      </div>

      {props.description && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDescOpen(open => !open)}
            aria-expanded={descOpen}
          >
            {descOpen
              ? t('controlCenter.heating.hideDescription')
              : t('controlCenter.heating.showDescription')}
          </Button>
          <AnimatePresence>
            {descOpen && (
              <motion.p
                className="mt-2 whitespace-pre-line text-sm text-muted-foreground"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {props.description}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" className="flex-1" onClick={props.onStart} disabled={props.startDisabled}>
          {t('controlCenter.actions.start')}
        </Button>
        <Button type="button" variant="destructive" onClick={props.onAbort}>
          {t('controlCenter.actions.abort')}
        </Button>
      </div>
    </div>
  )
}
