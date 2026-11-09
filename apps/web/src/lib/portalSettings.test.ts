import { describe, it, expect, beforeEach } from 'vitest'
import { loadPortalSettings, savePortalSettings, subscribePortalSettings, DEFAULT_PORTAL_SETTINGS, __resetPortalSettings } from './portalSettings'
import { STORAGE_KEYS } from './constants'

describe('portalSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetPortalSettings()
  })

  it('defaults to disabled with sane timing', () => {
    expect(loadPortalSettings()).toEqual(DEFAULT_PORTAL_SETTINGS)
  })

  it('persists a patch and notifies subscribers', () => {
    let calls = 0
    const unsubscribe = subscribePortalSettings(() => calls++)
    savePortalSettings({ enabled: true, lastCoffee: 'Hatch Supernova' })
    expect(calls).toBe(1)
    __resetPortalSettings()
    const reloaded = loadPortalSettings()
    expect(reloaded.enabled).toBe(true)
    expect(reloaded.lastCoffee).toBe('Hatch Supernova')
    expect(reloaded.settleSec).toBe(6)
    unsubscribe()
  })

  it('clamps timing to the supported ranges and ignores garbage', () => {
    savePortalSettings({ settleSec: 500, lagSec: -9 })
    expect(loadPortalSettings().settleSec).toBe(60)
    expect(loadPortalSettings().lagSec).toBe(-2)
    localStorage.setItem(STORAGE_KEYS.PORTAL_SETTINGS, '{"settleSec":"abc","lagSec":null,"enabled":1}')
    __resetPortalSettings()
    const s = loadPortalSettings()
    expect(s.settleSec).toBe(6)
    expect(s.lagSec).toBe(0)
    expect(s.enabled).toBe(true)
    localStorage.setItem(STORAGE_KEYS.PORTAL_SETTINGS, 'not json')
    __resetPortalSettings()
    expect(loadPortalSettings()).toEqual(DEFAULT_PORTAL_SETTINGS)
  })
})
