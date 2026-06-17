import { describe, it, expect, beforeEach } from 'vitest'
import {
  getCatalogueCache,
  setCatalogueCache,
  invalidateCatalogueCache,
  CATALOGUE_CACHE_TTL,
} from './catalogueCache'

interface TestProfile { id: string; name: string }

describe('catalogueCache', () => {
  beforeEach(() => {
    invalidateCatalogueCache()
  })

  it('defaults to null', () => {
    expect(getCatalogueCache()).toBeNull()
  })

  it('stores and returns the cached catalogue (typed)', () => {
    const data = {
      profiles: [{ id: '1', name: 'A' }] as TestProfile[],
      offline: false,
      ts: Date.now(),
    }
    setCatalogueCache<TestProfile>(data)
    const cached = getCatalogueCache<TestProfile>()
    expect(cached).not.toBeNull()
    expect(cached?.profiles[0].name).toBe('A')
    expect(cached?.offline).toBe(false)
  })

  it('invalidate clears the cache so a stale entry is dropped', () => {
    setCatalogueCache<TestProfile>({
      profiles: [{ id: '1', name: 'A' }],
      offline: false,
      ts: Date.now(),
    })
    invalidateCatalogueCache()
    expect(getCatalogueCache()).toBeNull()
  })

  it('exposes a 2-minute TTL constant', () => {
    expect(CATALOGUE_CACHE_TTL).toBe(2 * 60 * 1000)
  })
})
