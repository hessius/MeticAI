import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
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
  profileImageUrl?: string | null
  setTemp: number
  chamberTemp: number
  headTemp: number
  lanceReadyCutoff: number
  /** Machine's own countdown (seconds) when provided; preferred over our model. */
  preheatCountdown: number | null
  samples: TempSample[]
  profile: ProfileData | null
  /** Auto-generated one-line summary of what this shot will do. */
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

interface HeroTone {
  container: string
  accent: string
}

function heroTone(isReady: boolean, isHeating: boolean, lancesStandard: boolean): HeroTone {
  if (lancesStandard) {
    return {
      container: 'border-emerald-500/60 bg-emerald-500/15',
      accent: 'text-emerald-600 dark:text-emerald-400',
    }
  }
  if (isReady) {
    return {
      container: 'border-success/50 bg-success/10',
      accent: 'text-success',
    }
  }
  if (isHeating) {
    return {
      container: 'border-orange-500/50 bg-orange-500/10',
      accent: 'text-orange-600 dark:text-orange-400',
    }
  }
  return { container: 'border-border bg-card', accent: 'text-muted-foreground' }
}

export function HeatingDashboard(props: HeatingDashboardProps) {
  const { t } = useTranslation()

  const isHeating = props.isHeating ?? false
  const modelEta = estimateTimeToReady({
    current: props.headTemp,
    target: props.setTemp,
    cutoff: props.lanceReadyCutoff,
  })
  const etaSeconds =
    props.preheatCountdown != null && props.preheatCountdown > 0
      ? props.preheatCountdown
      : modelEta
  // Once the machine reports ready, the hero shows 0:00 rather than an estimate.
  const heroEta = props.isReady ? 0 : etaSeconds
  const showCountdown = props.isReady || isHeating

  const statusLabel = props.isReady
    ? t('controlCenter.heating.statusReady')
    : isHeating
      ? t('controlCenter.heating.statusHeating')
      : t('controlCenter.states.idle')

  const tone = heroTone(props.isReady, isHeating, props.lancesStandard ?? false)

  return (
    <div className="flex flex-col gap-4 pb-28">
      {/* Hero — color-coded status + time-to-stability countdown */}
      <div className={`flex flex-col items-center rounded-2xl border px-4 py-6 text-center transition-colors ${tone.container}`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold uppercase tracking-wide ${tone.accent}`}>
            {statusLabel}
          </span>
          {props.lancesStandard && (
            <span className="text-xs font-medium italic text-emerald-600 dark:text-emerald-400">
              {t('controlCenter.states.lancesStandard')}
            </span>
          )}
        </div>

        {showCountdown && (
          <>
            <AnimatePresence mode="wait">
              {heroEta == null ? (
                <motion.span
                  key="estimating"
                  className="mt-2 text-2xl font-semibold tabular-nums text-muted-foreground"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  {t('controlCenter.heating.estimating')}
                </motion.span>
              ) : (
                <motion.span
                  key="eta"
                  className={`mt-2 text-6xl font-bold tabular-nums tracking-tight ${props.isReady ? tone.accent : 'text-foreground'}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  {!props.isReady && t('controlCenter.heating.estimatePrefix')}
                  {formatMmSs(heroEta)}
                </motion.span>
              )}
            </AnimatePresence>
            <span className="mt-2 text-sm text-muted-foreground">
              {props.isReady
                ? t('controlCenter.heating.stabilityReached')
                : t('controlCenter.heating.timeToReady')}
            </span>
          </>
        )}
      </div>

      {/* Temperatures */}
      <HeatingNumbers
        chamberTemp={props.chamberTemp}
        headTemp={props.headTemp}
        setTemp={props.setTemp}
        lanceReadyCutoff={props.lanceReadyCutoff}
      />

      {/* Temperature chart */}
      <HeatingTempChart samples={props.samples} setTemp={props.setTemp} />

      {/* Profile name + image card */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        {props.profileImageUrl && (
          <img
            src={props.profileImageUrl}
            alt={props.profileName}
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-lg font-bold text-foreground">
          {props.profileName}
        </span>
      </div>

      {/* Auto-generated description */}
      {props.description && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {props.description}
          </p>
        </div>
      )}

      {/* Profile breakdown — resolved values, no variable chips/warnings */}
      <ProfileBreakdown profile={props.profile} hideVariables />

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-3xl gap-3">
          <Button type="button" className="flex-1" onClick={props.onStart} disabled={props.startDisabled}>
            {t('controlCenter.actions.start')}
          </Button>
          <Button type="button" variant="destructive" onClick={props.onAbort}>
            {t('controlCenter.actions.abort')}
          </Button>
        </div>
      </div>
    </div>
  )
}
