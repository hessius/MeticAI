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
  getSelectableProviderIds,
  HOSTED_PROVIDER_IDS,
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

  it('falls back from a stored on-device selection on unsupported platforms', () => {
    // jsdom is not native iOS → local is unsupported.
    setActiveProviderId('local')
    expect(getActiveProviderId()).toBe('gemini')
  })
})

describe('getSelectableProviderIds', () => {
  it('excludes on-device local where unsupported (web/jsdom)', () => {
    expect(getSelectableProviderIds()).not.toContain('local')
    expect(getSelectableProviderIds()).toContain('gemini')
  })
})

describe('local provider registry entry', () => {
  it('registers a text-only, keyless on-device descriptor', () => {
    expect(PROVIDERS.local.capabilities).toEqual({
      text: true,
      vision: false,
      imageGen: false,
      jsonMode: false,
    })
    expect(PROVIDERS.local.keyPrefixes).toEqual([])
    expect(HOSTED_PROVIDER_IDS).not.toContain('local')
  })

  it('resolves the LocalLLMProvider implementation for id "local"', () => {
    expect(getProvider('local').id).toBe('local')
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

  it('generates an image via OpenAI /images/generations (b64_json → PNG Blob)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    })
    const blob = await provider().generateImage('a latte')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
    expect(await blob.text()).toBe('hello')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-image-1')
    expect(body.prompt).toBe('a latte')
    // gpt-image-1 rejects response_format.
    expect(body.response_format).toBeUndefined()
  })

  it('falls back from gpt-image-1 to dall-e-3 on an org-verification (403) error', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'must be verified' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }) })
    const blob = await provider().generateImage('a latte')
    expect(await blob.text()).toBe('hello')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(secondBody.model).toBe('dall-e-3')
    // dall-e-* needs response_format to return base64.
    expect(secondBody.response_format).toBe('b64_json')
  })

  it('surfaces IMAGE_NO_DATA when OpenAI returns no image payload', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    await expect(provider().generateImage('x')).rejects.toMatchObject({ code: 'IMAGE_NO_DATA' })
  })

  it('generates an image via OpenRouter POST /images', async () => {
    setProviderApiKey('openrouter', 'sk-or-test')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    })
    const blob = await new OpenAICompatProvider(PROVIDERS.openrouter).generateImage('a latte')
    expect(await blob.text()).toBe('hello')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/images')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('google/gemini-2.5-flash-image')
    expect(body.prompt).toBe('a latte')
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
