import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getSoundsEnabled, setSoundsEnabled, SOUND_PREFS_CHANGED_EVENT } from '@/lib/soundPreferences'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    reset: () => { store = {} },
  }
})()

describe('soundPreferences', () => {
  beforeEach(() => {
    localStorageMock.reset()
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
    vi.clearAllMocks()
  })

  describe('getSoundsEnabled', () => {
    it('returns false by default (opt-in)', () => {
      expect(getSoundsEnabled()).toBe(false)
    })

    it('returns true when explicitly enabled', () => {
      localStorage.setItem('meticai-sounds-enabled', 'true')
      expect(getSoundsEnabled()).toBe(true)
    })

    it('returns false when explicitly disabled', () => {
      localStorage.setItem('meticai-sounds-enabled', 'false')
      expect(getSoundsEnabled()).toBe(false)
    })
  })

  describe('setSoundsEnabled', () => {
    it('persists value to localStorage', () => {
      setSoundsEnabled(true)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('meticai-sounds-enabled', 'true')

      setSoundsEnabled(false)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('meticai-sounds-enabled', 'false')
    })

    it('dispatches CustomEvent on change', () => {
      const handler = vi.fn()
      window.addEventListener(SOUND_PREFS_CHANGED_EVENT, handler)

      setSoundsEnabled(true)
      expect(handler).toHaveBeenCalledTimes(1)
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ enabled: true })

      window.removeEventListener(SOUND_PREFS_CHANGED_EVENT, handler)
    })
  })
})
