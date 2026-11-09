/**
 * Belka Portal hooks.
 *
 * - `usePortalRecorder(machineState)` — mount once, high in the tree (App), so
 *   the Portal's EC stream is recorded for every shot regardless of which view
 *   is open. Also retries parked recordings once the machine is reachable and
 *   surfaces a toast when a recording lands on a shot.
 * - `usePortal()` — read the Portal's live snapshot anywhere.
 * - `usePortalSettings()` — read/write the per-browser Portal preferences.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MachineState } from '@/hooks/useWebSocket'
import {
  getPortalSnapshot,
  recordPortalTelemetry,
  retryPendingPortalRecordings,
  subscribePortal,
  type PortalSnapshot,
} from '@/lib/portalRecorder'
import {
  loadPortalSettings,
  savePortalSettings,
  subscribePortalSettings,
  type PortalSettings,
} from '@/lib/portalSettings'

export function usePortal(): PortalSnapshot {
  return useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalSnapshot)
}

export function usePortalSettings(): [PortalSettings, (patch: Partial<PortalSettings>) => void] {
  const settings = useSyncExternalStore(subscribePortalSettings, loadPortalSettings, loadPortalSettings)
  const update = useCallback((patch: Partial<PortalSettings>) => {
    savePortalSettings(patch)
  }, [])
  return [settings, update]
}

export function usePortalRecorder(machineState: MachineState): void {
  const { t } = useTranslation()
  const retriedRef = useRef(false)

  useEffect(() => {
    recordPortalTelemetry(machineState)
  }, [machineState])

  // Once the machine is reachable, attach any recordings parked by an earlier session.
  useEffect(() => {
    if (!machineState.connected || retriedRef.current || !loadPortalSettings().enabled) return
    retriedRef.current = true
    void retryPendingPortalRecordings().then((n) => {
      if (n > 0) toast.success(t('portal.toast.pendingAttached', { count: n }))
    })
  }, [machineState.connected, t])

  useEffect(() => {
    const onSaved = (ev: Event) => {
      const d = (ev as CustomEvent<{ sampleCount: number }>).detail
      toast.success(t('portal.toast.saved', { count: d.sampleCount }))
    }
    window.addEventListener('meticai:portal-saved', onSaved)
    return () => window.removeEventListener('meticai:portal-saved', onSaved)
  }, [t])
}
