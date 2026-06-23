import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/lib/constants'
import { AIServiceError } from '../aiErrors'
import {
  OpenAICompatProvider,
  contentsToMessages,
} from './OpenAICompatProvider'
import {
  detectProviderFromKey,
  getActiveProviderId,
  getProviderApiKey,
  setActiveProviderId,
  setProviderApiKey,
  setProviderModel,
  PROVIDERS,
} from './providerRegistry'
import { getActiveProvider, getProvider } from './index'

describe('detectProviderFromKey', () => {
  it('detects unambiguous prefixes', () => {
    expect(detectProviderFromKey('AIzaSyExample')).toBe('gemini')
    expect(detectProviderFromKey('sk-or-v1-abc')).toBe('openrouter')
    expect(detectProviderFromKey('sk-proj-abc')).toBe('openai')
  })
  it('falls back to openai for ambiguous sk- keys', () => {
    expect(detectProviderFromKey('sk-abc123')).toBe('openai')
  })
  it('returns null for empty / unknown keys', () => {
    expect(detectProviderFromKey('')).toBeNull()
    expect(detectProviderFromKey('whatever')).toBeNull()
  })
})

describe('provider config storage', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to gemini and persists selection', () => {
    expect(getActiveProviderId()).toBe('gemini')
    setActiveProviderId('deepseek')
    expect(getActiveProviderId()).toBe('deepseek')
  })

  it('stores gemini key under the legacy key for backward compatibility', () => {
    setProviderApiKey('gemini', 'AIzaLegacy')
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)).toBe('AIzaLegacy')
    expect(getProviderApiKey('gemini')).toBe('AIzaLegacy')
  })

  it('namespaces non-gemini keys', () => {
    setProviderApiKey('openai', 'sk-openai')
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)).toBeNull()
    expect(getProviderApiKey('openai')).toBe('sk-openai')
  })
})

describe('contentsToMessages', () => {
  it('flattens text parts to a string when no image', () => {
    const msgs = contentsToMessages(
      [{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }],
      true,
    )
    expect(msgs).toEqual([{ role: 'user', content: 'a\nb' }])
  })

  it('maps model role to assistant', () => {
    const msgs = contentsToMessages([{ role: 'model', parts: [{ text: 'x' }] }], false)
    expect(msgs[0].role).toBe('assistant')
  })

  it('emits image_url parts only when vision is supported', () => {
    const contents = [
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'hi' }] },
    ]
    const withVision = contentsToMessages(contents, true)
    expect(Array.isArray(withVision[0].content)).toBe(true)
    const arr = withVision[0].content as Array<{ type: string }>
    expect(arr.some(p => p.type === 'image_url')).toBe(true)

    const noVision = contentsToMessages(contents, false)
    expect(typeof noVision[0].content).toBe('string')
  })
})

describe('OpenAICompatProvider', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    localStorage.clear()
    setProviderApiKey('openai', 'sk-test')
    setProviderModel('openai', 'gpt-4o-mini')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  const provider = () => new OpenAICompatProvider(PROVIDERS.openai)

  it('posts chat completions and returns the message text', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
    })
    const res = await provider().generateText({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    expect(res.text).toBe('hello')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' })
  })

  it('maps a 401 to API_KEY_INVALID', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'no' })
    await expect(provider().generateText({ contents: 'x' })).rejects.toMatchObject({
      code: 'API_KEY_INVALID',
    })
  })

  it('throws API_KEY_MISSING when unconfigured', async () => {
    localStorage.clear()
    await expect(provider().generateText({ contents: 'x' })).rejects.toBeInstanceOf(AIServiceError)
  })

  it('lists chat models and drops embeddings/audio, default first', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'text-embedding-3-small' },
          { id: 'gpt-4o' },
          { id: 'whisper-1' },
          { id: 'gpt-4o-mini' },
        ],
      }),
    })
    const models = await provider().listModels()
    const ids = models.map(m => m.id)
    expect(ids).toContain('gpt-4o')
    expect(ids).not.toContain('text-embedding-3-small')
    expect(ids).not.toContain('whisper-1')
    expect(ids[0]).toBe('gpt-4o-mini') // configured default first
  })

  it('falls back to static models when discovery fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const models = await provider().listModels()
    expect(models).toEqual(PROVIDERS.openai.staticModels)
  })
})

describe('getActiveProvider', () => {
  beforeEach(() => localStorage.clear())
  it('returns the gemini provider by default', () => {
    expect(getActiveProvider().id).toBe('gemini')
  })
  it('returns an OpenAI-compat provider when selected', () => {
    setActiveProviderId('deepseek')
    expect(getActiveProvider().id).toBe('deepseek')
    expect(getActiveProvider().capabilities.imageGen).toBe(false)
  })
  it('caches OpenAI-compat instances per id', () => {
    expect(getProvider('openai')).toBe(getProvider('openai'))
  })
})
