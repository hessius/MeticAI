/**
 * ControlCenter — the compact machine-status widget that sits
 * in the right column (desktop) or above the main card (mobile).
 *
 * It shows:
 *  • Connection status
 *  • Temperature + machine state
 *  • Quick-action buttons (idle) or live shot metrics (brewing)
 *  • An expand toggle that reveals ControlCenterExpanded
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import confetti from 'canvas-confetti'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Play,
  Stop,
  Fire,
  Scales,
  CaretDown,
  CaretUp,
  Eye,
  XCircle,
  Thermometer,
  Coffee,
  Warning,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { MachineState } from '@/hooks/useWebSocket'
import { startShot, continueShot, stopShot, abortShot, preheat, tareScale } from '@/lib/mqttCommands'
import { relativeTime } from '@/lib/timeUtils'
import { getServerUrl } from '@/lib/config'
import { ControlCenterExpanded } from './ControlCenterExpanded'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ControlCenterProps {
  machineState: MachineState
  onOpenLiveView?: () => void
}

// ---------------------------------------------------------------------------
// State badge helper
// ---------------------------------------------------------------------------

function stateBadge(state: string | null, brewing: boolean, t: ReturnType<typeof import('react-i18next').useTranslation>['t']) {
  if (brewing) {
    return (
      <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/40 animate-pulse">
        {t('controlCenter.states.brewing')}
      </Badge>
    )
  }
  const map: Record<string, { cls: string; key: string }> = {
    idle:              { cls: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/40', key: 'idle' },
    heating:           { cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40', key: 'heating' },
    preheating:        { cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/40 animate-pulse', key: 'preheating' },
    steaming:          { cls: 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/40', key: 'steaming' },
    descaling:         { cls: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/40', key: 'descaling' },
    'pour water':      { cls: 'bg-sky-500/20 text-sky-700 dark:text-sky-400 border-sky-500/40 animate-pulse', key: 'pourWater' },
    'click to start':  { cls: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 animate-pulse', key: 'ready' },
  }
  // Handle partial/truncated states from the machine (e.g. "Pour water...")
  const normalised = (state ?? '').toLowerCase()
  const matchedKey = normalised.startsWith('pour water') ? 'pour water' : normalised
  const entry = map[matchedKey] ?? { cls: 'bg-muted text-muted-foreground border-muted', key: 'unknown' }
  return (
    <Badge className={entry.cls}>
      {t(`controlCenter.states.${entry.key}`)}
    </Badge>
  )
}

function connectionDot(machineState: MachineState) {
  if (!machineState._wsConnected) return { dot: 'bg-gray-400', key: 'disconnected' }
  if (machineState.availability === 'offline') return { dot: 'bg-red-500', key: 'offline' }
  if (machineState._stale) return { dot: 'bg-amber-400', key: 'stale' }
  if (machineState.connected) return { dot: 'bg-emerald-400', key: 'connected' }
  return { dot: 'bg-gray-400', key: 'connecting' }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ControlCenter({ machineState, onOpenLiveView }: ControlCenterProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const prevShotsRef = useRef<number | null>(null)
  const [profileImgUrl, setProfileImgUrl] = useState<string | null>(null)
  const [profileAuthor, setProfileAuthor] = useState<string | null>(null)

  // Build the profile image URL when active_profile changes
  useEffect(() => {
    let cancelled = false
    if (!machineState.active_profile) { setProfileImgUrl(null); setProfileAuthor(null); return }
    ;(async () => {
      const base = await getServerUrl()
      if (!cancelled) {
        setProfileImgUrl(`${base}/api/profile/${encodeURIComponent(machineState.active_profile!)}/image-proxy`)
      }
      // Fetch profile author from machine profiles
      try {
        const res = await fetch(`${base}/api/machine/profiles`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          const match = (data.profiles ?? []).find(
            (p: { name: string; author?: string }) => p.name === machineState.active_profile
          )
          setProfileAuthor(match?.author ?? null)
        }
      } catch {
        // Silently ignore — author just won't show
      }
    })()
    return () => { cancelled = true }
  }, [machineState.active_profile])

  // 🎉 Confetti celebration for every 100th shot
  useEffect(() => {
    const shots = machineState.total_shots
    if (shots == null) return
    const prev = prevShotsRef.current
    prevShotsRef.current = shots
    // Only fire when total_shots *crosses* a 100 boundary (not on initial load)
    if (prev != null && prev !== shots && shots > 0 && shots % 100 === 0) {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } })
    }
  }, [machineState.total_shots])

  // Command helpers with toast feedback
  const cmd = useCallback(
    async (fn: () => Promise<{ success: boolean; message?: string }>, successKey: string) => {
      const res = await fn()
      if (res.success) {
        toast.success(t(`controlCenter.toasts.${successKey}`))
      } else {
        toast.error(res.message ?? t('controlCenter.toasts.error'))
      }
    },
    [t],
  )

  // ── Not connected yet (skeleton) ──────────────────────────
  if (!machineState._wsConnected) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-3 rounded-full" />
        </div>
        <Skeleton className="h-8 w-20" />
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 flex-1" />
        </div>
      </Card>
    )
  }

  // ── Offline ───────────────────────────────────────────────
  if (machineState.availability === 'offline') {
    return (
      <Card className="p-4 border-red-500/30">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <Warning size={18} weight="fill" />
          <span className="text-sm font-medium">{t('controlCenter.offline')}</span>
        </div>
      </Card>
    )
  }

  const stateLC = (machineState.state ?? '').toLowerCase()
  const isIdle = stateLC === 'idle' && !machineState.brewing
  const isBrewing = machineState.brewing
  const isPreheating = stateLC === 'preheating'
  const isHeating = stateLC === 'heating'
  const isReady = stateLC === 'click to start'
  const isPourWater = stateLC.startsWith('pour water')
  // Machine accepts START during idle, preheat, heating, ready, or pour water states
  const canStart = (isIdle || isPreheating || isHeating || isReady || isPourWater) && !isBrewing && machineState.connected
  // Abort is allowed during preheating, heating, or pour water (non-idle, non-brewing warmup states)
  const canAbortWarmup = (isPreheating || isHeating || isPourWater) && !isBrewing && machineState.connected

  return (
    <Card className={`p-4 space-y-3 ${machineState._stale ? 'border-amber-500/30' : ''}`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coffee size={18} weight="duotone" className="text-primary" />
          <span className="text-sm font-semibold text-foreground">Meticulous</span>
        </div>
        <div className="flex items-center gap-1.5">
          {(() => {
            const { dot, key } = connectionDot(machineState)
            return (
              <>
                <span className="text-[10px] text-muted-foreground">
                  {t(`controlCenter.connection.${key}`)}
                </span>
                <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              </>
            )
          })()}
        </div>
      </div>

      {/* ── NOT-BREWING STATE ────────────────────────────── */}
      {!isBrewing && (
        <>
          {/* Temperature + state */}
          <div className="flex items-end justify-between">
            <div className="flex items-baseline gap-1.5">
              <Thermometer size={16} className="text-muted-foreground self-center" weight="duotone" />
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {machineState.brew_head_temperature != null
                  ? machineState.brew_head_temperature.toFixed(1)
                  : '—'}
              </span>
              <span className="text-sm text-muted-foreground">°C</span>
              {machineState.target_temperature != null && !isIdle && (
                <span className="text-xs text-muted-foreground ml-1">
                  / {machineState.target_temperature.toFixed(0)}°C
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">{t('controlCenter.labels.status')}</span>
              {stateBadge(machineState.state, false, t)}
            </div>
          </div>

          {/* Preheat countdown — prominent display when preheating */}
          {isPreheating && machineState.preheat_countdown != null && machineState.preheat_countdown > 0 && (() => {
            const secs = Math.ceil(machineState.preheat_countdown)
            const mm = Math.floor(secs / 60)
            const ss = String(secs % 60).padStart(2, '0')
            return (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-400">
                  {mm}:{ss}
                </div>
                <div className="text-[10px] text-orange-600/80 dark:text-orange-400/70">{t('controlCenter.preheat.countdown')}</div>
              </div>
            )
          })()}

          {/* Active profile with image + author */}
          {machineState.active_profile && (
            <div className="space-y-1">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {t('controlCenter.sections.activeProfile')}
              </h4>
              <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                {profileImgUrl ? (
                  <img
                    src={profileImgUrl}
                    alt={machineState.active_profile ?? ''}
                    className="h-full w-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden') }}
                  />
                ) : null}
                <Coffee size={14} className={`text-muted-foreground ${profileImgUrl ? 'hidden' : ''}`} weight="duotone" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs text-foreground font-medium truncate block">
                  {machineState.active_profile}
                </span>
                {profileAuthor && (
                  <span className="text-[10px] text-muted-foreground truncate block">
                    {t('controlCenter.labels.by')} {profileAuthor}
                  </span>
                )}
              </div>
              </div>
            </div>
          )}

          {/* Last shot time + profile name */}
          {machineState.last_shot_time && (
            <div className="text-[10px] text-muted-foreground -mt-1">
              {machineState.last_shot_name
                ? t('controlCenter.lastShot.labelWithProfile', { time: relativeTime(machineState.last_shot_time, t), profile: machineState.last_shot_name })
                : t('controlCenter.lastShot.label', { time: relativeTime(machineState.last_shot_time, t) })}
            </div>
          )}

          {/* Pour-water alert */}
          {isPourWater && (
            <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 text-center">
              <div className="text-sm font-medium text-sky-700 dark:text-sky-400">
                {t('controlCenter.pourWater.alert')}
              </div>
            </div>
          )}

          {/* Quick actions — adapt to preheat/ready/idle state */}
          <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-2">
            {/* Start button — available during idle, preheating, or ready */}
            <Button
              variant="dark-brew"
              size="sm"
              className="flex-1 min-w-0 h-9 text-xs"
              disabled={!canStart}
              onClick={() => cmd((isHeating || isReady || isPourWater) ? continueShot : startShot, 'startingShot')}
            >
              <Play size={14} weight="fill" className="mr-1 shrink-0" />
              {t('controlCenter.actions.start')}
            </Button>
            {/* Preheat / Cancel warmup */}
            {canAbortWarmup ? (
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 min-w-0 h-9 text-xs"
                disabled={!machineState.connected}
                onClick={() => cmd(abortShot, isPreheating ? 'preheatCancelled' : 'warmupCancelled')}
              >
                <XCircle size={14} weight="fill" className="mr-1 shrink-0" />
                {t('controlCenter.actions.abortPreheat')}
              </Button>
            ) : (
              <Button
                variant="dark-brew"
                size="sm"
                className="flex-1 min-w-0 h-9 text-xs"
                disabled={!isIdle || !machineState.connected}
                onClick={() => cmd(preheat, 'preheating')}
              >
                <Fire size={14} weight="fill" className="mr-1 shrink-0" />
                {t('controlCenter.actions.preheat')}
              </Button>
            )}
            <Button
              variant="dark-brew"
              size="sm"
              className="flex-1 min-w-0 h-9 text-xs"
              disabled={!machineState.connected}
              onClick={() => cmd(tareScale, 'tared')}
            >
              <Scales size={14} weight="fill" className="mr-1 shrink-0" />
              {t('controlCenter.actions.tare')}
            </Button>
          </div>

          {/* Live view shortcut during warmup/ready/pour-water */}
          {(isPreheating || isHeating || isReady || isPourWater) && onOpenLiveView && (
            <Button
              variant="dark-brew"
              size="sm"
              className="w-full h-9 text-xs"
              onClick={onOpenLiveView}
            >
              <Eye size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.live')}
            </Button>
          )}
        </>
      )}

      {/* ── BREWING STATE ──────────────────────────────── */}
      {isBrewing && (
        <>
          <div className="flex items-center justify-between">
            {stateBadge(machineState.state, true, t)}
            <span className="text-xs text-muted-foreground tabular-nums">
              <Thermometer size={12} className="inline mr-0.5" weight="duotone" />
              {machineState.brew_head_temperature?.toFixed(1) ?? '—'}°C
            </span>
          </div>

          {/* Live metrics — 2×2 grid */}
          <div className="grid grid-cols-2 gap-2">
            {/* Timer */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.shot_timer != null ? machineState.shot_timer.toFixed(1) : '0.0'}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.time')}</div>
            </div>
            {/* Weight */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.shot_weight != null ? machineState.shot_weight.toFixed(1) : '0.0'}
                {machineState.target_weight != null && (
                  <span className="text-xs text-muted-foreground font-normal">
                    /{machineState.target_weight.toFixed(0)}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.weight')}</div>
            </div>
            {/* Pressure */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.pressure != null ? machineState.pressure.toFixed(1) : '0.0'}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.pressure')}</div>
            </div>
            {/* Flow */}
            <div className="bg-muted/50 rounded-md px-2 py-1.5 text-center">
              <div className="text-lg font-bold tabular-nums text-foreground">
                {machineState.flow_rate != null ? machineState.flow_rate.toFixed(1) : '0.0'}
              </div>
              <div className="text-[10px] text-muted-foreground">{t('controlCenter.metrics.flow')}</div>
            </div>
          </div>

          {/* Brewing actions */}
          <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="h-9 text-xs"
              onClick={() => cmd(stopShot, 'stopping')}
            >
              <Stop size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.stop')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-9 text-xs"
              onClick={() => cmd(abortShot, 'aborting')}
            >
              <XCircle size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.abort')}
            </Button>
            {onOpenLiveView && (
              <Button
                variant="dark-brew"
                size="sm"
                className="h-9 text-xs"
                onClick={onOpenLiveView}
              >
                <Eye size={14} weight="fill" className="mr-1" />
                {t('controlCenter.actions.live')}
              </Button>
            )}
          </div>
        </>
      )}

      {/* Expand / collapse toggle */}
      {!isBrewing && (
        <button
          className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? t('controlCenter.collapse') : t('controlCenter.showAll')}
          {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
        </button>
      )}

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && !isBrewing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ControlCenterExpanded machineState={machineState} profileAuthor={profileAuthor} />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
