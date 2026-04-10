/**
 * ShotDataServiceProvider — React context for shot data service injection.
 *
 * In proxy mode (Docker), uses ProxyShotDataService.
 * In direct mode (PWA/Capacitor), uses DirectShotDataService.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ShotDataService } from './ShotDataService'
import { createProxyShotDataService } from './ProxyShotDataService'
import { createDirectShotDataService } from './DirectShotDataService'
import { createDemoShotDataService } from './DemoShotDataService'
import { getMachineMode, getDefaultMachineUrl } from '@/lib/machineMode'
import { STORAGE_KEYS } from '@/lib/constants'
import { MACHINE_URL_CHANGED } from '@/services/machine/MachineServiceContext'

const ShotDataServiceContext = createContext<ShotDataService | null>(null)

export function useShotDataService(): ShotDataService {
  const ctx = useContext(ShotDataServiceContext)
  if (!ctx) throw new Error('useShotDataService must be used within ShotDataServiceProvider')
  return ctx
}

interface ShotDataServiceProviderProps {
  children: ReactNode
  service?: ShotDataService
}

export function ShotDataServiceProvider({ children, service }: ShotDataServiceProviderProps) {
  const [machineUrl, setMachineUrl] = useState(getDefaultMachineUrl)

  // Listen for machine URL changes
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
    if (mode === 'demo') return createDemoShotDataService()
    return mode === 'direct'
      ? createDirectShotDataService(machineUrl)
      : createProxyShotDataService()
  }, [service, machineUrl])

  return (
    <ShotDataServiceContext.Provider value={value}>
      {children}
    </ShotDataServiceContext.Provider>
  )
}
