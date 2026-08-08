import { useCallback, useEffect, useState } from 'react'
import {
  type Favourite,
  loadFavourites,
  toggleFavourite,
  reorderFavourites,
} from '@/services/favourites/favouritesStore'
import { FAVOURITES_CHANGED } from '@/lib/constants'

export function useFavourites() {
  const [favourites, setFavourites] = useState<Favourite[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setFavourites(await loadFavourites())
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const onChange = () => { refresh() }
    window.addEventListener(FAVOURITES_CHANGED, onChange)
    return () => window.removeEventListener(FAVOURITES_CHANGED, onChange)
  }, [refresh])

  const toggle = useCallback(async (fav: Favourite) => {
    setFavourites(await toggleFavourite(fav))
  }, [])

  const reorder = useCallback(async (orderedIds: string[]) => {
    setFavourites(await reorderFavourites(orderedIds))
  }, [])

  const isFavourite = useCallback(
    (id: string) => favourites.some(f => f.id === id),
    [favourites],
  )

  return { favourites, loading, toggle, reorder, isFavourite, refresh }
}
