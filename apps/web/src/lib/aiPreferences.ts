const STORAGE_KEY = 'meticai-hide-ai-when-unavailable'
const AI_ENABLED_STORAGE_KEY = 'meticai-ai-enabled'
const AUTO_ANALYZE_SHOTS_KEY = 'meticai-auto-analyze-shots'
const SHOW_AI_IN_HISTORY_KEY = 'meticai-show-ai-in-history'
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

export function getAutoAnalyzeShots(): boolean {
  try {
    const value = localStorage.getItem(AUTO_ANALYZE_SHOTS_KEY)
    return value === null ? true : value === 'true'
  } catch {
    return true
  }
}

export function setAutoAnalyzeShots(value: boolean): void {
  try {
    localStorage.setItem(AUTO_ANALYZE_SHOTS_KEY, String(value))
    window.dispatchEvent(new CustomEvent(AI_PREFS_CHANGED_EVENT, { detail: { autoAnalyzeShots: value } }))
  } catch {
    // no-op
  }
}

export function getShowAiInHistory(): boolean {
  try {
    const value = localStorage.getItem(SHOW_AI_IN_HISTORY_KEY)
    return value === null ? true : value === 'true'
  } catch {
    return true
  }
}

export function setShowAiInHistory(value: boolean): void {
  try {
    localStorage.setItem(SHOW_AI_IN_HISTORY_KEY, String(value))
    window.dispatchEvent(new CustomEvent(AI_PREFS_CHANGED_EVENT, { detail: { showAiInHistory: value } }))
  } catch {
    // no-op
  }
}
