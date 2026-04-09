/**
 * Machine service module exports.
 *
 * This module provides the abstraction layer for machine communication.
 * Use `useMachineService()` hook in components to access machine commands.
 */

export type {
  MachineService,
  CommandResult,
  StatusCallback,
  ActuatorsCallback,
  NotificationCallback,
  ProfileUpdateCallback,
  ConnectionCallback,
  Unsubscribe,
} from './MachineService'
export { MachineServiceProvider, MachineServiceContext, useMachineService } from './MachineServiceContext'
export { createMeticAIAdapter, meticAIAdapter } from './MeticAIAdapter'
export { createDirectAdapter } from './DirectAdapter'
export { getMachineApi, clearMachineApiCache } from './machineApi'
