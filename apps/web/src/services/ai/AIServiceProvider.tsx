/**
 * AIServiceProvider — React context for AI service injection.
 *
 * In proxy mode (Docker), uses ProxyAIService.
 * In direct mode (PWA/Capacitor), uses BrowserAIService.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { AIService } from './AIService'
import { createProxyAIService } from './ProxyAIService'
import { createBrowserAIService } from './BrowserAIService'
import { getMachineMode } from '@/lib/machineMode'

const AIServiceContext = createContext<AIService | null>(null)

export function useAIService(): AIService {
  const ctx = useContext(AIServiceContext)
  if (!ctx) throw new Error('useAIService must be used within AIServiceProvider')
  return ctx
}

interface AIServiceProviderProps {
  children: ReactNode
  service?: AIService
}

export function AIServiceProvider({ children, service }: AIServiceProviderProps) {
  const value = useMemo(() => {
    if (service) return service
    return getMachineMode() === 'direct'
      ? createBrowserAIService()
      : createProxyAIService()
  }, [service])

  return (
    <AIServiceContext.Provider value={value}>
      {children}
    </AIServiceContext.Provider>
  )
}
