/**
 * MachineServiceContext — React context for machine service injection.
 *
 * Provides dependency injection for the MachineService interface,
 * enabling components to consume machine commands without direct
 * coupling to the implementation.
 *
 * In proxy mode (Docker), uses MeticAIAdapter.
 * In direct mode (PWA/Capacitor), uses DirectAdapter.
 *
 * The machine URL is reactive — changing it via persistMachineUrl() and
 * dispatching a 'machine-url-changed' event will recreate the adapter.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { MachineService } from './MachineService'
import { meticAIAdapter } from './MeticAIAdapter'
import { createDirectAdapter } from './DirectAdapter'
import { createDemoAdapter } from './DemoAdapter'
import { getMachineMode } from '@/lib/machineMode'
import { useResolvedMachineUrl } from './useResolvedMachineUrl'
import { resolveAndHealMachineUrl } from './discovery'

/** How long to wait for a first successful connection before assuming the
 *  stored URL is stale and re-running full discovery (IP change recovery). */
const REDISCOVER_AFTER_MS = 8_000

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const MachineServiceContext = createContext<MachineService | null>(null)

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMachineService(): MachineService {
  const ctx = useContext(MachineServiceContext)
  if (!ctx) throw new Error('useMachineService must be used within MachineServiceProvider')
  return ctx
}

/**
 * Non-throwing variant — returns null when no provider is mounted. Used by
 * top-level consumers (e.g. the widget deep-link effect) that must not crash
 * when rendered outside a MachineServiceProvider (such as in unit tests).
 */
export function useOptionalMachineService(): MachineService | null {
  return useContext(MachineServiceContext)
}

// ---------------------------------------------------------------------------
// Machine URL change event (dispatched by settings/discovery)
// ---------------------------------------------------------------------------

export { MACHINE_URL_CHANGED } from './machineUrl'

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface MachineServiceProviderProps {
  children: ReactNode
  service?: MachineService
}

export function MachineServiceProvider({
  children,
  service,
}: MachineServiceProviderProps) {
  const mode = getMachineMode()
  const machineUrl = useResolvedMachineUrl(!service && mode === 'direct')

  const value = useMemo(() => {
    if (service) return service
    if (mode === 'demo') {
      return createDemoAdapter()
    }
    if (mode === 'direct') {
      return createDirectAdapter(machineUrl)
    }
    return meticAIAdapter
  }, [mode, service, machineUrl])

  // Connect/disconnect the active adapter
  useEffect(() => {
    if (!value) return
    value.connect(machineUrl).catch((err) => {
      console.error('[MachineService] Failed to connect:', err)
    })

    // Recovery: if the machine never connects on the stored URL (e.g. DHCP moved
    // it to a new IP), re-run full discovery once and adopt the machine's current
    // address. persistMachineUrl() fires MACHINE_URL_CHANGED, which re-resolves
    // the URL here and rebuilds the adapter against the healed address. Only
    // direct mode talks to a discoverable machine on the LAN.
    let rediscoverTimer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | undefined
    if (mode === 'direct') {
      const armRediscover = () => {
        if (rediscoverTimer) return
        rediscoverTimer = setTimeout(() => {
          rediscoverTimer = null
          if (value.isConnected()) return
          void resolveAndHealMachineUrl(machineUrl).catch(() => {})
        }, REDISCOVER_AFTER_MS)
      }
      unsubscribe = value.onConnectionChange((connected) => {
        if (connected) {
          if (rediscoverTimer) { clearTimeout(rediscoverTimer); rediscoverTimer = null }
        } else {
          armRediscover()
        }
      })
      if (!value.isConnected()) armRediscover()
    }

    return () => {
      if (rediscoverTimer) clearTimeout(rediscoverTimer)
      unsubscribe?.()
      value.disconnect()
    }
  }, [value, machineUrl, mode])

  return (
    <MachineServiceContext.Provider value={value}>
      {children}
    </MachineServiceContext.Provider>
  )
}
