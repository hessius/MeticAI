/**
 * ShotDataServiceProvider — React context for shot data service injection.
 *
 * In proxy mode (Docker), uses ProxyShotDataService.
 * In direct mode (PWA/Capacitor), uses DirectShotDataService.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ShotDataService } from './ShotDataService'
import { createProxyShotDataService } from './ProxyShotDataService'
import { createDirectShotDataService } from './DirectShotDataService'
import { createDemoShotDataService } from './DemoShotDataService'
import { getMachineMode } from '@/lib/machineMode'
import { useResolvedMachineUrl } from '@/services/machine/useResolvedMachineUrl'

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
  const mode = getMachineMode()
  const machineUrl = useResolvedMachineUrl(!service && mode === 'direct')

  const value = useMemo(() => {
    if (service) return service
    if (mode === 'demo') return createDemoShotDataService()
    if (mode === 'direct') {
      if (!machineUrl) return null
      return createDirectShotDataService(machineUrl)
    }
    return createProxyShotDataService()
  }, [mode, service, machineUrl])

  if (!value) return null

  return (
    <ShotDataServiceContext.Provider value={value}>
      {children}
    </ShotDataServiceContext.Provider>
  )
}
