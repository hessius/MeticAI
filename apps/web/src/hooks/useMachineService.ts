/**
 * useMachineService — hook for accessing the MachineService.
 *
 * Provides type-safe access to machine commands within React components.
 * Must be used within a MachineServiceProvider context.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const machine = useMachineService()
 *   const handleStart = () => machine.startShot()
 *   // ...
 * }
 * ```
 */

import { useContext } from 'react'
import { MachineServiceContext } from '@/services/machine/MachineServiceContext'
import type { MachineService } from '@/services/machine/MachineService'

/**
 * Hook to access the MachineService instance.
 *
 * @throws Error if used outside of MachineServiceProvider
 * @returns The current MachineService implementation
 */
export function useMachineService(): MachineService {
  const service = useContext(MachineServiceContext)

  if (!service) {
    throw new Error(
      'useMachineService must be used within a MachineServiceProvider. ' +
        'Wrap your app root with <MachineServiceProvider> to fix this error.',
    )
  }

  return service
}
