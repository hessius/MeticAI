import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Favourite } from './favouritesStore'
import {
  loadFavourites,
  saveFavourites,
  toggleFavourite,
  reorderFavourites,
  isFavourite,
} from './favouritesStore'

// In-memory storage mock shared by the module under test.
const mem = new Map<string, string>()
vi.mock('@/services/storage/CapacitorStorage', () => ({
  capacitorStorage: {
    get: vi.fn(async (k: string) => (mem.has(k) ? mem.get(k)! : null)),
    set: vi.fn(async (k: string, v: string) => { mem.set(k, v) }),
    remove: vi.fn(async (k: string) => { mem.delete(k) }),
  },
}))

const fav = (id: string, name = id): Favourite => ({ id, name })

describe('favouritesStore', () => {
  beforeEach(() => { mem.clear() })

  it('returns [] when nothing stored', async () => {
    expect(await loadFavourites()).toEqual([])
  })

  it('round-trips saved favourites', async () => {
    await saveFavourites([fav('a'), fav('b')])
    expect((await loadFavourites()).map(f => f.id)).toEqual(['a', 'b'])
  })

  it('toggle adds when absent and removes when present', async () => {
    let list = await toggleFavourite(fav('a'))
    expect(list.map(f => f.id)).toEqual(['a'])
    list = await toggleFavourite(fav('a'))
    expect(list).toEqual([])
  })

  it('caps the list at FAVOURITES_MAX, dropping the oldest', async () => {
    for (let i = 0; i < 15; i++) await toggleFavourite(fav(`p${i}`))
    const list = await loadFavourites()
    expect(list).toHaveLength(12)
    expect(list[0].id).toBe('p3') // p0..p2 dropped
    expect(list[11].id).toBe('p14')
  })

  it('isFavourite reflects membership', async () => {
    await toggleFavourite(fav('a'))
    expect(await isFavourite('a')).toBe(true)
    expect(await isFavourite('z')).toBe(false)
  })

  it('reorder applies a new id order and ignores unknown ids', async () => {
    await saveFavourites([fav('a'), fav('b'), fav('c')])
    const list = await reorderFavourites(['c', 'a', 'b', 'zzz'])
    expect(list.map(f => f.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores corrupt JSON and returns []', async () => {
    mem.set('meticai-favourites', '{not json')
    expect(await loadFavourites()).toEqual([])
  })
})
