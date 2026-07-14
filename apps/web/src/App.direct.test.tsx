import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, HTMLAttributes } from 'react'
import { hasFeature, type FeatureFlags } from '@/lib/featureFlags'
import { isDemoMode, isDirectMode, isNativePlatform } from '@/lib/machineMode'
import { STORAGE_KEYS } from '@/lib/constants'

const secureStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(async () => null),
  setItem: vi.fn(async () => {}),
  removeItem: vi.fn(async () => {}),
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: secureStorageMock,
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('konsta/react', () => ({
  App: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

vi.mock('@/lib/machineMode', () => ({
  getDefaultMachineUrl: vi.fn(() => 'http://meticulous.local:8080'),
  isDemoMode: vi.fn(() => false),
  isDirectMode: vi.fn(() => true),
  isNativePlatform: vi.fn(() => false),
}))

vi.mock('@/lib/featureFlags', () => ({
  hasFeature: vi.fn((feature: keyof FeatureFlags) => feature !== 'cloudSync'),
}))

vi.mock('@/services/storage', () => ({
  useStorageMigration: vi.fn(),
}))

vi.mock('@/hooks/useGenerationProgress', () => ({
  useGenerationProgress: () => ({ progress: null }),
}))

vi.mock('@/hooks/a11y/useScreenReader', () => ({
  useReducedMotion: () => true,
}))

vi.mock('@/hooks/use-desktop', () => ({
  useIsDesktop: () => false,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('@/hooks/use-swipe-navigation', () => ({
  useSwipeNavigation: vi.fn(),
}))

vi.mock('@/hooks/useBackgroundBlobs', () => ({
  useBackgroundBlobs: () => ({ showBlobs: false, toggleBlobs: vi.fn() }),
}))

vi.mock('@/hooks/useThemePreference', () => ({
  useThemePreference: () => ({
    mounted: true,
    isDark: false,
    isFollowSystem: false,
    toggleTheme: vi.fn(),
    setFollowSystem: vi.fn(),
  }),
}))

vi.mock('@/hooks/usePlatformTheme', () => ({
  usePlatformTheme: () => ({ theme: 'auto', setTheme: vi.fn(), konstaTheme: 'ios' }),
}))

vi.mock('@/hooks/useKonstaOverride', () => ({
  useKonstaOverride: () => false,
}))

vi.mock('@/hooks/useMachineTelemetry', () => ({
  useMachineTelemetry: () => ({
    _wsConnected: false,
    brewing: false,
    active_profile: null,
  }),
}))

vi.mock('@/hooks/useSmartGreeting', () => ({
  useSmartGreeting: () => null,
}))

vi.mock('@/hooks/useBrewNotifications', () => ({
  useBrewNotifications: () => ({ notifyPreheatComplete: vi.fn() }),
}))

vi.mock('@/hooks/useLastShot', () => ({
  useLastShot: () => ({ lastShot: null }),
}))

vi.mock('@/views/StartView', () => ({
  StartView: () => <div>start</div>,
}))

vi.mock('@/views/LoadingView', () => ({
  LOADING_MESSAGE_COUNT: 1,
  LoadingView: () => null,
}))

vi.mock('@/views/ErrorView', () => ({
  ErrorView: () => null,
}))

vi.mock('@/components/SkipNavigation', () => ({
  SkipNavigation: () => null,
}))

vi.mock('@/components/AmbientBackground', () => ({
  AmbientBackground: () => null,
}))

vi.mock('@/components/BetaBanner', () => ({
  BetaBanner: () => null,
}))

vi.mock('@/components/MeticAILogo', () => ({
  MeticAILogo: () => null,
}))

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => null,
}))

vi.mock('@/components/QRCodeDialog', () => ({
  QRCodeDialog: () => null,
}))

vi.mock('@/components/ProfileImportDialog', () => ({
  ProfileImportDialog: () => null,
}))

vi.mock('@/components/ControlCenter', () => ({
  ControlCenter: () => null,
}))

vi.mock('@/components/FeatureErrorBoundary', () => ({
  FeatureErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

import App from './App'

const mockedHasFeature = vi.mocked(hasFeature)
const mockedIsDemoMode = vi.mocked(isDemoMode)
const mockedIsDirectMode = vi.mocked(isDirectMode)
const mockedIsNativePlatform = vi.mocked(isNativePlatform)

describe('App cloud sync guard', () => {
  beforeEach(() => {
    mockedIsDemoMode.mockReturnValue(false)
    mockedIsDirectMode.mockReturnValue(true)
    mockedIsNativePlatform.mockReturnValue(false)
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => feature !== 'cloudSync')
    localStorage.setItem('meticai-auto-sync', 'true')
    localStorage.setItem('meticai-auto-sync-ai-description', 'true')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does not run backend auto-sync polling when cloudSync is disabled', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await new Promise(resolve => setTimeout(resolve, 0))

    const requestedUrls = (fetchMock.mock.calls as unknown[][]).map(args => String(args[0]))
    expect(
      requestedUrls,
    ).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\/api\/settings/),
      expect.stringMatching(/\/api\/profiles\/auto-sync/),
    ]))
  })

  it('does not apply server auto-sync settings when cloudSync is disabled', async () => {
    mockedIsDirectMode.mockReturnValue(false)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      mqttEnabled: true,
      geminiApiKeyConfigured: false,
      autoSync: false,
      autoSyncAiDescription: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await waitFor(() => {
      const requestedUrls = (fetchMock.mock.calls as unknown[][]).map(args => String(args[0]))
      expect(requestedUrls).toEqual(expect.arrayContaining([
        expect.stringMatching(/\/api\/settings/),
      ]))
    })
    expect(localStorage.getItem('meticai-auto-sync')).toBe('true')
    expect(localStorage.getItem('meticai-auto-sync-ai-description')).toBe('true')
  })
})

describe('App AI gate — provider-aware Keychain mirror', () => {
  beforeEach(() => {
    mockedIsDemoMode.mockReturnValue(false)
    mockedIsDirectMode.mockReturnValue(true)
    mockedIsNativePlatform.mockReturnValue(true)
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => feature !== 'cloudSync')
    localStorage.clear()
    secureStorageMock.getItem.mockReset()
    secureStorageMock.getItem.mockImplementation(async () => null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('mirrors the active hosted provider key slot from the Keychain, not just the Gemini slot', async () => {
    // A hosted user configured a non-Gemini provider (OpenAI). Its key lives in
    // the Keychain under the provider-specific slot, not the Gemini slot.
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, 'openai')
    localStorage.setItem(STORAGE_KEYS.AI_MODE, 'hosted')
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, 'true')
    const openaiSlot = `${STORAGE_KEYS.AI_KEY_PREFIX}openai`
    secureStorageMock.getItem.mockImplementation(async (key: string) =>
      key === openaiSlot ? 'sk-openaikey' : null)

    render(<App />)

    // The gate must consult the active provider's slot so the key takes effect
    // without re-onboarding; hardcoding the Gemini slot leaves it inert.
    await waitFor(() => {
      expect(localStorage.getItem(openaiSlot)).toBe('sk-openaikey')
    })
    expect(secureStorageMock.getItem).toHaveBeenCalledWith(openaiSlot)
  })
})

