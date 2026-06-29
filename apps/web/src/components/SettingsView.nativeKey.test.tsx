import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasFeature, type FeatureFlags } from '@/lib/featureFlags'
import { isDirectMode, isNativePlatform, isDemoMode } from '@/lib/machineMode'
import { AI_PREFS_CHANGED_EVENT } from '@/lib/aiPreferences'
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

// Capacitor SecureStorage whose write NEVER resolves — simulates a slow/hung
// native Keychain write on iOS. The fix must not let this block the localStorage
// mirror or the AI_PREFS_CHANGED_EVENT dispatch.
const secureStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(() => new Promise<void>(() => {})),
  removeItem: vi.fn(async () => {}),
}))

const discoveryMocks = vi.hoisted(() => ({
  discoverMachines: vi.fn(),
  testMachineConnection: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: secureStorageMock,
}))

vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => null,
}))

vi.mock('@/lib/machineMode', () => ({
  isDirectMode: vi.fn(() => true),
  isDemoMode: vi.fn(() => false),
  isNativePlatform: vi.fn(() => true),
  getDefaultMachineUrl: vi.fn(() => 'http://meticulous.local:8080'),
  setMachineUrl: vi.fn(),
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
const mockedIsDemoMode = vi.mocked(isDemoMode)
const mockedIsNativePlatform = vi.mocked(isNativePlatform)

describe('SettingsView native-mode API key save', () => {
  const storageBacking = new Map<string, string>()
  const localStorageShim = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => { storageBacking.set(key, String(value)) },
    removeItem: (key: string) => { storageBacking.delete(key) },
    clear: () => { storageBacking.clear() },
    get length() { return storageBacking.size },
    key: (i: number) => [...storageBacking.keys()][i] ?? null,
  }

  beforeEach(() => {
    storageBacking.clear()
    vi.stubGlobal('localStorage', localStorageShim)
    vi.stubGlobal('__APP_VERSION__', 'test')
    vi.clearAllMocks()
    secureStorageMock.getItem.mockImplementation(async () => null)
    secureStorageMock.setItem.mockImplementation(() => new Promise<void>(() => {}))
    secureStorageMock.removeItem.mockImplementation(async () => {})
    mockedIsDirectMode.mockReturnValue(true)
    mockedIsDemoMode.mockReturnValue(false)
    mockedIsNativePlatform.mockReturnValue(true)
    discoveryMocks.discoverMachines.mockReset()
    discoveryMocks.testMachineConnection.mockReset()
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => !disabledDirectFeatures.has(feature))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
    storageBacking.clear()
  })

  it('writes the key to localStorage and dispatches AI_PREFS_CHANGED_EVENT even when the native Keychain write hangs', async () => {
    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const aiSection = await screen.findByText('settings.aiSettings')
    fireEvent.click(aiSection)
    const input = await screen.findByLabelText('settings.providerApiKey')

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
    fireEvent.change(input, { target: { value: 'AIzaNATIVEKEY' } })

    // Advance past the 800ms debounce; the native Keychain write stays pending forever.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 850))
    })

    // Synchronous readers (BrowserAIService.getStoredApiKey, the App AI-gate) must
    // see the key immediately, despite the hung Keychain write.
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)).toBe('AIzaNATIVEKEY')
    expect(secureStorageMock.setItem).toHaveBeenCalled()
    await waitFor(() => {
      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: AI_PREFS_CHANGED_EVENT }),
      )
    })
  })

  it('removes the stored key from localStorage and the Keychain when the field is cleared', async () => {
    secureStorageMock.setItem.mockImplementation(async () => {})
    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const aiSection = await screen.findByText('settings.aiSettings')
    fireEvent.click(aiSection)
    const input = await screen.findByLabelText('settings.providerApiKey')

    fireEvent.change(input, { target: { value: 'AIzaNATIVEKEY' } })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)) })
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)).toBe('AIzaNATIVEKEY')

    // Clearing the field must delete the stored key so it does not reappear when
    // switching providers back and forth.
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)).toBeNull()
    })
    expect(secureStorageMock.removeItem).toHaveBeenCalled()
  })
})
