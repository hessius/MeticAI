import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasFeature, type FeatureFlags } from '@/lib/featureFlags'
import { isDirectMode, isNativePlatform } from '@/lib/machineMode'
import { STORAGE_KEYS } from '@/lib/constants'

const disabledDirectFeatures = new Set<keyof FeatureFlags>([
  'machineDiscovery',
  'scheduledShots',
  'systemManagement',
  'tailscaleConfig',
  'mcpServer',
  'cloudSync',
  'bridgeStatus',
  'watchtowerUpdate',
])

const { preferenceValues, preferencesMock } = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    preferenceValues: values,
    preferencesMock: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: values.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        values.set(key, value)
      }),
      remove: vi.fn(async ({ key }: { key: string }) => {
        values.delete(key)
      }),
    },
  }
})

const discoveryMocks = vi.hoisted(() => ({
  discoverMachines: vi.fn(),
  testMachineConnection: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: preferencesMock,
}))

vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => null,
}))

vi.mock('@/lib/machineMode', () => ({
  isDirectMode: vi.fn(() => true),
  isNativePlatform: vi.fn(() => false),
  getDefaultMachineUrl: vi.fn(() => localStorage.getItem('meticai-machine-url') || 'http://meticulous.local:8080'),
  setMachineUrl: vi.fn((url: string) => localStorage.setItem('meticai-machine-url', url)),
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

vi.mock('@/lib/featureFlags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/featureFlags')>('@/lib/featureFlags')
  return {
    ...actual,
    hasFeature: vi.fn((feature: keyof FeatureFlags) => !disabledDirectFeatures.has(feature)),
  }
})

vi.mock('@/services/machine/discovery', () => discoveryMocks)

import { SettingsView } from './SettingsView'

const mockedHasFeature = vi.mocked(hasFeature)
const mockedIsDirectMode = vi.mocked(isDirectMode)
const mockedIsNativePlatform = vi.mocked(isNativePlatform)

describe('SettingsView direct-mode backend guards', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', 'test')
    preferenceValues.clear()
    vi.clearAllMocks()
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    mockedIsDirectMode.mockReturnValue(true)
    mockedIsNativePlatform.mockReturnValue(false)
    discoveryMocks.discoverMachines.mockReset()
    discoveryMocks.testMachineConnection.mockReset()
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => !disabledDirectFeatures.has(feature))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
    preferenceValues.clear()
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
  })

  it('does not load backend-only settings, update, status, or tailscale endpoints in direct PWA mode', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const requestedUrls = (fetchMock.mock.calls as unknown[][]).map(args => String(args[0]))
    expect(requestedUrls).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/api\/(?:settings|status|check-updates|update-method|tailscale-status|changelog|machine\/detect)/),
      ]),
    )
    expect(screen.queryByRole('button', { name: 'settings.changelog' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.detect' })).not.toBeInTheDocument()
  })

  it('uses native discovery in Capacitor Settings without calling backend machine detect', async () => {
    mockedIsNativePlatform.mockReturnValue(true)
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => (
      feature === 'machineDiscovery' ? true : !disabledDirectFeatures.has(feature)
    ))
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    discoveryMocks.discoverMachines.mockResolvedValue([{
      name: 'meticulous-a3f7',
      host: '192.168.1.42',
      port: 8080,
      url: 'http://192.168.1.42:8080',
    }])
    discoveryMocks.testMachineConnection.mockResolvedValue(true)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(screen.queryByRole('button', { name: 'settings.changelog' })).not.toBeInTheDocument()
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
    const detectButton = screen.getByRole('button', { name: 'settings.detect' })
    fireEvent.click(detectButton)

    await waitFor(() => expect(discoveryMocks.discoverMachines).toHaveBeenCalled())
    await waitFor(() => expect(discoveryMocks.testMachineConnection).toHaveBeenCalledWith('http://192.168.1.42:8080'))

    await waitFor(() => expect(preferencesMock.set).toHaveBeenCalledWith({
      key: STORAGE_KEYS.MACHINE_URL,
      value: 'http://192.168.1.42:8080',
    }))
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'machine-url-changed' }))
    expect(screen.getByText('settings.machineFound')).toBeInTheDocument()
    const requestedUrls = (fetchMock.mock.calls as unknown[][]).map(args => String(args[0]))
    expect(requestedUrls).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/api\/(?:settings|status|check-updates|update-method|tailscale-status|changelog|machine\/detect)/),
      ]),
    )
  })

  it('shows a network error when Capacitor native discovery fails', async () => {
    mockedIsNativePlatform.mockReturnValue(true)
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => (
      feature === 'machineDiscovery' ? true : !disabledDirectFeatures.has(feature)
    ))
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    discoveryMocks.discoverMachines.mockRejectedValue(new Error('local network denied'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    fireEvent.click(screen.getByRole('button', { name: 'settings.detect' }))

    await waitFor(() => expect(discoveryMocks.discoverMachines).toHaveBeenCalled())
    expect(await screen.findByText('settings.discovery.networkError')).toBeInTheDocument()
    expect(discoveryMocks.testMachineConnection).not.toHaveBeenCalled()
    const requestedUrls = (fetchMock.mock.calls as unknown[][]).map(args => String(args[0]))
    expect(requestedUrls).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/api\/machine\/detect/),
      ]),
    )
  })

  it('loads and saves the Capacitor machine URL through direct-mode URL storage', async () => {
    mockedIsNativePlatform.mockReturnValue(true)
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    preferenceValues.set(STORAGE_KEYS.MACHINE_URL, 'http://192.168.1.40:8080')

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
    })

    const input = await screen.findByLabelText('settings.meticulousIp')
    await waitFor(() => expect(input).toHaveValue('http://192.168.1.40:8080'))

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
    fireEvent.change(input, { target: { value: '192.168.1.50' } })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 850))
    })

    expect(localStorage.getItem(STORAGE_KEYS.MACHINE_URL)).toBeNull()
    expect(preferencesMock.set).toHaveBeenCalledWith({
      key: STORAGE_KEYS.MACHINE_URL,
      value: 'http://192.168.1.50:8080',
    })
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'machine-url-changed' }))
  })

  it('loads and saves the web direct machine URL through localStorage-backed URL storage', async () => {
    localStorage.setItem(STORAGE_KEYS.MACHINE_URL, 'http://192.168.1.60:8080')

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
    })

    const input = await screen.findByLabelText('settings.meticulousIp')
    await waitFor(() => expect(input).toHaveValue('http://192.168.1.60:8080'))

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
    fireEvent.change(input, { target: { value: '192.168.1.61' } })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 850))
    })

    expect(localStorage.getItem(STORAGE_KEYS.MACHINE_URL)).toBe('http://192.168.1.61:8080')
    expect(preferencesMock.set).not.toHaveBeenCalled()
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'machine-url-changed' }))
  })

  it('does not persist partial IPv4 input as a coerced machine URL', async () => {
    localStorage.setItem(STORAGE_KEYS.MACHINE_URL, 'http://192.168.1.60:8080')

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
    })

    const input = await screen.findByLabelText('settings.meticulousIp')
    await waitFor(() => expect(input).toHaveValue('http://192.168.1.60:8080'))

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
    fireEvent.change(input, { target: { value: '192.168.1' } })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 850))
    })

    expect(localStorage.getItem(STORAGE_KEYS.MACHINE_URL)).toBe('http://192.168.1.60:8080')
    expect(preferencesMock.set).not.toHaveBeenCalled()
    expect(dispatchEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'machine-url-changed' }))
    expect(screen.getByText('settings.invalidMachineUrl')).toBeInTheDocument()
  })

  it.each([
    ['192.168.1.50:abc'],
    ['ftp://machine.local'],
  ])('shows localized validation feedback and keeps the existing URL for invalid machine URL %s', async (value) => {
    localStorage.setItem(STORAGE_KEYS.MACHINE_URL, 'http://192.168.1.60:8080')

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
    })

    const input = await screen.findByLabelText('settings.meticulousIp')
    await waitFor(() => expect(input).toHaveValue('http://192.168.1.60:8080'))

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
    fireEvent.change(input, { target: { value } })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 850))
    })

    expect(localStorage.getItem(STORAGE_KEYS.MACHINE_URL)).toBe('http://192.168.1.60:8080')
    expect(preferencesMock.set).not.toHaveBeenCalled()
    expect(dispatchEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'machine-url-changed' }))
    expect(screen.getByText('settings.invalidMachineUrl')).toBeInTheDocument()
  })

  it('clears loading and uses a safe fallback when direct machine URL loading fails', async () => {
    mockedIsNativePlatform.mockReturnValue(true)
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    preferencesMock.get.mockRejectedValueOnce(new Error('Preferences unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
    })

    await waitFor(() => expect(screen.queryByText('settings.loadingSettings')).not.toBeInTheDocument())
    expect(await screen.findByLabelText('settings.meticulousIp')).toHaveValue('http://meticulous.local:8080')
    expect(screen.getByText('settings.machineUrlLoadFailed')).toBeInTheDocument()
  })
})
