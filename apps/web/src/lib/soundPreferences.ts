/**
 * Sound effect preferences — localStorage persistence + cross-component reactivity.
 *
 * Follows the same pattern as aiPreferences.ts: simple get/set with
 * CustomEvent dispatch so any listener (React effect, vanilla handler)
 * can react to changes without a Context provider.
 */

import { STORAGE_KEYS } from '@/lib/constants'

export const SOUND_PREFS_CHANGED_EVENT = 'meticai-sound-prefs-changed'

/** Sound effects are opt-in — default OFF. */
export function getSoundsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.SOUNDS_ENABLED) === 'true'
  } catch {
    return false
  }
}

export function setSoundsEnabled(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SOUNDS_ENABLED, String(value))
    window.dispatchEvent(new CustomEvent(SOUND_PREFS_CHANGED_EVENT, { detail: { enabled: value } }))
  } catch {
    // no-op
  }
}
