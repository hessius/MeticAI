import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/lib/constants'

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

describe('machineUrl persistence', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    preferenceValues.clear()
    localStorage.clear()
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    Object.defineProperty(window, 'location', {
      value: {
        port: '3550',
        protocol: 'http:',
        host: 'localhost:3550',
        hostname: 'localhost',
      },
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    localStorage.clear()
  })

  it('persists web direct machine URLs in localStorage', async () => {
    const { getStoredMachineUrl, persistMachineUrl, resolveMachineUrl } = await import('./machineUrl')

    await persistMachineUrl('http://192.168.1.42:8080')

    expect(localStorage.getItem(STORAGE_KEYS.MACHINE_URL)).toBe('http://192.168.1.42:8080')
    expect(await getStoredMachineUrl()).toBe('http://192.168.1.42:8080')
    expect(await resolveMachineUrl()).toBe('http://192.168.1.42:8080')
    expect(preferencesMock.set).not.toHaveBeenCalled()
  })

  it('persists native machine URLs in Capacitor Preferences', async () => {
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    const { getStoredMachineUrl, persistMachineUrl, resolveMachineUrl } = await import('./machineUrl')

    await persistMachineUrl('http://10.0.0.2:8080')

    expect(localStorage.getItem(STORAGE_KEYS.MACHINE_URL)).toBeNull()
    expect(preferencesMock.set).toHaveBeenCalledWith({
      key: STORAGE_KEYS.MACHINE_URL,
      value: 'http://10.0.0.2:8080',
    })
    expect(await getStoredMachineUrl()).toBe('http://10.0.0.2:8080')
    expect(await resolveMachineUrl()).toBe('http://10.0.0.2:8080')
  })

  it('does not use stale web localStorage as a native fallback when Preferences are empty', async () => {
    localStorage.setItem(STORAGE_KEYS.MACHINE_URL, 'http://stale-web-url:8080')
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    const { resolveMachineUrl } = await import('./machineUrl')

    await expect(resolveMachineUrl()).resolves.toBe('http://meticulous.local:8080')
    expect(preferencesMock.get).toHaveBeenCalledWith({ key: STORAGE_KEYS.MACHINE_URL })
  })
})
