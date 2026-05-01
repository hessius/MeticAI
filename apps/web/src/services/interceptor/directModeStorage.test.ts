import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { STORAGE_KEYS } from '@/lib/constants'
import {
  type AppDBSchema,
  getDB,
  getSetting,
  setAnnotation,
  setSetting,
} from '@/services/storage/AppDatabase'

import {
  DirectStorageValidationError,
  deleteDirectDialInSession,
  deleteDirectProfileImage,
  getDirectAnnotationSummaries,
  getDirectDialInSession,
  getDirectPourOverPreferences,
  getDirectProfileImage,
  listDirectDialInSessions,
  saveDirectDialInSession,
  saveDirectPourOverPreferences,
  saveDirectProfileImage,
} from './directModeStorage'

async function clearAllStores() {
  const db = await getDB()
  const storeNames = [
    'settings',
    'shot-annotations',
    'ai-cache',
    'pour-over-state',
    'dial-in-sessions',
    'profile-images',
  ] as const
  for (const name of storeNames) {
    const tx = db.transaction(name, 'readwrite')
    await tx.store.clear()
    await tx.done
  }
}

describe('directModeStorage adapters', () => {
  beforeEach(async () => {
    localStorage.clear()
    await clearAllStores()
  })

  it('returns backend-compatible shot annotation summaries from IndexedDB', async () => {
    await setAnnotation('2026-01-03/shot-1.json', {
      rating: 4,
      notes: 'Balanced and sweet',
      tags: ['balanced'],
    })
    await setAnnotation('2026-01-03/shot-2.json', {
      rating: null,
      notes: '',
      tags: [],
    })

    await expect(getDirectAnnotationSummaries()).resolves.toEqual({
      status: 'success',
      annotations: {
        '2026-01-03/shot-1.json': { has_annotation: true, rating: 4 },
        '2026-01-03/shot-2.json': { has_annotation: false, rating: null },
      },
    })
  })

  it('persists normalized pour-over preferences through the direct settings store', async () => {
    const saved = await saveDirectPourOverPreferences({
      free: {
        autoStart: false,
        bloomEnabled: false,
        bloomSeconds: 45,
        bloomWeightMultiplier: 3,
        machineIntegration: true,
        doseGrams: 19,
        brewRatio: 16,
      },
      ratio: {
        autoStart: true,
        bloomEnabled: true,
        bloomSeconds: 35,
        bloomWeightMultiplier: 2,
        machineIntegration: false,
        doseGrams: 20,
        brewRatio: 15,
      },
      recipe: {
        machineIntegration: true,
        autoStart: false,
        progressionMode: 'time',
      },
    })

    expect(await getSetting(STORAGE_KEYS.POUR_OVER_PREFS)).toEqual(saved)
    await expect(getDirectPourOverPreferences()).resolves.toEqual(saved)
    expect(localStorage.getItem(STORAGE_KEYS.POUR_OVER_PREFS)).toBeNull()
  })

  it('surfaces corrupt stored pour-over preferences instead of silently defaulting', async () => {
    await setSetting(STORAGE_KEYS.POUR_OVER_PREFS, 'not-an-object')

    await expect(getDirectPourOverPreferences()).rejects.toBeInstanceOf(DirectStorageValidationError)
  })

  it.each([
    ['free'],
    ['ratio'],
    ['recipe'],
  ] as const)('rejects null %s pour-over preferences as corrupt stored data', async (mode) => {
    await setSetting(STORAGE_KEYS.POUR_OVER_PREFS, {
      free: {},
      ratio: {},
      recipe: {},
      [mode]: null,
    })

    await expect(getDirectPourOverPreferences()).rejects.toBeInstanceOf(DirectStorageValidationError)
  })

  it('migrates valid legacy localStorage pour-over preferences into direct settings', async () => {
    localStorage.setItem(STORAGE_KEYS.POUR_OVER_PREFS, JSON.stringify({
      free: {
        autoStart: false,
        bloomEnabled: true,
        bloomSeconds: 40,
        bloomWeightMultiplier: 2.5,
        machineIntegration: false,
        doseGrams: 21,
        brewRatio: 14,
      },
      ratio: {
        autoStart: true,
        bloomEnabled: true,
        bloomSeconds: 30,
        bloomWeightMultiplier: 2,
        machineIntegration: false,
        doseGrams: 18,
        brewRatio: 15,
      },
      recipe: {
        machineIntegration: false,
        autoStart: true,
        progressionMode: 'weight',
      },
    }))

    const migrated = await getDirectPourOverPreferences()

    expect(migrated.free.doseGrams).toBe(21)
    expect(await getSetting(STORAGE_KEYS.POUR_OVER_PREFS)).toEqual(migrated)
    expect(localStorage.getItem(STORAGE_KEYS.POUR_OVER_PREFS)).toBeNull()
  })

  it('surfaces corrupt legacy localStorage pour-over preferences', async () => {
    localStorage.setItem(STORAGE_KEYS.POUR_OVER_PREFS, '{not-json')

    await expect(getDirectPourOverPreferences()).rejects.toBeInstanceOf(DirectStorageValidationError)
  })

  it('returns fresh default preference objects on each read', async () => {
    const first = await getDirectPourOverPreferences()
    first.free.bloomSeconds = 99

    const second = await getDirectPourOverPreferences()

    expect(second.free.bloomSeconds).toBe(30)
  })

  it('persists and deletes direct dial-in sessions through IndexedDB', async () => {
    await saveDirectDialInSession({
      id: 'dial-1',
      coffee: { roast_level: 'medium', origin: 'Ethiopia' },
      profile_name: 'Turbo Bloom',
      iterations: [{
        iteration_number: 1,
        taste: { x: -0.3, y: 0.1, descriptors: ['sour'] },
        recommendations: ['Grind finer'],
        timestamp: '2026-01-03T10:00:00.000Z',
      }],
      status: 'active',
      created_at: '2026-01-03T10:00:00.000Z',
      updated_at: '2026-01-03T10:05:00.000Z',
    })

    await expect(getDirectDialInSession('dial-1')).resolves.toEqual(expect.objectContaining({
      id: 'dial-1',
      coffee: { roast_level: 'medium', origin: 'Ethiopia' },
      profile_name: 'Turbo Bloom',
      iterations: [expect.objectContaining({
        iteration_number: 1,
        recommendations: ['Grind finer'],
      })],
      status: 'active',
      created_at: '2026-01-03T10:00:00.000Z',
      updated_at: '2026-01-03T10:05:00.000Z',
    }))
    await expect(listDirectDialInSessions()).resolves.toEqual([
      expect.objectContaining({ id: 'dial-1' }),
    ])

    await deleteDirectDialInSession('dial-1')
    await expect(getDirectDialInSession('dial-1')).resolves.toBeUndefined()
  })

  it('keeps legacy steps-only direct dial-in sessions visible after schema changes', async () => {
    const createdAt = Date.parse('2026-01-03T10:00:00.000Z')
    const db = await getDB()
    await db.put('dial-in-sessions', {
      id: 'legacy-dial',
      coffee: { name: 'Ethiopia' },
      steps: [{ grind: 'finer' }],
      createdAt,
    } as unknown as AppDBSchema['dial-in-sessions']['value'])

    await expect(getDirectDialInSession('legacy-dial')).resolves.toEqual({
      id: 'legacy-dial',
      coffee: { name: 'Ethiopia' },
      iterations: [],
      status: 'active',
      created_at: '2026-01-03T10:00:00.000Z',
      updated_at: '2026-01-03T10:00:00.000Z',
    })
    await expect(listDirectDialInSessions()).resolves.toEqual([
      expect.objectContaining({ id: 'legacy-dial', status: 'active' }),
    ])
  })

  it('persists and deletes direct profile image metadata through IndexedDB', async () => {
    const image = new Blob(['image-data'], { type: 'image/png' })

    await saveDirectProfileImage('profile-1', image)
    const stored = await getDirectProfileImage('profile-1')

    expect(stored).toBeTruthy()
    expect(stored?.type).toBe('image/png')

    await deleteDirectProfileImage('profile-1')
    await expect(getDirectProfileImage('profile-1')).resolves.toBeNull()
  })
})
