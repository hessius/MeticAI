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
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
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
import { startShot, stopShot, abortShot, preheat, tareScale } from '@/lib/mqttCommands'
import { ControlCenterExpanded } from './ControlCenterExpanded'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ControlCenterProps {
  machineState: MachineState
  onOpenLiveView?: () => void
  compact?: boolean   // mobile layout
}

// ---------------------------------------------------------------------------
// State badge helper
// ---------------------------------------------------------------------------

function stateBadge(state: string | null, brewing: boolean, t: ReturnType<typeof import('react-i18next').useTranslation>['t']) {
  if (brewing) {
    return (
      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 animate-pulse">
        {t('controlCenter.states.brewing')}
      </Badge>
    )
  }
  const map: Record<string, { cls: string; key: string }> = {
    idle:        { cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40', key: 'idle' },
    heating:     { cls: 'bg-orange-500/20 text-orange-400 border-orange-500/40', key: 'heating' },
    preheating:  { cls: 'bg-orange-500/20 text-orange-400 border-orange-500/40', key: 'preheating' },
    steaming:    { cls: 'bg-purple-500/20 text-purple-400 border-purple-500/40', key: 'steaming' },
    descaling:   { cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40', key: 'descaling' },
  }
  const entry = map[state ?? ''] ?? { cls: 'bg-muted text-muted-foreground border-muted', key: 'unknown' }
  return (
    <Badge className={entry.cls}>
      {t(`controlCenter.states.${entry.key}`)}
    </Badge>
  )
}

function connectionDot(machineState: MachineState) {
  if (!machineState._wsConnected) return 'bg-gray-400'
  if (machineState.availability === 'offline') return 'bg-red-500'
  if (machineState._stale) return 'bg-amber-400'
  if (machineState.connected) return 'bg-emerald-400'
  return 'bg-gray-400'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ControlCenter({ machineState, onOpenLiveView, compact }: ControlCenterProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

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
        <div className="flex items-center gap-2 text-red-400">
          <Warning size={18} weight="fill" />
          <span className="text-sm font-medium">{t('controlCenter.offline')}</span>
        </div>
      </Card>
    )
  }

  const isIdle = machineState.state === 'idle' && !machineState.brewing
  const isBrewing = machineState.brewing

  return (
    <Card className={`p-4 space-y-3 ${machineState._stale ? 'border-amber-500/30' : ''}`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coffee size={18} weight="duotone" className="text-primary" />
          <span className="text-sm font-semibold text-foreground">Meticulous</span>
        </div>
        <div className="flex items-center gap-2">
          {machineState._stale && (
            <span className="text-[10px] text-amber-400">{t('controlCenter.stale')}</span>
          )}
          <span className={`h-2.5 w-2.5 rounded-full ${connectionDot(machineState)}`} />
        </div>
      </div>

      {/* ── IDLE STATE ─────────────────────────────────── */}
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
              {machineState.target_temperature != null && (
                <span className="text-xs text-muted-foreground ml-1">
                  / {machineState.target_temperature.toFixed(0)}°C
                </span>
              )}
            </div>
            {stateBadge(machineState.state, false, t)}
          </div>

          {/* Active profile + total shots */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate max-w-[60%]">
              {machineState.active_profile ?? t('controlCenter.noProfile')}
            </span>
            {machineState.total_shots != null && (
              <span>{t('controlCenter.totalShots', { count: machineState.total_shots })}</span>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex gap-2">
            <Button
              variant="dark-brew"
              size="sm"
              className="flex-1 h-9 text-xs"
              disabled={!isIdle || !machineState.connected}
              onClick={() => cmd(startShot, 'startingSshot')}
            >
              <Play size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.start')}
            </Button>
            <Button
              variant="dark-brew"
              size="sm"
              className="flex-1 h-9 text-xs"
              disabled={!isIdle || !machineState.connected}
              onClick={() => cmd(preheat, 'preheating')}
            >
              <Fire size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.preheat')}
            </Button>
            <Button
              variant="dark-brew"
              size="sm"
              className="flex-1 h-9 text-xs"
              disabled={!machineState.connected}
              onClick={() => cmd(tareScale, 'tared')}
            >
              <Scales size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.tare')}
            </Button>
          </div>
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
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 h-9 text-xs"
              onClick={() => cmd(stopShot, 'stopping')}
            >
              <Stop size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.stop')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 h-9 text-xs"
              onClick={() => cmd(abortShot, 'aborting')}
            >
              <XCircle size={14} weight="fill" className="mr-1" />
              {t('controlCenter.actions.abort')}
            </Button>
            {onOpenLiveView && (
              <Button
                variant="dark-brew"
                size="sm"
                className="flex-1 h-9 text-xs"
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

      {/* Expanded panel (inline on desktop, same card) */}
      <AnimatePresence>
        {expanded && !isBrewing && !compact && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ControlCenterExpanded machineState={machineState} />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
