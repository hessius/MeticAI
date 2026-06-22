import { describe, expect, it } from 'vitest'
import { getTempTileDisplay } from './LiveShotView'

// Minimal translation stub: returns the provided fallback (or the key).
const t = (_key: string, fallback?: string) => fallback ?? _key

describe('getTempTileDisplay', () => {
  it('current mode shows the live brew head temperature', () => {
    const r = getTempTileDisplay('current', 92.34, 93, t)
    expect(r.value).toBe('92.3')
    expect(r.unit).toBe('°C')
    expect(r.label).toBe('Brew Head')
    expect(r.valueClassName).toBeUndefined()
  })

  it('current mode shows a dash when the temperature is null', () => {
    const r = getTempTileDisplay('current', null, 93, t)
    expect(r.value).toBe('—')
  })

  it('target mode shows the target temperature', () => {
    const r = getTempTileDisplay('target', 92.3, 93, t)
    expect(r.value).toBe('93.0')
    expect(r.label).toBe('Target')
  })

  it('target mode shows a dash when target is null', () => {
    const r = getTempTileDisplay('target', 92.3, null, t)
    expect(r.value).toBe('—')
  })

  it('delta mode shows a signed positive delta when hotter than target', () => {
    const r = getTempTileDisplay('delta', 96.5, 93, t)
    expect(r.value).toBe('+3.5')
    expect(r.label).toBe('Δ Target')
    expect(r.valueClassName).toContain('orange')
  })

  it('delta mode shows a signed negative delta when cooler than target', () => {
    const r = getTempTileDisplay('delta', 89.5, 93, t)
    expect(r.value).toBe('-3.5')
    expect(r.valueClassName).toContain('blue')
  })

  it('delta mode treats within-threshold as on-target (neutral color)', () => {
    const r = getTempTileDisplay('delta', 94.2, 93, t)
    expect(r.value).toBe('+1.2')
    expect(r.valueClassName).toContain('emerald')
  })

  it('delta mode treats a value just within the threshold as on-target', () => {
    const r = getTempTileDisplay('delta', 95.2, 93, t)
    expect(r.value).toBe('+2.2')
    expect(r.valueClassName).toContain('emerald')
  })

  it('delta mode shows a dash when either value is null', () => {
    expect(getTempTileDisplay('delta', null, 93, t).value).toBe('—')
    expect(getTempTileDisplay('delta', 93, null, t).value).toBe('—')
  })
})
