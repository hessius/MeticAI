const STORAGE_KEY = 'meticai-hide-ai-when-unavailable'
const AI_ENABLED_STORAGE_KEY = 'meticai-ai-enabled'
const AUTO_SYNC_STORAGE_KEY = 'meticai-auto-sync'
export const AI_PREFS_CHANGED_EVENT = 'meticai-ai-prefs-changed'

export function getHideAiWhenUnavailable(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setHideAiWhenUnavailable(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
    window.dispatchEvent(new CustomEvent(AI_PREFS_CHANGED_EVENT, { detail: { value } }))
  } catch {
    // no-op
  }
}

export function getAiEnabled(): boolean {
  try {
    const value = localStorage.getItem(AI_ENABLED_STORAGE_KEY)
    return value === null ? true : value === 'true'
  } catch {
    return true
  }
}

export function setAiEnabled(value: boolean): void {
  try {
    localStorage.setItem(AI_ENABLED_STORAGE_KEY, String(value))
    window.dispatchEvent(new CustomEvent(AI_PREFS_CHANGED_EVENT, { detail: { value } }))
  } catch {
    // no-op
  }
}

export function getAutoSync(): boolean {
  try {
    return localStorage.getItem(AUTO_SYNC_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setAutoSync(value: boolean): void {
  try {
    localStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(value))
    window.dispatchEvent(new CustomEvent(AI_PREFS_CHANGED_EVENT, { detail: { value } }))
  } catch {
    // no-op
  }
}
