/**
 * MachineService adapter parity tests — verify that MeticAIAdapter and
 * DirectAdapter implement the same public interface.
 *
 * These are structural/interface tests, not functional tests. We cannot
 * call the actual machine, but we CAN verify that both adapters export
 * the same method names and the `name` property.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock the heavy dependencies so we can import the adapters without
// actually connecting to a machine or backend.
// DirectAdapter uses CJS interop: `typeof ApiModule === 'function' ? ApiModule : ApiModule.default`
// so we provide a real constructor function as the default export.
vi.mock('@meticulous-home/espresso-api', () => {
  function MockApi() {
    return {
      connectToSocket: vi.fn(),
      disconnectSocket: vi.fn(),
      getSocket: vi.fn(() => null),
      executeAction: vi.fn(),
      listProfiles: vi.fn(() => ({ data: [] })),
      fetchAllProfiles: vi.fn(() => ({ data: [] })),
      getProfile: vi.fn(() => ({ data: {} })),
      saveProfile: vi.fn(() => ({ data: {} })),
      deleteProfile: vi.fn(),
      loadProfileByID: vi.fn(),
      loadProfileFromJSON: vi.fn(),
      setBrightness: vi.fn(),
      updateSetting: vi.fn(),
      getHistoryShortListing: vi.fn(() => ({ data: { history: [] } })),
      getLastShot: vi.fn(() => ({ data: null })),
      getSettings: vi.fn(() => ({ data: {} })),
      getDeviceInfo: vi.fn(() => ({ data: {} })),
    }
  }
  return { default: MockApi }
})

vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn(async () => 'http://localhost:3550'),
}))

vi.mock('@/services/api', () => ({
  apiFetch: vi.fn(async () => ({})),
}))

import { createMeticAIAdapter } from '@/services/machine/MeticAIAdapter'
import { createDirectAdapter } from '@/services/machine/DirectAdapter'
import type { MachineService } from '@/services/machine/MachineService'

describe('MachineService adapter interface parity', () => {
  const proxyAdapter = createMeticAIAdapter()
  const directAdapter = createDirectAdapter('http://test:8080')

  // -------------------------------------------------------------------
  // Both adapters satisfy the MachineService interface
  // -------------------------------------------------------------------
  describe('interface compliance', () => {
    it('MeticAIAdapter has a descriptive name', () => {
      expect(proxyAdapter.name).toBe('MeticAIAdapter')
    })

    it('DirectAdapter has a descriptive name', () => {
      expect(directAdapter.name).toBe('DirectAdapter')
    })
  })

  // -------------------------------------------------------------------
  // Method parity — same property keys
  // -------------------------------------------------------------------
  describe('method parity', () => {
    it('both adapters export identical property/method names', () => {
      const proxyKeys = Object.keys(proxyAdapter).sort()
      const directKeys = Object.keys(directAdapter).sort()
      expect(proxyKeys).toEqual(directKeys)
    })

    it('all methods that are functions in proxy are also functions in direct', () => {
      for (const key of Object.keys(proxyAdapter) as (keyof MachineService)[]) {
        const proxyType = typeof proxyAdapter[key]
        const directType = typeof directAdapter[key]
        expect(directType).toBe(proxyType)
      }
    })
  })

  // -------------------------------------------------------------------
  // Expected interface shape
  // -------------------------------------------------------------------
  describe('expected interface shape', () => {
    const EXPECTED_METHODS: (keyof MachineService)[] = [
      // Connection
      'connect', 'disconnect', 'isConnected', 'onConnectionChange',
      // Brewing
      'startShot', 'stopShot', 'abortShot', 'continueShot',
      // Machine
      'preheat', 'tareScale', 'homePlunger', 'purge',
      // Config
      'loadProfile', 'loadProfileFromJSON', 'setBrightness', 'enableSounds',
      // Profiles
      'listProfiles', 'fetchAllProfiles', 'getProfile', 'saveProfile', 'deleteProfile',
      // Telemetry
      'onStatus', 'onActuators', 'onHeaterStatus', 'onNotification', 'onProfileUpdate',
      // History
      'getHistoryListing', 'getLastShot',
      // Settings
      'getSettings', 'updateSetting', 'getDeviceInfo',
    ]

    it.each(EXPECTED_METHODS)(
      'MeticAIAdapter implements %s',
      (method) => {
        expect(proxyAdapter).toHaveProperty(method)
        if (method !== 'name') {
          expect(typeof proxyAdapter[method]).toBe('function')
        }
      },
    )

    it.each(EXPECTED_METHODS)(
      'DirectAdapter implements %s',
      (method) => {
        expect(directAdapter).toHaveProperty(method)
        if (method !== 'name') {
          expect(typeof directAdapter[method]).toBe('function')
        }
      },
    )

    it('no unexpected methods exist on MeticAIAdapter', () => {
      const expected = new Set([...EXPECTED_METHODS, 'name'] as string[])
      const actual = Object.keys(proxyAdapter)
      const unexpected = actual.filter(k => !expected.has(k))
      expect(unexpected).toEqual([])
    })

    it('no unexpected methods exist on DirectAdapter', () => {
      const expected = new Set([...EXPECTED_METHODS, 'name'] as string[])
      const actual = Object.keys(directAdapter)
      const unexpected = actual.filter(k => !expected.has(k))
      expect(unexpected).toEqual([])
    })
  })

  // -------------------------------------------------------------------
  // Telemetry subscriptions return unsubscribe functions
  // -------------------------------------------------------------------
  describe('telemetry subscriptions return unsubscribe functions', () => {
    const TELEMETRY_METHODS = [
      'onStatus', 'onActuators', 'onHeaterStatus',
      'onNotification', 'onProfileUpdate', 'onConnectionChange',
    ] as const

    it.each(TELEMETRY_METHODS)(
      '%s returns an unsubscribe function in proxy adapter',
      (method) => {
        const unsub = (proxyAdapter[method] as (cb: () => void) => () => void)(() => {})
        expect(typeof unsub).toBe('function')
      },
    )

    it.each(TELEMETRY_METHODS)(
      '%s returns an unsubscribe function in direct adapter',
      (method) => {
        const unsub = (directAdapter[method] as (cb: () => void) => () => void)(() => {})
        expect(typeof unsub).toBe('function')
      },
    )
  })
})

// ---------------------------------------------------------------------------
// AIService adapter interface parity
// ---------------------------------------------------------------------------

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn(),
      generateImages: vi.fn(),
    },
  })),
}))

vi.mock('@/services/ai/prompts', () => ({
  buildShotAnalysisPrompt: vi.fn(() => ''),
  buildImagePrompt: vi.fn(() => ''),
  buildRecommendationPrompt: vi.fn(() => ''),
  buildDialInPrompt: vi.fn(() => ''),
}))

vi.mock('@/services/ai/profilePromptFull', () => ({
  buildFullProfilePrompt: vi.fn(() => ''),
  validateAndRetryProfile: vi.fn(async () => ({ profileJson: null, reply: '' })),
}))

vi.mock('@/lib/constants', () => ({
  STORAGE_KEYS: {
    GEMINI_API_KEY: 'gemini_api_key',
    GEMINI_MODEL: 'gemini_model',
    AUTHOR_NAME: 'author_name',
  },
}))

import { createProxyAIService } from '@/services/ai/ProxyAIService'
import { createBrowserAIService } from '@/services/ai/BrowserAIService'
import type { AIService } from '@/services/ai/AIService'

describe('AIService adapter interface parity', () => {
  const proxyAI = createProxyAIService()
  const browserAI = createBrowserAIService()

  describe('interface compliance', () => {
    it('ProxyAIService has a descriptive name', () => {
      expect(proxyAI.name).toBe('ProxyAIService')
    })

    it('BrowserAIService has a descriptive name', () => {
      expect(browserAI.name).toBe('BrowserAIService')
    })
  })

  describe('method parity', () => {
    it('both AI adapters export identical property/method names', () => {
      const proxyKeys = Object.keys(proxyAI).sort()
      const browserKeys = Object.keys(browserAI).sort()
      expect(proxyKeys).toEqual(browserKeys)
    })

    it('all methods that are functions in proxy are also functions in browser', () => {
      for (const key of Object.keys(proxyAI) as (keyof AIService)[]) {
        expect(typeof browserAI[key]).toBe(typeof proxyAI[key])
      }
    })
  })

  describe('expected AIService shape', () => {
    const EXPECTED_METHODS: (keyof AIService)[] = [
      'isConfigured',
      'generateProfile',
      'analyzeShot',
      'generateImage',
      'getRecommendations',
      'createDialInSession',
      'getDialInRecommendation',
    ]

    it.each(EXPECTED_METHODS)(
      'ProxyAIService implements %s',
      (method) => {
        expect(proxyAI).toHaveProperty(method)
        expect(typeof proxyAI[method]).toBe('function')
      },
    )

    it.each(EXPECTED_METHODS)(
      'BrowserAIService implements %s',
      (method) => {
        expect(browserAI).toHaveProperty(method)
        expect(typeof browserAI[method]).toBe('function')
      },
    )

    it('no unexpected methods exist on either AI adapter', () => {
      const expected = new Set([...EXPECTED_METHODS, 'name'] as string[])
      expect(Object.keys(proxyAI).filter(k => !expected.has(k))).toEqual([])
      expect(Object.keys(browserAI).filter(k => !expected.has(k))).toEqual([])
    })
  })
})
