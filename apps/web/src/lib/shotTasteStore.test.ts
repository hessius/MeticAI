import { describe, it, expect, beforeEach } from 'vitest'
import { saveShotTaste, loadShotTaste, shotTasteKey } from './shotTasteStore'

describe('shotTasteStore (U3)', () => {
  beforeEach(() => localStorage.clear())
  it('round-trips taste for a shot key', () => {
    const taste = { x: -0.5, y: 0.3, descriptors: ['sour'] }
    saveShotTaste('Prof', '2024-01-01', 'a.json', taste)
    expect(loadShotTaste('Prof', '2024-01-01', 'a.json')).toEqual(taste)
  })
  it('returns null when nothing stored', () => {
    expect(loadShotTaste('Prof', '2024-01-01', 'missing.json')).toBeNull()
  })
  it('builds a stable composite key', () => {
    expect(shotTasteKey('P', 'd', 'f')).toBe('shot-taste:P|d|f')
  })
  it('encodes delimiter characters to avoid key collisions', () => {
    // Two distinct shots that would collide under naive '|' joining.
    saveShotTaste('A|B', 'd', 'f', { x: 1, y: 1, descriptors: ['bitter'] })
    saveShotTaste('A', 'B|d', 'f', { x: -1, y: -1, descriptors: ['sour'] })
    expect(loadShotTaste('A|B', 'd', 'f')).toEqual({ x: 1, y: 1, descriptors: ['bitter'] })
    expect(loadShotTaste('A', 'B|d', 'f')).toEqual({ x: -1, y: -1, descriptors: ['sour'] })
    expect(shotTasteKey('A|B', 'd', 'f')).not.toBe(shotTasteKey('A', 'B|d', 'f'))
  })
})
