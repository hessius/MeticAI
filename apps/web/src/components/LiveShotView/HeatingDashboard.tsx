import { AnimatePresence, motion } from 'framer-motion'
import { Check, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
  samples: TempSample[]
  profile: ProfileData | null
  /** Auto-generated one-line summary of what this shot will do. */
  description?: string
  startDisabled: boolean
  onStart: () => void
  onAbort: () => void
  /** Auto-start on stable temperature (#588). */
  autoStartEnabled?: boolean
  onAutoStartChange?: (enabled: boolean) => void
  /** Currently dwelling within the on-target band (counting down to fire). */
  autoStartArmed?: boolean
  /** Milliseconds remaining before auto-start fires, when armed. */
  autoStartRemainingMs?: number | null
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

interface HeroState {
  tempStable: boolean
  readyToBrew: boolean
  isHeating: boolean
  lancesStandard: boolean
}

function heroTone(state: HeroState): HeroTone {
  if (state.lancesStandard) {
    return {
      container: 'border-emerald-500/60 bg-emerald-500/15',
      accent: 'text-emerald-600 dark:text-emerald-400',
    }
  }
  if (state.tempStable) {
    return {
      container: 'border-success/50 bg-success/10',
      accent: 'text-success',
    }
  }
  if (state.readyToBrew) {
    // Intermediate "almost there" state: brewable now, but still climbing to
    // full thermal stability. Lime sits between heating-orange and ready-green.
    return {
      container: 'border-lime-500/50 bg-lime-500/10',
      accent: 'text-lime-600 dark:text-lime-500',
    }
  }
  if (state.isHeating) {
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
  const cutoff = props.lanceReadyCutoff
  // Our own temperature-stability goal: the readiness sensor (brew head) has
  // reached the ready band (target − threshold). This is reached *after* the
  // machine first reports "ready to brew", so it — not the machine signal —
  // gates the full-green stable state.
  const tempStable = Number.isFinite(props.headTemp) && props.headTemp >= cutoff
  // Machine reports brewing is possible, but full thermal stability isn't here yet.
  const readyToBrew = props.isReady && !tempStable

  const modelEta = estimateTimeToReady({
    current: props.headTemp,
    target: props.setTemp,
    cutoff,
  })
  // Drive the hero from the temperature model rather than the machine's
  // brew-ready countdown (which fires early): the model returns 0 *exactly* when
  // tempStable, so the countdown and the green state flip together and the timer
  // never zeroes out before real stability is reached.
  const heroEta = tempStable ? 0 : modelEta
  const showCountdown = props.isReady || isHeating

  const statusLabel = tempStable
    ? t('controlCenter.heating.statusStable')
    : readyToBrew
      ? t('controlCenter.heating.statusReadyToBrew')
      : isHeating
        ? t('controlCenter.heating.statusHeating')
        : t('controlCenter.states.idle')

  const tone = heroTone({
    tempStable,
    readyToBrew,
    isHeating,
    lancesStandard: props.lancesStandard ?? false,
  })

  return (
    <div className="flex flex-col gap-4 pb-28">
      {/* Hero — color-coded status + time-to-stability countdown */}
      <div className={`flex flex-col items-center rounded-2xl border px-4 py-6 text-center transition-colors ${tone.container}`}>
        {readyToBrew ? (
          // "Ready to brew" is the headline; the remaining time to peak thermal
          // stability is demoted to a quiet secondary line so this state reads as
          // ready (not as if it were still counting down to being usable).
          <>
            <div className="flex items-center gap-2">
              <Check className={`h-7 w-7 ${tone.accent}`} aria-hidden="true" />
              <span className={`text-3xl font-bold tracking-tight ${tone.accent}`}>
                {t('controlCenter.heating.statusReadyToBrew')}
              </span>
            </div>
            {heroEta != null && heroEta > 0 ? (
              <span className="mt-2 text-sm text-muted-foreground">
                {t('controlCenter.heating.stillDialingIn', {
                  time: `${t('controlCenter.heating.estimatePrefix')}${formatMmSs(heroEta)}`,
                })}
              </span>
            ) : (
              // Estimate has run out but the head hasn't crossed the stability
              // cutoff yet — hold an "almost there" line instead of vanishing, so
              // the state never looks fully settled before it actually is.
              <span className="mt-2 text-sm text-muted-foreground">
                {t('controlCenter.heating.almostStable')}
              </span>
            )}
            {props.lancesStandard && (
              <span className="mt-1 text-xs font-medium italic text-emerald-600 dark:text-emerald-400">
                {t('controlCenter.states.lancesStandard')}
              </span>
            )}
          </>
        ) : (
          <>
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
                      className={`mt-2 text-6xl font-bold tabular-nums tracking-tight ${tempStable ? tone.accent : 'text-foreground'}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                    >
                      {!tempStable && t('controlCenter.heating.estimatePrefix')}
                      {formatMmSs(heroEta)}
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className="mt-2 text-sm text-muted-foreground">
                  {tempStable
                    ? t('controlCenter.heating.stabilityReached')
                    : t('controlCenter.heating.timeToReady')}
                </span>
              </>
            )}
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

      {/* Auto-start on stable temperature (#588) — on-the-fly toggle */}
      {props.onAutoStartChange && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="autoStartLive" className="flex items-center gap-2 text-sm font-medium">
                <Timer
                  className={`h-4 w-4 ${props.autoStartEnabled ? 'text-primary' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
                {t('controlCenter.heating.autoStart')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('controlCenter.heating.autoStartDescription')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('controlCenter.heating.autoStartAppOpenNote')}
              </p>
            </div>
            <Switch
              id="autoStartLive"
              checked={props.autoStartEnabled ?? false}
              onCheckedChange={props.onAutoStartChange}
            />
          </div>
          {props.autoStartEnabled && props.autoStartArmed && (
            <p className="mt-2 text-xs font-medium text-primary">
              {t('controlCenter.heating.autoStartArmed', {
                seconds: Math.ceil((props.autoStartRemainingMs ?? 0) / 1000),
              })}
            </p>
          )}
        </div>
      )}

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-3xl gap-3">
          <Button type="button" className="flex-1" onClick={props.onStart} disabled={props.startDisabled}>
            {t('controlCenter.actions.start')}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                {t('controlCenter.actions.abort')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('controlCenter.confirm.abortTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('controlCenter.confirm.abortDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={props.onAbort}>{t('common.confirm')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}
