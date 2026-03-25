/**
 * MachineServiceContext — React context for machine service injection.
 *
 * Provides dependency injection for the MachineService interface,
 * enabling components to consume machine commands without direct
 * coupling to the implementation.
 *
 * In proxy mode (Docker), uses MeticAIAdapter.
 * In direct mode (PWA/Capacitor), uses DirectAdapter.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { MachineService } from './MachineService'
import { meticAIAdapter } from './MeticAIAdapter'
import { createDirectAdapter } from './DirectAdapter'
import { getMachineMode, getDefaultMachineUrl } from '@/lib/machineMode'

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
  const value = useMemo(() => {
    if (service) return service
    const mode = getMachineMode()
    if (mode === 'direct') {
      return createDirectAdapter(getDefaultMachineUrl())
    }
    return meticAIAdapter
  }, [service])

  // Connect/disconnect the active adapter (MeticAIAdapter.connect is a safe no-op)
  useEffect(() => {
    value.connect(getDefaultMachineUrl()).catch((err) => {
      console.error('[MachineService] Failed to connect:', err)
    })
    return () => value.disconnect()
  }, [value])

  return (
    <MachineServiceContext.Provider value={value}>
      {children}
    </MachineServiceContext.Provider>
  )
}
