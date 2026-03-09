/**
 * MachineServiceContext — React context for machine service injection.
 *
 * Provides dependency injection for the MachineService interface,
 * enabling components to consume machine commands without direct
 * coupling to the implementation.
 */

import { createContext, useMemo, type ReactNode } from 'react'
import type { MachineService } from './MachineService'
import { meticAIAdapter } from './MeticAIAdapter'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const MachineServiceContext = createContext<MachineService | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface MachineServiceProviderProps {
  children: ReactNode
  /** Optional custom service implementation (defaults to MeticAIAdapter) */
  service?: MachineService
}

/**
 * Provider component for MachineService.
 *
 * Wrap this around your app root to make the machine service available
 * to all components via the `useMachineService()` hook.
 *
 * @example
 * ```tsx
 * <MachineServiceProvider>
 *   <App />
 * </MachineServiceProvider>
 * ```
 */
export function MachineServiceProvider({
  children,
  service,
}: MachineServiceProviderProps) {
  // Memoize to prevent unnecessary re-renders
  const value = useMemo(() => service ?? meticAIAdapter, [service])

  return (
    <MachineServiceContext.Provider value={value}>
      {children}
    </MachineServiceContext.Provider>
  )
}
