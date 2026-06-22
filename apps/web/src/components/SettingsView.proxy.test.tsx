import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDirectMode, isNativePlatform, isDemoMode } from '@/lib/machineMode'
import { AI_PREFS_CHANGED_EVENT } from '@/lib/aiPreferences'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}))

vi.mock('@/components/LanguageSelector', () => ({
  LanguageSelector: () => null,
}))

vi.mock('@/lib/machineMode', () => ({
  isDirectMode: vi.fn(() => false),
  isDemoMode: vi.fn(() => false),
  isNativePlatform: vi.fn(() => false),
  getDefaultMachineUrl: vi.fn(() => 'http://meticulous.local:8080'),
  setMachineUrl: vi.fn(),
}))

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => ''),
}))

import { SettingsView } from './SettingsView'

const mockedIsDirectMode = vi.mocked(isDirectMode)
const mockedIsDemoMode = vi.mocked(isDemoMode)
const mockedIsNativePlatform = vi.mocked(isNativePlatform)

function settingsResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SettingsView proxy-mode AI key save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('__APP_VERSION__', 'test')
    localStorage.clear()
    mockedIsDirectMode.mockReturnValue(false)
    mockedIsDemoMode.mockReturnValue(false)
    mockedIsNativePlatform.mockReturnValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('dispatches AI_PREFS_CHANGED_EVENT after a successful API key save', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (String(url).endsWith('/api/settings') && method === 'POST') {
        return settingsResponse({ success: true })
      }
      // GET /api/settings and any other endpoint
      return settingsResponse({ geminiApiKeyConfigured: false, geminiApiKey: '', mqttEnabled: true })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await act(async () => {
      render(<SettingsView onBack={() => {}} />)
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const aiSection = await screen.findByText('settings.aiSettings')
    fireEvent.click(aiSection)

    const input = await screen.findByLabelText('settings.geminiApiKey')
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

    fireEvent.change(input, { target: { value: 'AIzaNEWKEY123' } })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 850))
    })

    const postCall = (fetchMock.mock.calls as unknown[][]).find(args => {
      const init = args[1] as RequestInit | undefined
      return String(args[0]).endsWith('/api/settings') && init?.method === 'POST'
    })
    expect(postCall).toBeTruthy()
    const postBody = JSON.parse((postCall?.[1] as RequestInit).body as string)
    expect(postBody.geminiApiKey).toBe('AIzaNEWKEY123')

    await waitFor(() => {
      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: AI_PREFS_CHANGED_EVENT }),
      )
    })
  })
})
