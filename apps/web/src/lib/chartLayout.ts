import { STORAGE_KEYS } from './constants'

export type ChartLayoutPref = 'combined' | 'separated'

export function getChartLayoutPref(): ChartLayoutPref {
  try {
    return localStorage.getItem(STORAGE_KEYS.CHART_LAYOUT) === 'separated'
      ? 'separated'
      : 'combined'
  } catch {
    return 'combined'
  }
}

export function setChartLayoutPref(pref: ChartLayoutPref): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CHART_LAYOUT, pref)
  } catch {
    /* storage unavailable — non-fatal */
  }
}
