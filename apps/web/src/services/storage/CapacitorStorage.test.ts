import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capacitorStorage } from './CapacitorStorage'

const preferenceValues = new Map<string, string>()
const preferencesMock = vi.hoisted(() => ({
  get: vi.fn(async ({ key }: { key: string }) => ({ value: preferenceValues.get(key) ?? null })),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    preferenceValues.set(key, value)
  }),
  remove: vi.fn(async ({ key }: { key: string }) => {
    preferenceValues.delete(key)
  }),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: preferencesMock,
}))

describe('capacitorStorage', () => {
  beforeEach(() => {
    preferenceValues.clear()
    localStorage.clear()
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    localStorage.clear()
  })

  it('uses localStorage on web/direct PWA', async () => {
    await capacitorStorage.set('machine-url', 'http://web-machine:8080')

    expect(localStorage.getItem('machine-url')).toBe('http://web-machine:8080')
    expect(await capacitorStorage.get('machine-url')).toBe('http://web-machine:8080')
    expect(preferencesMock.set).not.toHaveBeenCalled()

    await capacitorStorage.remove('machine-url')
    expect(localStorage.getItem('machine-url')).toBeNull()
  })

  it('uses Capacitor Preferences on native platforms', async () => {
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }

    await capacitorStorage.set('machine-url', 'http://native-machine:8080')

    expect(localStorage.getItem('machine-url')).toBeNull()
    expect(preferencesMock.set).toHaveBeenCalledWith({
      key: 'machine-url',
      value: 'http://native-machine:8080',
    })
    expect(await capacitorStorage.get('machine-url')).toBe('http://native-machine:8080')

    await capacitorStorage.remove('machine-url')
    expect(await capacitorStorage.get('machine-url')).toBeNull()
  })
})
