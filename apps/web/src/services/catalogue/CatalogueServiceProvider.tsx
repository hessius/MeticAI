/**
 * CatalogueServiceProvider — React context for catalogue service injection.
 *
 * In proxy mode (Docker), uses ProxyCatalogueService.
 * In direct mode (PWA/Capacitor), uses DirectCatalogueService.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CatalogueService } from './CatalogueService'
import { createProxyCatalogueService } from './ProxyCatalogueService'
import { createDirectCatalogueService } from './DirectCatalogueService'
import { getMachineMode, getDefaultMachineUrl } from '@/lib/machineMode'
import { STORAGE_KEYS } from '@/lib/constants'
import { MACHINE_URL_CHANGED } from '@/services/machine/MachineServiceContext'

const CatalogueServiceContext = createContext<CatalogueService | null>(null)

export function useCatalogueService(): CatalogueService {
  const ctx = useContext(CatalogueServiceContext)
  if (!ctx) throw new Error('useCatalogueService must be used within CatalogueServiceProvider')
  return ctx
}

interface CatalogueServiceProviderProps {
  children: ReactNode
  service?: CatalogueService
}

export function CatalogueServiceProvider({ children, service }: CatalogueServiceProviderProps) {
  const [machineUrl, setMachineUrl] = useState(getDefaultMachineUrl)

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
    return getMachineMode() === 'direct'
      ? createDirectCatalogueService(machineUrl)
      : createProxyCatalogueService()
  }, [service, machineUrl])

  return (
    <CatalogueServiceContext.Provider value={value}>
      {children}
    </CatalogueServiceContext.Provider>
  )
}
