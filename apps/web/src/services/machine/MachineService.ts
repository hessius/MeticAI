/**
 * MachineService interface — abstraction layer for machine communication.
 *
 * This interface defines all commands and telemetry operations that can be
 * performed against a Meticulous espresso machine. The default implementation
 * (MeticAIAdapter) delegates to the MeticAI backend REST API, but alternative
 * implementations could target the machine directly or provide mock behavior.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a machine command execution */
export interface CommandResult {
  success: boolean
  message?: string
}

/** Brewing-related commands */
export interface BrewingCommands {
  /** Start a shot (machine must be idle or ready) */
  startShot(): Promise<CommandResult>

  /** Stop a shot gracefully (machine must be brewing) */
  stopShot(): Promise<CommandResult>

  /** Abort a shot immediately (machine must be brewing) */
  abortShot(): Promise<CommandResult>

  /** Continue past a prompt / hold stage */
  continueShot(): Promise<CommandResult>
}

/** Machine control commands */
export interface MachineCommands {
  /** Start pre-heating (machine must be idle) */
  preheat(): Promise<CommandResult>

  /** Tare the scale */
  tareScale(): Promise<CommandResult>

  /** Home the plunger */
  homePlunger(): Promise<CommandResult>

  /** Run a purge cycle (machine must be idle) */
  purge(): Promise<CommandResult>
}

/** Configuration commands */
export interface ConfigCommands {
  /** Load a profile by name */
  loadProfile(name: string): Promise<CommandResult>

  /** Set display brightness (0–100) */
  setBrightness(value: number): Promise<CommandResult>

  /** Enable or disable sounds */
  enableSounds(enabled: boolean): Promise<CommandResult>
}

// ---------------------------------------------------------------------------
// Main Interface
// ---------------------------------------------------------------------------

/**
 * Complete interface for machine service operations.
 *
 * Combines brewing, machine, and config commands into a single facade.
 * Components should use `useMachineService()` hook to access this interface.
 */
export interface MachineService extends BrewingCommands, MachineCommands, ConfigCommands {
  /** Service name for debugging/logging */
  readonly name: string
}
