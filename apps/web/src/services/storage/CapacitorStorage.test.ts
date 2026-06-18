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
  const storageBacking = new Map<string, string>()
  const localStorageShim = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => storageBacking.set(key, String(value)),
    removeItem: (key: string) => storageBacking.delete(key),
    clear: () => storageBacking.clear(),
    get length() { return storageBacking.size },
    key: (i: number) => [...storageBacking.keys()][i] ?? null,
  }

  beforeEach(() => {
    storageBacking.clear()
    vi.stubGlobal('localStorage', localStorageShim)
    preferenceValues.clear()
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    storageBacking.clear()
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

    expect(localStorage.getItem('machine-url')).toBe('http://native-machine:8080')
    expect(preferencesMock.set).toHaveBeenCalledWith({
      key: 'machine-url',
      value: 'http://native-machine:8080',
    })
    expect(await capacitorStorage.get('machine-url')).toBe('http://native-machine:8080')

    await capacitorStorage.remove('machine-url')
    expect(await capacitorStorage.get('machine-url')).toBeNull()
  })

  it('never invokes Preferences.then() — Android thenable-proxy regression guard', async () => {
    // On Android the Capacitor plugin proxy is "thenable": accessing `.then`
    // yields a function that rejects with "Preferences.then() is not
    // implemented on android". If the storage layer awaits the proxy object
    // directly this `then` fires and breaks startup. Simulate that proxy and
    // assert it is never touched.
    const thenSpy = vi.fn(() => {
      throw new Error('Preferences.then() is not implemented on android')
    })
    ;(preferencesMock as unknown as { then: unknown }).then = thenSpy
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }

    try {
      await expect(capacitorStorage.set('machine-url', 'http://native:8080')).resolves.toBeUndefined()
      await expect(capacitorStorage.get('machine-url')).resolves.toBe('http://native:8080')
      await expect(capacitorStorage.remove('machine-url')).resolves.toBeUndefined()
      expect(thenSpy).not.toHaveBeenCalled()
    } finally {
      delete (preferencesMock as unknown as { then?: unknown }).then
    }
  })
})
