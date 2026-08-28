import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  getChartLayoutPref,
  setChartLayoutPref,
  type ChartLayoutPref,
} from '@/lib/chartLayout'

export type EffectiveChartLayout = 'combined' | 'stack' | 'grid'

interface Breakpoints {
  lg: boolean
  xl: boolean
}

/** Pure resolution of the effective layout from preference + breakpoints. */
export function resolveChartLayout(
  pref: ChartLayoutPref,
  bp: Breakpoints,
): EffectiveChartLayout {
  if (!bp.lg || pref === 'combined') return 'combined'
  return bp.xl ? 'grid' : 'stack'
}

function subscribeMedia(query: string, cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(query)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    cb => subscribeMedia(query, cb),
    () =>
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  )
}

export interface UseChartLayoutResult {
  /** Persisted user preference. */
  pref: ChartLayoutPref
  /** True when the viewport is wide enough to offer separation (lg+). */
  canSeparate: boolean
  /** Effective layout after applying breakpoints. */
  layout: EffectiveChartLayout
  /** Persist + apply a new preference. */
  setPref: (pref: ChartLayoutPref) => void
}

export function useChartLayout(): UseChartLayoutResult {
  const [pref, setPrefState] = useState<ChartLayoutPref>(getChartLayoutPref)
  const lg = useMedia('(min-width: 1024px)')
  const xl = useMedia('(min-width: 1280px)')

  const setPref = useCallback((next: ChartLayoutPref) => {
    setChartLayoutPref(next)
    setPrefState(next)
  }, [])

  return {
    pref,
    canSeparate: lg,
    layout: resolveChartLayout(pref, { lg, xl }),
    setPref,
  }
}
