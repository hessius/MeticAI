import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasFeature, type FeatureFlags } from '@/lib/featureFlags'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/lib/featureFlags', () => ({
  hasFeature: vi.fn((feature: keyof FeatureFlags) => feature === 'pwaInstall'),
}))

import { PwaInstallPrompt } from './PwaInstallPrompt'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }

interface TestBeforeInstallPromptEvent extends Event {
  prompt: ReturnType<typeof vi.fn>
  userChoice: Promise<InstallChoice>
}

const mockedHasFeature = vi.mocked(hasFeature)

function stubServiceWorker(register = vi.fn(async () => ({} as ServiceWorkerRegistration))) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  })
  return register
}

function createBeforeInstallPromptEvent(choice: InstallChoice = { outcome: 'accepted', platform: 'web' }) {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as TestBeforeInstallPromptEvent
  event.prompt = vi.fn(async () => {})
  event.userChoice = Promise.resolve(choice)
  const preventDefault = vi.spyOn(event, 'preventDefault')
  return { event, preventDefault }
}

function setBaseUrl(baseUrl: string) {
  vi.stubEnv('BASE_URL', baseUrl)
}

describe('PwaInstallPrompt', () => {
  beforeEach(() => {
    mockedHasFeature.mockImplementation((feature: keyof FeatureFlags) => feature === 'pwaInstall')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    })
  })

  it('registers the direct PWA service worker and prompts after beforeinstallprompt', async () => {
    const register = stubServiceWorker()

    render(<PwaInstallPrompt />)

    await waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' }))

    const { event, preventDefault } = createBeforeInstallPromptEvent()
    await act(async () => {
      window.dispatchEvent(event)
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(screen.getByText('pwaInstall.title')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'pwaInstall.install' }))

    await waitFor(() => expect(event.prompt).toHaveBeenCalled())
  })

  it('registers the service worker under the direct machine base path', async () => {
    setBaseUrl('/meticai/')
    const register = stubServiceWorker()

    render(<PwaInstallPrompt />)

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('/meticai/sw.js', { scope: '/meticai/' })
    })
  })

  it('does not register or show install UI when pwaInstall is disabled', async () => {
    mockedHasFeature.mockReturnValue(false)
    const register = stubServiceWorker()

    render(<PwaInstallPrompt />)

    const { event } = createBeforeInstallPromptEvent()
    await act(async () => {
      window.dispatchEvent(event)
    })

    expect(register).not.toHaveBeenCalled()
    expect(screen.queryByText('pwaInstall.title')).not.toBeInTheDocument()
  })
})
