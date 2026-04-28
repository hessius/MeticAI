/**
 * CatalogueServiceProvider — React context for catalogue service injection.
 *
 * In proxy mode (Docker), uses ProxyCatalogueService.
 * In direct mode (PWA/Capacitor), uses DirectCatalogueService.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { CatalogueService } from './CatalogueService'
import { createProxyCatalogueService } from './ProxyCatalogueService'
import { createDirectCatalogueService } from './DirectCatalogueService'
import { createDemoCatalogueService } from './DemoCatalogueService'
import { getMachineMode } from '@/lib/machineMode'
import { useResolvedMachineUrl } from '@/services/machine/useResolvedMachineUrl'

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
  const mode = getMachineMode()
  const machineUrl = useResolvedMachineUrl(!service && mode === 'direct')

  const value = useMemo(() => {
    if (service) return service
    if (mode === 'demo') return createDemoCatalogueService()
    if (mode === 'direct') {
      if (!machineUrl) return null
      return createDirectCatalogueService(machineUrl)
    }
    return createProxyCatalogueService()
  }, [mode, service, machineUrl])

  if (!value) return null

  return (
    <CatalogueServiceContext.Provider value={value}>
      {children}
    </CatalogueServiceContext.Provider>
  )
}
