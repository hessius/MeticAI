import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/lib/constants'

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
  parseMachineInput: vi.fn(),
  testMachineConnection: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: preferencesMock,
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}))

vi.mock('@/hooks/useThemePreference', () => ({
  useThemePreference: () => ({
    preference: 'system',
    isDark: false,
    setTheme: vi.fn(),
  }),
}))

vi.mock('@/hooks/a11y/useScreenReader', () => ({
  useScreenReaderAnnouncement: () => vi.fn(),
}))

vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: () => ({ impact: vi.fn() }),
}))

vi.mock('@/hooks/useBrewNotifications', () => ({
  useBrewNotifications: () => ({ requestPermission: vi.fn() }),
}))

vi.mock('@/i18n/config', () => ({
  supportedLanguages: ['en', 'sv', 'de', 'es', 'fr', 'it'],
  languageNames: {
    en: 'English',
    sv: 'Svenska',
    de: 'Deutsch',
    es: 'Español',
    fr: 'Français',
    it: 'Italiano',
  },
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

vi.mock('@/services/machine/discovery', () => discoveryMocks)

vi.stubGlobal('__APP_VERSION__', 'test')

import { OnboardingWizard } from './OnboardingWizard'

describe('OnboardingWizard direct/native machine URL persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preferenceValues.clear()
    localStorage.clear()
    ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    }
    discoveryMocks.discoverMachines.mockRejectedValue(new Error('local network unavailable'))
    discoveryMocks.parseMachineInput.mockReturnValue({
      name: '192.168.1.50',
      host: '192.168.1.50',
      port: 8080,
      url: 'http://192.168.1.50:8080',
    })
    discoveryMocks.testMachineConnection.mockResolvedValue(true)
  })

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    localStorage.clear()
    preferenceValues.clear()
  })

  it('saves a manually connected native machine URL through Capacitor Preferences', async () => {
    render(<OnboardingWizard onComplete={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.getStarted' }))
    fireEvent.change(await screen.findByLabelText('onboarding.machine.ipLabel'), {
      target: { value: '192.168.1.50' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'onboarding.machine.connectButton' }))
    })

    await waitFor(() => expect(preferencesMock.set).toHaveBeenCalledWith({
      key: STORAGE_KEYS.MACHINE_URL,
      value: 'http://192.168.1.50:8080',
    }))
    expect(localStorage.getItem(STORAGE_KEYS.MACHINE_URL)).toBe('http://192.168.1.50:8080')
  })

  it('auto-connects a single discovered native machine without cancelling persistence', async () => {
    let resolveConnection!: (value: boolean) => void
    discoveryMocks.discoverMachines.mockResolvedValue([{
      name: 'meticulous-a3f7',
      host: '192.168.1.42',
      port: 8080,
      url: 'http://192.168.1.42:8080',
    }])
    discoveryMocks.testMachineConnection.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveConnection = resolve
    }))

    render(<OnboardingWizard onComplete={() => {}} />)

    await waitFor(() => expect(discoveryMocks.discoverMachines).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.getStarted' }))
    await waitFor(() => expect(discoveryMocks.testMachineConnection).toHaveBeenCalledWith('http://192.168.1.42:8080'))

    await act(async () => {
      resolveConnection(true)
    })

    await waitFor(() => expect(preferencesMock.set).toHaveBeenCalledWith({
      key: STORAGE_KEYS.MACHINE_URL,
      value: 'http://192.168.1.42:8080',
    }))
    expect(await screen.findByText('onboarding.machine.successMessage')).toBeInTheDocument()
  })

  it('shows an unreachable error when selecting a discovered machine rejects', async () => {
    discoveryMocks.discoverMachines.mockResolvedValue([
      {
        name: 'meticulous-a3f7',
        host: '192.168.1.42',
        port: 8080,
        url: 'http://192.168.1.42:8080',
      },
      {
        name: 'meticulous-b821',
        host: '192.168.1.43',
        port: 8080,
        url: 'http://192.168.1.43:8080',
      },
    ])
    discoveryMocks.testMachineConnection.mockRejectedValue(new Error('network denied'))

    render(<OnboardingWizard onComplete={() => {}} />)

    await waitFor(() => expect(discoveryMocks.discoverMachines).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.getStarted' }))
    fireEvent.click(await screen.findByRole('button', { name: /meticulous-a3f7/ }))

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith('onboarding.machine.unreachable'))
    expect(preferencesMock.set).not.toHaveBeenCalled()
  })

  it('advances to the next step when Enter is pressed in the name field', async () => {
    render(<OnboardingWizard onComplete={() => {}} />)

    // welcome → machine
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.getStarted' }))
    // connect a machine so we can proceed past the machine step
    fireEvent.change(await screen.findByLabelText('onboarding.machine.ipLabel'), {
      target: { value: '192.168.1.50' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'onboarding.machine.connectButton' }))
    })
    // machine → name
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.next' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    const nameInput = await screen.findByLabelText('onboarding.name.label')
    fireEvent.change(nameInput, { target: { value: 'Jesper' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    // Should now be on the AI step
    expect(await screen.findByLabelText('onboarding.ai.keyLabel')).toBeInTheDocument()
  })

  it('advances past the AI step when Enter is pressed in the API key field', async () => {
    render(<OnboardingWizard onComplete={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.getStarted' }))
    fireEvent.change(await screen.findByLabelText('onboarding.machine.ipLabel'), {
      target: { value: '192.168.1.50' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'onboarding.machine.connectButton' }))
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.next' })).toBeEnabled())
    // machine → name → ai
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.next' }))

    const keyInput = await screen.findByLabelText('onboarding.ai.keyLabel')
    fireEvent.change(keyInput, { target: { value: 'test-key' } })
    fireEvent.keyDown(keyInput, { key: 'Enter' })

    // AI key field should no longer be present (advanced to the language step)
    await waitFor(() => expect(screen.queryByLabelText('onboarding.ai.keyLabel')).not.toBeInTheDocument())
  })
})
