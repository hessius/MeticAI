/**
 * MachineService interface — abstraction layer for machine communication.
 *
 * Defines all operations that can be performed against a Meticulous espresso
 * machine. Two implementations exist:
 *
 * - **MeticAIAdapter** — delegates to the MeticAI FastAPI backend (Docker mode)
 * - **DirectAdapter** — talks directly to the machine via @meticulous-home/espresso-api (PWA mode)
 */

import type { Profile } from '@meticulous-home/espresso-profile'
import type {
  ActionType,
  Actuators,
  DeviceInfo,
  HistoryListingEntry,
  Notification as MachineNotification,
  ProfileIdent,
  Settings as MachineSettings,
  StatusData,
} from '@meticulous-home/espresso-api'

// Re-export for convenience
export type { Profile, ProfileIdent, StatusData, Actuators, MachineNotification, MachineSettings, DeviceInfo, ActionType }

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CommandResult {
  success: boolean
  message?: string
}

// ---------------------------------------------------------------------------
// Telemetry callback types
// ---------------------------------------------------------------------------

export type StatusCallback = (data: StatusData) => void
export type ActuatorsCallback = (data: Actuators) => void
export type NotificationCallback = (data: MachineNotification) => void
export type ProfileUpdateCallback = (data: { change: string; profile_id?: string }) => void
export type HeaterStatusCallback = (countdown: number) => void
export type ConnectionCallback = (connected: boolean) => void
export type Unsubscribe = () => void

// ---------------------------------------------------------------------------
// Main Interface
// ---------------------------------------------------------------------------

export interface MachineService {
  readonly name: string

  // -- Connection -----------------------------------------------------------
  connect(url: string): Promise<void>
  disconnect(): void
  isConnected(): boolean
  onConnectionChange(cb: ConnectionCallback): Unsubscribe

  // -- Commands (brewing) ---------------------------------------------------
  startShot(): Promise<CommandResult>
  stopShot(): Promise<CommandResult>
  abortShot(): Promise<CommandResult>
  continueShot(): Promise<CommandResult>

  // -- Commands (machine) ---------------------------------------------------
  preheat(): Promise<CommandResult>
  tareScale(): Promise<CommandResult>
  homePlunger(): Promise<CommandResult>
  purge(): Promise<CommandResult>

  // -- Commands (config) ----------------------------------------------------
  loadProfile(name: string): Promise<CommandResult>
  loadProfileFromJSON(profile: Profile): Promise<CommandResult>
  setBrightness(value: number): Promise<CommandResult>
  enableSounds(enabled: boolean): Promise<CommandResult>

  // -- Profiles -------------------------------------------------------------
  listProfiles(): Promise<ProfileIdent[]>
  fetchAllProfiles(): Promise<Profile[]>
  getProfile(id: string): Promise<Profile>
  saveProfile(profile: Profile): Promise<ProfileIdent>
  deleteProfile(id: string): Promise<void>

  // -- Telemetry (real-time) ------------------------------------------------
  onStatus(cb: StatusCallback): Unsubscribe
  onActuators(cb: ActuatorsCallback): Unsubscribe
  onHeaterStatus(cb: HeaterStatusCallback): Unsubscribe
  onNotification(cb: NotificationCallback): Unsubscribe
  onProfileUpdate(cb: ProfileUpdateCallback): Unsubscribe

  // -- History --------------------------------------------------------------
  getHistoryListing(): Promise<HistoryListingEntry[]>
  getLastShot(): Promise<HistoryListingEntry | null>

  // -- Settings / Device ----------------------------------------------------
  getSettings(): Promise<MachineSettings>
  updateSetting(settings: Partial<MachineSettings>): Promise<MachineSettings>
  getDeviceInfo(): Promise<DeviceInfo>
}

// Legacy sub-interfaces kept for backward compatibility with existing code
export type BrewingCommands = Pick<MachineService, 'startShot' | 'stopShot' | 'abortShot' | 'continueShot'>
export type MachineCommands = Pick<MachineService, 'preheat' | 'tareScale' | 'homePlunger' | 'purge'>
export type ConfigCommands = Pick<MachineService, 'loadProfile' | 'setBrightness' | 'enableSounds'>
