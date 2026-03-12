/**
 * Machine service module exports.
 *
 * This module provides the abstraction layer for machine communication.
 * Use `useMachineService()` hook in components to access machine commands.
 */

export type { MachineService, CommandResult } from './MachineService'
export { MachineServiceProvider, MachineServiceContext } from './MachineServiceContext'
export { createMeticAIAdapter, meticAIAdapter } from './MeticAIAdapter'
