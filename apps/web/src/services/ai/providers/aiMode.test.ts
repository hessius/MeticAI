import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Control on-device support/configuration from the tests.
let supported = true
let localConfigured = true
vi.mock('./localLLM', () => ({
  isLocalLLMSupported: () => supported,
  isLocalLLMConfigured: () => localConfigured,
}))

import { STORAGE_KEYS } from '@/lib/constants'
import {
  getAIMode,
  setAIMode,
  getRouteForMethod,
  setRouteForMethod,
  resolveProviderIdForMethod,
  isAIConfigured,
  getActiveHostedProviderId,
} from './aiMode'

function setGeminiKey(value: string | null) {
  if (value === null) localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY)
  else localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, value)
}

beforeEach(() => {
  localStorage.clear()
  supported = true
  localConfigured = true
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getActiveHostedProviderId', () => {
  it('defaults to gemini when unset', () => {
    expect(getActiveHostedProviderId()).toBe('gemini')
  })
  it('coerces a stored "local" provider to the default hosted provider', () => {
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, 'local')
    expect(getActiveHostedProviderId()).toBe('gemini')
  })
  it('returns a real hosted selection verbatim', () => {
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, 'openai')
    expect(getActiveHostedProviderId()).toBe('openai')
  })
})

describe('getAIMode', () => {
  it('migrates a legacy local provider to local mode when supported', () => {
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, 'local')
    expect(getAIMode()).toBe('local')
  })
  it('migrates to hosted when no legacy local provider', () => {
    expect(getAIMode()).toBe('hosted')
  })
  it('honours an explicitly stored mode', () => {
    setAIMode('both')
    expect(getAIMode()).toBe('both')
  })
  it('degrades local to hosted on unsupported platforms when a key exists', () => {
    setAIMode('local')
    supported = false
    setGeminiKey('AIza-key')
    expect(getAIMode()).toBe('hosted')
  })
  it('degrades local to none on unsupported platforms without a key', () => {
    setAIMode('both')
    supported = false
    expect(getAIMode()).toBe('none')
  })
})

describe('getRouteForMethod / setRouteForMethod', () => {
  it('defaults to hosted', () => {
    expect(getRouteForMethod('analyzeShot')).toBe('hosted')
  })
  it('round-trips a local route', () => {
    setRouteForMethod('generateProfile', 'local')
    expect(getRouteForMethod('generateProfile')).toBe('local')
    // Independent of other methods.
    expect(getRouteForMethod('analyzeShot')).toBe('hosted')
  })
})

describe('resolveProviderIdForMethod', () => {
  it('returns hosted for hosted mode', () => {
    setAIMode('hosted')
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, 'openai')
    expect(resolveProviderIdForMethod('analyzeShot')).toBe('openai')
  })
  it('returns hosted for none mode', () => {
    setAIMode('none')
    expect(resolveProviderIdForMethod('analyzeShot')).toBe('gemini')
  })
  it('returns local for local mode', () => {
    setAIMode('local')
    expect(resolveProviderIdForMethod('analyzeShot')).toBe('local')
  })
  it('forces hosted when the request carries an image, even in local mode', () => {
    setAIMode('local')
    expect(resolveProviderIdForMethod('generateProfile', { hasImage: true })).toBe('gemini')
  })
  it('routes per-method in both mode', () => {
    setAIMode('both')
    setRouteForMethod('analyzeShot', 'local')
    setRouteForMethod('recommendations', 'hosted')
    expect(resolveProviderIdForMethod('analyzeShot')).toBe('local')
    expect(resolveProviderIdForMethod('recommendations')).toBe('gemini')
  })
  it('resolves hosted for generic (method-less) uses in both mode', () => {
    setAIMode('both')
    setRouteForMethod('analyzeShot', 'local')
    expect(resolveProviderIdForMethod()).toBe('gemini')
  })
})

describe('isAIConfigured', () => {
  it('is false in none mode', () => {
    setAIMode('none')
    setGeminiKey('AIza-key')
    expect(isAIConfigured()).toBe(false)
  })
  it('reflects on-device readiness in local mode', () => {
    setAIMode('local')
    localConfigured = true
    expect(isAIConfigured()).toBe(true)
    localConfigured = false
    expect(isAIConfigured()).toBe(false)
  })
  it('reflects the hosted key in hosted mode', () => {
    setAIMode('hosted')
    expect(isAIConfigured()).toBe(false)
    setGeminiKey('AIza-key')
    expect(isAIConfigured()).toBe(true)
  })
  it('is true in both mode when either backend is ready', () => {
    setAIMode('both')
    localConfigured = false
    setGeminiKey('')
    expect(isAIConfigured()).toBe(false)
    setGeminiKey('AIza-key')
    expect(isAIConfigured()).toBe(true)
    setGeminiKey('')
    localConfigured = true
    expect(isAIConfigured()).toBe(true)
  })
})
