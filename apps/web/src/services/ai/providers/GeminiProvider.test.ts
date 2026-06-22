import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleGenAI } from '@google/genai'
import { STORAGE_KEYS } from '@/lib/constants'
import { AIServiceError } from '../aiErrors'
import { STATIC_FALLBACK_MODELS } from '../modelResolver'
import { geminiProvider } from './GeminiProvider'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      models: {
        get: vi.fn(),
        generateContent: generateContentMock,
        generateImages: vi.fn(),
        list: vi.fn().mockRejectedValue(new Error('model list failed')),
      },
    }
  }),
}))

describe('GeminiProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    generateContentMock.mockReset()
  })

  it('detects Gemini API keys by AIza prefix only', () => {
    expect(geminiProvider.detectFromKey('AIzaSyExample')).toBe(true)
    expect(geminiProvider.detectFromKey('  AIzaSyExample')).toBe(true)
    expect(geminiProvider.detectFromKey('sk-example')).toBe(false)
    expect(geminiProvider.detectFromKey('')).toBe(false)
  })

  it('exposes Gemini capabilities', () => {
    expect(geminiProvider.capabilities).toEqual({
      text: true,
      vision: true,
      imageGen: true,
      jsonMode: true,
    })
  })

  it('reports configured state from localStorage key presence', () => {
    expect(geminiProvider.isConfigured()).toBe(false)

    localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, 'AIzaSyExample')

    expect(geminiProvider.isConfigured()).toBe(true)
  })

  it('falls back to static models when Gemini model listing throws', async () => {
    localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, 'AIzaSyExample')

    await expect(geminiProvider.listModels()).resolves.toEqual(STATIC_FALLBACK_MODELS)
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'AIzaSyExample' })
  })

  it('preserves missing API key errors from text generation', async () => {
    await expect(geminiProvider.generateText({ contents: 'hello' })).rejects.toMatchObject({
      code: 'API_KEY_MISSING',
    } satisfies Partial<AIServiceError>)
  })

  it('wraps raw transient Gemini text errors as retryable typed errors', async () => {
    localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, 'AIzaSyExample')
    generateContentMock.mockRejectedValue(new Error('503 UNAVAILABLE: overloaded'))

    await expect(geminiProvider.generateText({ contents: 'hello' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    } satisfies Partial<AIServiceError>)
  })
})
