import { describe, it, expect, beforeEach } from 'vitest'
import {
  setActiveShotOverride,
  getActiveShotOverride,
} from './activeShotOverride'

describe('activeShotOverride', () => {
  beforeEach(() => {
    setActiveShotOverride(null)
  })

  it('defaults to null', () => {
    expect(getActiveShotOverride()).toBeNull()
  })

  it('stores and returns the active override', () => {
    setActiveShotOverride({ profileName: 'Slow-Mo Blossom', finalWeight: 42 })
    expect(getActiveShotOverride()).toEqual({
      profileName: 'Slow-Mo Blossom',
      finalWeight: 42,
    })
  })

  it('supports an override without a weight target', () => {
    setActiveShotOverride({ profileName: 'No Weight' })
    expect(getActiveShotOverride()).toEqual({ profileName: 'No Weight' })
    expect(getActiveShotOverride()?.finalWeight).toBeUndefined()
  })

  it('clears the override when set to null', () => {
    setActiveShotOverride({ profileName: 'X', finalWeight: 30 })
    setActiveShotOverride(null)
    expect(getActiveShotOverride()).toBeNull()
  })
})
