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
 * The machine URL is reactive — changing it via setMachineUrl() and
 * dispatching a 'machine-url-changed' event will recreate the adapter.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MachineService } from './MachineService'
import { meticAIAdapter } from './MeticAIAdapter'
import { createDirectAdapter } from './DirectAdapter'
import { getMachineMode, getDefaultMachineUrl } from '@/lib/machineMode'
import { STORAGE_KEYS } from '@/lib/constants'

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
// Machine URL change event (dispatched by settings/discovery)
// ---------------------------------------------------------------------------

export const MACHINE_URL_CHANGED = 'machine-url-changed'

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
  // Track machine URL so adapter is recreated when it changes
  const [machineUrl, setMachineUrl] = useState(getDefaultMachineUrl)

  // Listen for machine URL changes (from settings, discovery, etc.)
  useEffect(() => {
    const handler = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEYS.MACHINE_URL)
        if (stored && stored !== machineUrl) setMachineUrl(stored)
      } catch { /* noop */ }
    }
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.MACHINE_URL) handler()
    }
    window.addEventListener(MACHINE_URL_CHANGED, handler)
    window.addEventListener('storage', storageHandler)
    return () => {
      window.removeEventListener(MACHINE_URL_CHANGED, handler)
      window.removeEventListener('storage', storageHandler)
    }
  }, [machineUrl])

  const value = useMemo(() => {
    if (service) return service
    const mode = getMachineMode()
    if (mode === 'direct') {
      return createDirectAdapter(machineUrl)
    }
    return meticAIAdapter
  }, [service, machineUrl])

  // Connect/disconnect the active adapter
  useEffect(() => {
    value.connect(machineUrl).catch((err) => {
      console.error('[MachineService] Failed to connect:', err)
    })
    return () => value.disconnect()
  }, [value, machineUrl])

  return (
    <MachineServiceContext.Provider value={value}>
      {children}
    </MachineServiceContext.Provider>
  )
}
