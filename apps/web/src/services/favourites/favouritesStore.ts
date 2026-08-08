import { capacitorStorage } from '@/services/storage/CapacitorStorage'
import { STORAGE_KEYS, FAVOURITES_MAX, FAVOURITES_CHANGED } from '@/lib/constants'

export interface Favourite {
  id: string
  name: string
  /** Target temperature (°C) captured at favourite time, when known. */
  targetTempC?: number
  /** Target/final weight (g) captured at favourite time, when known. */
  targetWeightG?: number
  /** Source image URL/data URI (resolved). Native caches this for widgets. */
  imageUrl?: string
}

function emitChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FAVOURITES_CHANGED))
  }
}

export async function loadFavourites(): Promise<Favourite[]> {
  const raw = await capacitorStorage.get(STORAGE_KEYS.FAVOURITES)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is Favourite => !!f && typeof f.id === 'string' && typeof f.name === 'string',
    )
  } catch {
    return []
  }
}

export async function saveFavourites(list: Favourite[]): Promise<Favourite[]> {
  const capped = list.slice(-FAVOURITES_MAX)
  await capacitorStorage.set(STORAGE_KEYS.FAVOURITES, JSON.stringify(capped))
  emitChanged()
  return capped
}

export async function isFavourite(id: string): Promise<boolean> {
  return (await loadFavourites()).some(f => f.id === id)
}

export async function toggleFavourite(fav: Favourite): Promise<Favourite[]> {
  const list = await loadFavourites()
  const idx = list.findIndex(f => f.id === fav.id)
  const next = idx >= 0
    ? list.filter(f => f.id !== fav.id)
    : [...list, fav]
  return saveFavourites(next)
}

export async function reorderFavourites(orderedIds: string[]): Promise<Favourite[]> {
  const list = await loadFavourites()
  const byId = new Map(list.map(f => [f.id, f]))
  const next = orderedIds
    .map(id => byId.get(id))
    .filter((f): f is Favourite => !!f)
  return saveFavourites(next)
}
