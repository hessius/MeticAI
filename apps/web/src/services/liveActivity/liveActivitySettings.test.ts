import { describe, it, expect, beforeEach } from 'vitest'
import { loadLiveActivitySettings, saveLiveActivitySettings } from './liveActivitySettings'

describe('liveActivitySettings', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to weight + temp', () => {
    expect(loadLiveActivitySettings()).toEqual({
      shotGlanceable: 'weight',
      heatingGlanceable: 'temp',
    })
  })

  it('round-trips saved values', () => {
    saveLiveActivitySettings({ shotGlanceable: 'pressure', heatingGlanceable: 'estimatedTime' })
    expect(loadLiveActivitySettings()).toEqual({
      shotGlanceable: 'pressure',
      heatingGlanceable: 'estimatedTime',
    })
  })

  it('falls back to defaults on invalid stored values', () => {
    localStorage.setItem('meticai-la-shot-glanceable', 'bogus')
    expect(loadLiveActivitySettings().shotGlanceable).toBe('weight')
  })
})
