/**
 * AppDatabase — IndexedDB persistence layer using the `idb` library.
 *
 * Provides structured browser storage for the machine-hosted PWA:
 * - Settings (API key, machine URL, preferences)
 * - Shot annotations (ratings, notes, tags)
 * - AI analysis cache (with TTL)
 * - Pour-over preferences
 * - Dial-in sessions
 * - Profile images (blob cache with LRU eviction)
 *
 * In proxy mode (Docker), the backend handles persistence.
 * In direct mode (PWA), this replaces server-side storage.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface AppDBSchema extends DBSchema {
  settings: {
    key: string
    value: { key: string; value: unknown; updatedAt: number }
  }
  'shot-annotations': {
    key: string
    value: {
      shotKey: string
      rating: number | null
      notes: string
      tags: string[]
      updatedAt: number
    }
    indexes: { 'by-rating': number }
  }
  'ai-cache': {
    key: string
    value: {
      cacheKey: string
      analysis: string
      createdAt: number
      expiresAt: number
    }
    indexes: { 'by-expiry': number }
  }
  'pour-over-state': {
    key: string
    value: {
      id: string
      coffeeWeight: number
      brewRatio: number
      bloomAmount: number
      bloomTime: number
      updatedAt: number
    }
  }
  'dial-in-sessions': {
    key: string
    value: {
      id: string
      coffee: Record<string, unknown>
      steps: Record<string, unknown>[]
      createdAt: number
    }
    indexes: { 'by-date': number }
  }
  'profile-images': {
    key: string
    value: {
      profileId: string
      imageBlob: Blob
      updatedAt: number
    }
  }
}

// ---------------------------------------------------------------------------
// Database Instance
// ---------------------------------------------------------------------------

const DB_NAME = 'meticai'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<AppDBSchema>> | null = null

export function getDB(): Promise<IDBPDatabase<AppDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' })
        }

        // Shot annotations
        if (!db.objectStoreNames.contains('shot-annotations')) {
          const annotStore = db.createObjectStore('shot-annotations', { keyPath: 'shotKey' })
          annotStore.createIndex('by-rating', 'rating')
        }

        // AI cache
        if (!db.objectStoreNames.contains('ai-cache')) {
          const cacheStore = db.createObjectStore('ai-cache', { keyPath: 'cacheKey' })
          cacheStore.createIndex('by-expiry', 'expiresAt')
        }

        // Pour-over state
        if (!db.objectStoreNames.contains('pour-over-state')) {
          db.createObjectStore('pour-over-state', { keyPath: 'id' })
        }

        // Dial-in sessions
        if (!db.objectStoreNames.contains('dial-in-sessions')) {
          const dialinStore = db.createObjectStore('dial-in-sessions', { keyPath: 'id' })
          dialinStore.createIndex('by-date', 'createdAt')
        }

        // Profile images
        if (!db.objectStoreNames.contains('profile-images')) {
          db.createObjectStore('profile-images', { keyPath: 'profileId' })
        }
      },
    })
  }
  return dbPromise
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const db = await getDB()
  const entry = await db.get('settings', key)
  return entry?.value as T | undefined
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put('settings', { key, value, updatedAt: Date.now() })
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDB()
  await db.delete('settings', key)
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const db = await getDB()
  const all = await db.getAll('settings')
  const result: Record<string, unknown> = {}
  for (const entry of all) {
    result[entry.key] = entry.value
  }
  return result
}

// ---------------------------------------------------------------------------
// Shot annotations
// ---------------------------------------------------------------------------

export async function getAnnotation(shotKey: string) {
  const db = await getDB()
  return db.get('shot-annotations', shotKey)
}

export async function setAnnotation(
  shotKey: string,
  data: { rating?: number | null; notes?: string; tags?: string[] },
) {
  const db = await getDB()
  const existing = await db.get('shot-annotations', shotKey)
  await db.put('shot-annotations', {
    shotKey,
    rating: data.rating ?? existing?.rating ?? null,
    notes: data.notes ?? existing?.notes ?? '',
    tags: data.tags ?? existing?.tags ?? [],
    updatedAt: Date.now(),
  })
}

export async function getAllAnnotations() {
  const db = await getDB()
  return db.getAll('shot-annotations')
}

// ---------------------------------------------------------------------------
// AI cache
// ---------------------------------------------------------------------------

const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function getCachedAnalysis(cacheKey: string): Promise<string | null> {
  const db = await getDB()
  const entry = await db.get('ai-cache', cacheKey)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    await db.delete('ai-cache', cacheKey)
    return null
  }
  return entry.analysis
}

export async function setCachedAnalysis(cacheKey: string, analysis: string): Promise<void> {
  const db = await getDB()
  await db.put('ai-cache', {
    cacheKey,
    analysis,
    createdAt: Date.now(),
    expiresAt: Date.now() + AI_CACHE_TTL_MS,
  })
}

export async function cleanExpiredCache(): Promise<number> {
  const db = await getDB()
  const tx = db.transaction('ai-cache', 'readwrite')
  const index = tx.store.index('by-expiry')
  const now = Date.now()
  let deleted = 0

  let cursor = await index.openCursor(IDBKeyRange.upperBound(now))
  while (cursor) {
    await cursor.delete()
    deleted++
    cursor = await cursor.continue()
  }

  await tx.done
  return deleted
}

// ---------------------------------------------------------------------------
// Pour-over state
// ---------------------------------------------------------------------------

export async function getPourOverState() {
  const db = await getDB()
  return db.get('pour-over-state', 'default')
}

export async function setPourOverState(state: {
  coffeeWeight: number
  brewRatio: number
  bloomAmount: number
  bloomTime: number
}): Promise<void> {
  const db = await getDB()
  await db.put('pour-over-state', {
    id: 'default',
    ...state,
    updatedAt: Date.now(),
  })
}

// ---------------------------------------------------------------------------
// Dial-in sessions
// ---------------------------------------------------------------------------

export async function getDialInSession(id: string) {
  const db = await getDB()
  return db.get('dial-in-sessions', id)
}

export async function saveDialInSession(session: {
  id: string
  coffee: Record<string, unknown>
  steps: Record<string, unknown>[]
}): Promise<void> {
  const db = await getDB()
  await db.put('dial-in-sessions', {
    ...session,
    createdAt: Date.now(),
  })
}

export async function listDialInSessions() {
  const db = await getDB()
  return db.getAllFromIndex('dial-in-sessions', 'by-date')
}

export async function deleteDialInSession(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('dial-in-sessions', id)
}

// ---------------------------------------------------------------------------
// Profile images
// ---------------------------------------------------------------------------

const MAX_IMAGE_CACHE_BYTES = 50 * 1024 * 1024 // 50 MB

export async function getProfileImage(profileId: string): Promise<Blob | null> {
  const db = await getDB()
  const entry = await db.get('profile-images', profileId)
  return entry?.imageBlob ?? null
}

export async function setProfileImage(profileId: string, imageBlob: Blob): Promise<void> {
  const db = await getDB()
  await db.put('profile-images', {
    profileId,
    imageBlob,
    updatedAt: Date.now(),
  })
  // LRU eviction
  await evictProfileImages()
}

async function evictProfileImages(): Promise<void> {
  const db = await getDB()
  const all = await db.getAll('profile-images')

  let totalSize = 0
  for (const entry of all) {
    totalSize += entry.imageBlob.size
  }

  if (totalSize <= MAX_IMAGE_CACHE_BYTES) return

  // Sort oldest first, delete until under limit
  all.sort((a, b) => a.updatedAt - b.updatedAt)
  const tx = db.transaction('profile-images', 'readwrite')
  for (const entry of all) {
    if (totalSize <= MAX_IMAGE_CACHE_BYTES) break
    totalSize -= entry.imageBlob.size
    await tx.store.delete(entry.profileId)
  }
  await tx.done
}

export async function deleteProfileImage(profileId: string): Promise<void> {
  const db = await getDB()
  await db.delete('profile-images', profileId)
}

// ---------------------------------------------------------------------------
// Storage migration / init
// ---------------------------------------------------------------------------

export async function initializeStorage(): Promise<void> {
  // Open the DB (triggers upgrade if needed)
  await getDB()
  // Clean expired AI cache entries
  await cleanExpiredCache()
}
