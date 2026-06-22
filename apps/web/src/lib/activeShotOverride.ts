/**
 * Tracks the temporary variable overrides for the shot currently being brewed
 * so the live view can show the *effective* targets (e.g. weight) instead of
 * the saved profile's values. Mode-agnostic: set when a shot starts with
 * overrides, cleared when a shot starts without them.
 */
export interface ActiveShotOverride {
  /** Active profile name the override applies to (matches machineState.active_profile). */
  profileName: string
  /** Effective final weight target (grams), when the weight was overridden. */
  finalWeight?: number
}

let _active: ActiveShotOverride | null = null

export function setActiveShotOverride(value: ActiveShotOverride | null): void {
  _active = value
}

export function getActiveShotOverride(): ActiveShotOverride | null {
  return _active
}
