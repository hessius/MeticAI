/** Persist the compass taste a user supplied for a given shot (U3). */

export interface StoredTaste {
  x: number
  y: number
  descriptors: string[]
}

export function shotTasteKey(profileName: string, date: string, filename: string): string {
  return `shot-taste:${profileName}|${date}|${filename}`
}

export function saveShotTaste(profileName: string, date: string, filename: string, taste: StoredTaste): void {
  try {
    localStorage.setItem(shotTasteKey(profileName, date, filename), JSON.stringify(taste))
  } catch {
    // storage unavailable (private mode / quota) — non-critical
  }
}

export function loadShotTaste(profileName: string, date: string, filename: string): StoredTaste | null {
  try {
    const raw = localStorage.getItem(shotTasteKey(profileName, date, filename))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredTaste
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number' && Array.isArray(parsed.descriptors)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}
