/**
 * Sound effect preferences — localStorage persistence + cross-component reactivity.
 *
 * Follows the same pattern as aiPreferences.ts: simple get/set with
 * CustomEvent dispatch so any listener (React effect, vanilla handler)
 * can react to changes without a Context provider.
 */

const SOUNDS_ENABLED_KEY = 'meticai-sounds-enabled'
export const SOUND_PREFS_CHANGED_EVENT = 'meticai-sound-prefs-changed'

/** Sound effects are opt-in — default OFF. */
export function getSoundsEnabled(): boolean {
  try {
    return localStorage.getItem(SOUNDS_ENABLED_KEY) === 'true'
  } catch {
    return false
  }
}

export function setSoundsEnabled(value: boolean): void {
  try {
    localStorage.setItem(SOUNDS_ENABLED_KEY, String(value))
    window.dispatchEvent(new CustomEvent(SOUND_PREFS_CHANGED_EVENT, { detail: { enabled: value } }))
  } catch {
    // no-op
  }
}
