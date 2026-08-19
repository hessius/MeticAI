import { describe, it, expect, beforeEach } from 'vitest'
import { getChartLayoutPref, setChartLayoutPref } from './chartLayout'

describe('chartLayout preference', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to combined when unset', () => {
    expect(getChartLayoutPref()).toBe('combined')
  })

  it('round-trips a stored value', () => {
    setChartLayoutPref('separated')
    expect(getChartLayoutPref()).toBe('separated')
  })

  it('falls back to combined for an invalid stored value', () => {
    localStorage.setItem('meticai-chart-layout', 'bogus')
    expect(getChartLayoutPref()).toBe('combined')
  })
})
