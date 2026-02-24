/**
 * useMachineActions — shared hook for machine state derivation and
 * toast-wrapped command execution.
 *
 * Eliminates duplication between ControlCenter, ControlCenterExpanded,
 * and LiveShotView. Provides a single source of truth for derived
 * machine state flags (isBrewing, canStart, canAbortWarmup, etc.)
 * and the `cmd()` helper.
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MachineState } from '@/hooks/useWebSocket'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface MachineActions {
  /** Lowercase machine state string */
  stateLC: string
  /** Machine is idle and not brewing */
  isIdle: boolean
  /** Machine is actively brewing */
  isBrewing: boolean
  /** Machine is preheating */
  isPreheating: boolean
  /** Machine is heating (has started a shot, reaching target temp) */
  isHeating: boolean
  /** Machine is ready — "click to start" */
  isReady: boolean
  /** Machine is in pour-water phase (warmup state) */
  isPourWater: boolean
  /** Machine is in post-shot purge prompt state */
  isClickToPurge: boolean
  /** Machine is connected to the network */
  isConnected: boolean
  /** A shot can be started (idle / preheating / ready, not brewing, connected) */
  canStart: boolean
  /** Warmup can be aborted (preheating / heating / pour-water, not brewing, connected) */
  canAbortWarmup: boolean
  /** Execute a machine command with toast feedback */
  cmd: (fn: () => Promise<{ success: boolean; message?: string }>, successKey: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMachineActions(machineState: MachineState): MachineActions {
  const { t } = useTranslation()

  // Derived state — single source of truth
  const stateLC = (machineState.state ?? '').toLowerCase()
  const isIdle = stateLC === 'idle' && !machineState.brewing
  const isBrewing = machineState.brewing
  const isPreheating = stateLC === 'preheating'
  const isHeating = stateLC === 'heating'
  const isReady = stateLC === 'click to start'
  const isPourWater = stateLC.startsWith('pour water')
  const isClickToPurge = stateLC.startsWith('click to purge')
  const isConnected = machineState.connected

  // Machine accepts START during idle, preheat, or "click to start" —
  // not during heating or pour-water (shot already started, reaching target temp)
  const canStart = (isIdle || isPreheating || isReady) && !isBrewing && isConnected

  // Abort is allowed during preheating, heating, or pour-water
  // (non-idle, non-brewing warmup states). Fixes #184 — ControlCenterExpanded
  // was missing isPourWater here.
  const canAbortWarmup = (isPreheating || isHeating || isPourWater) && !isBrewing && isConnected

  // Unified command executor with toast feedback
  const cmd = useCallback(
    async (fn: () => Promise<{ success: boolean; message?: string }>, successKey: string) => {
      try {
        const res = await fn()
        if (res.success) {
          toast.success(t(`controlCenter.toasts.${successKey}`))
        } else {
          toast.error(res.message ?? t('controlCenter.toasts.error'))
        }
      } catch {
        toast.error(t('controlCenter.toasts.error'))
      }
    },
    [t],
  )

  return {
    stateLC,
    isIdle,
    isBrewing,
    isPreheating,
    isHeating,
    isReady,
    isPourWater,
    isClickToPurge,
    isConnected,
    canStart,
    canAbortWarmup,
    cmd,
  }
}
