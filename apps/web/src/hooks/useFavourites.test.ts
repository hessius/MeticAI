import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
vi.mock('@/services/storage/CapacitorStorage', () => ({
  capacitorStorage: {
    get: vi.fn(async (k: string) => (mem.has(k) ? mem.get(k)! : null)),
    set: vi.fn(async (k: string, v: string) => { mem.set(k, v) }),
    remove: vi.fn(async (k: string) => { mem.delete(k) }),
  },
}))

import { useFavourites } from './useFavourites'

describe('useFavourites', () => {
  beforeEach(() => { mem.clear() })

  it('loads empty then reflects a toggle', async () => {
    const { result } = renderHook(() => useFavourites())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.favourites).toEqual([])

    await act(async () => { await result.current.toggle({ id: 'a', name: 'Alpha' }) })
    await waitFor(() => expect(result.current.favourites.map(f => f.id)).toEqual(['a']))
    expect(result.current.isFavourite('a')).toBe(true)
  })

  it('two hook instances stay in sync via the change event', async () => {
    const h1 = renderHook(() => useFavourites())
    const h2 = renderHook(() => useFavourites())
    await waitFor(() => expect(h1.result.current.loading).toBe(false))
    await waitFor(() => expect(h2.result.current.loading).toBe(false))

    await act(async () => { await h1.result.current.toggle({ id: 'x', name: 'X' }) })
    await waitFor(() => expect(h2.result.current.isFavourite('x')).toBe(true))
  })
})
