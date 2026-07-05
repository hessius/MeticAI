import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the native plugin and platform detection before importing the modules.
const { listeners, CapgoLLM } = vi.hoisted(() => {
  const sharedListeners: Record<string, Array<(e: unknown) => void>> = {
    textFromAi: [],
    aiFinished: [],
  }
  const plugin = {
    setModel: vi.fn().mockResolvedValue(undefined),
    createChat: vi.fn().mockResolvedValue({ id: 'chat-1' }),
    getReadiness: vi.fn().mockResolvedValue({ readiness: 'ready' }),
    sendMessage: vi.fn(async ({ chatId }: { chatId: string; message: string }) => {
      sharedListeners.textFromAi.forEach(fn => fn({ chatId, text: 'Hello ' }))
      sharedListeners.textFromAi.forEach(fn => fn({ chatId, text: 'world' }))
      sharedListeners.aiFinished.forEach(fn => fn({ chatId }))
    }),
    addListener: vi.fn(async (event: string, fn: (e: unknown) => void) => {
      sharedListeners[event] = sharedListeners[event] ?? []
      sharedListeners[event].push(fn)
      return {
        remove: async () => {
          sharedListeners[event] = sharedListeners[event].filter(f => f !== fn)
        },
      }
    }),
  }
  return { listeners: sharedListeners, CapgoLLM: plugin }
})
vi.mock('@capgo/capacitor-llm', () => ({ CapgoLLM }))

let nativeSupported = true
vi.mock('@/lib/machineMode', () => ({
  isNativePlatform: () => nativeSupported,
}))

import {
  isLocalLLMSupported,
  isLocalLLMConfigured,
  refreshLocalReadiness,
  generateLocalText,
  getGemmaModelPath,
  setLocalBackend,
  GEMMA_MODEL_ID,
  __resetLocalLLMCacheForTests,
} from './localLLM'
import { LocalLLMProvider, contentsToPrompt } from './LocalLLMProvider'
import type { AIProvider } from './AIProvider'
import { AIServiceError } from '../aiErrors'
import { STORAGE_KEYS } from '@/lib/constants'

function setPlatform(platform: string, native = true) {
  nativeSupported = native
  ;(globalThis as { Capacitor?: unknown }).Capacitor = {
    getPlatform: () => platform,
    isNativePlatform: () => native,
  }
}

beforeEach(() => {
  listeners.textFromAi = []
  listeners.aiFinished = []
  localStorage.clear()
  __resetLocalLLMCacheForTests()
  vi.clearAllMocks()
  setPlatform('ios', true)
})

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor
})

describe('isLocalLLMSupported', () => {
  it('is true only on native iOS', () => {
    setPlatform('ios', true)
    expect(isLocalLLMSupported()).toBe(true)
  })
  it('is true on android native (Gemma)', () => {
    setPlatform('android', true)
    expect(isLocalLLMSupported()).toBe(true)
  })
  it('is false on web', () => {
    setPlatform('web', false)
    expect(isLocalLLMSupported()).toBe(false)
  })
})

describe('refreshLocalReadiness', () => {
  it('reports ready and caches the result', async () => {
    const result = await refreshLocalReadiness()
    expect(result.ready).toBe(true)
    expect(isLocalLLMConfigured()).toBe(true)
  })
  it('reports unavailable on unsupported platforms without calling the plugin', async () => {
    setPlatform('web', false)
    const result = await refreshLocalReadiness()
    expect(result.ready).toBe(false)
    expect(CapgoLLM.getReadiness).not.toHaveBeenCalled()
    expect(isLocalLLMConfigured()).toBe(false)
  })
  it('caches a not-ready state from the plugin', async () => {
    CapgoLLM.getReadiness.mockResolvedValueOnce({ readiness: 'Apple Intelligence is not enabled' })
    const result = await refreshLocalReadiness()
    expect(result.ready).toBe(false)
    expect(isLocalLLMConfigured()).toBe(false)
  })
})

describe('generateLocalText', () => {
  it('accumulates streamed chunks until aiFinished', async () => {
    const text = await generateLocalText('Say hi')
    expect(text).toBe('Hello world')
    expect(CapgoLLM.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Apple Intelligence' }),
    )
  })

  it('loads Gemma through LiteRT-LM (modelType litertlm), not MediaPipe', async () => {
    setPlatform('android', true)
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, '/models/gemma-4-E2B-it.litertlm')
    setLocalBackend(GEMMA_MODEL_ID)
    await generateLocalText('Say hi')
    expect(CapgoLLM.setModel).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/models/gemma-4-E2B-it.litertlm',
        modelType: 'litertlm',
      }),
    )
    // The removed MediaPipe engine must never be requested.
    expect(CapgoLLM.setModel).not.toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'mediapipe' }),
    )
  })

  it('gives Gemma a context window large enough for the analysis prompt', async () => {
    setPlatform('android', true)
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, '/models/gemma-4-E2B-it.litertlm')
    setLocalBackend(GEMMA_MODEL_ID)
    // Default (no explicit maxTokens): must exceed the plugin's 2048 default that
    // the ~2900-token analysis prompt overran.
    await generateLocalText('Say hi')
    const call = CapgoLLM.setModel.mock.calls.at(-1)?.[0] as { maxTokens?: number }
    expect(call?.maxTokens).toBeGreaterThanOrEqual(4096)
  })

  it('rejects a stale pre-LiteRT-LM `.task` path as not downloaded (migration)', async () => {
    setPlatform('android', true)
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, '/models/gemma-4-E2B-it-web.task')
    setLocalBackend(GEMMA_MODEL_ID)
    // The migration-aware accessor discards the stale path...
    expect(getGemmaModelPath()).toBeNull()
    // ...so generation reports the model as not downloaded rather than crashing.
    await expect(generateLocalText('Say hi')).rejects.toThrow(AIServiceError)
    expect(CapgoLLM.setModel).not.toHaveBeenCalled()
  })

  it('reconstructs cumulative snapshot streams without duplication (Apple Intelligence)', async () => {
    // Apple Intelligence's `streamResponse` yields a growing *snapshot* of the
    // full text so far on every chunk (not deltas). The capgo plugin forwards
    // each snapshot's `.content` verbatim as a `textFromAi` event, so naive
    // `+=` concatenation produces the beta-reported "repeating but slowly
    // building up" output. The bridge must collapse snapshots to the final one.
    const snapshots = [
      '## 1. Shot Performance\nThe shot looks',
      '## 1. Shot Performance\nThe shot looks balanced and well extracted.',
      '## 1. Shot Performance\nThe shot looks balanced and well extracted.\n\n## 2. Recommendations\nTry a slightly finer grind.',
    ]
    CapgoLLM.sendMessage.mockImplementationOnce(async ({ chatId }: { chatId: string }) => {
      for (const s of snapshots) {
        listeners.textFromAi.forEach(fn => fn({ chatId, text: s, isChunk: true }))
      }
      listeners.aiFinished.forEach(fn => fn({ chatId }))
    })
    const text = await generateLocalText('Analyze this shot')
    expect(text).toBe(snapshots[snapshots.length - 1])
  })

  it('ignores a stale shorter snapshot arriving after a longer one', async () => {
    CapgoLLM.sendMessage.mockImplementationOnce(async ({ chatId }: { chatId: string }) => {
      listeners.textFromAi.forEach(fn => fn({ chatId, text: 'Full answer here.' }))
      listeners.textFromAi.forEach(fn => fn({ chatId, text: 'Full answer' }))
      listeners.aiFinished.forEach(fn => fn({ chatId }))
    })
    const text = await generateLocalText('x')
    expect(text).toBe('Full answer here.')
  })

  it('removes its listeners after completion', async () => {
    await generateLocalText('Say hi')
    expect(listeners.textFromAi).toHaveLength(0)
    expect(listeners.aiFinished).toHaveLength(0)
  })
  it('serialises concurrent calls', async () => {
    const [a, b] = await Promise.all([generateLocalText('one'), generateLocalText('two')])
    expect(a).toBe('Hello world')
    expect(b).toBe('Hello world')
    expect(CapgoLLM.createChat).toHaveBeenCalledTimes(2)
  })
  it('throws LOCAL_UNAVAILABLE on unsupported platforms', async () => {
    setPlatform('web', false)
    await expect(generateLocalText('x')).rejects.toThrow(AIServiceError)
  })
})

describe('contentsToPrompt', () => {
  it('flattens text parts across entries', () => {
    const prompt = contentsToPrompt([
      { role: 'user', parts: [{ text: 'system' }, { text: 'rules' }] },
      { role: 'user', parts: [{ text: 'question' }] },
    ])
    expect(prompt).toBe('system\nrules\n\nquestion')
  })
  it('accepts a bare string', () => {
    expect(contentsToPrompt('hello')).toBe('hello')
  })
  it('throws on image parts (vision unsupported)', () => {
    expect(() =>
      contentsToPrompt([{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'x' } }] }]),
    ).toThrow(AIServiceError)
  })
})

describe('LocalLLMProvider', () => {
  it('is text-only with no image generation', () => {
    const p: AIProvider = new LocalLLMProvider()
    expect(p.capabilities).toEqual({ text: true, vision: false, imageGen: false, jsonMode: false })
    expect(p.generateImage).toBeUndefined()
    expect(p.detectFromKey('whatever')).toBe(false)
  })
  it('generates text through the on-device bridge', async () => {
    const p = new LocalLLMProvider()
    const res = await p.generateText({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    expect(res.text).toBe('Hello world')
  })
  it('lists the Apple Intelligence model', async () => {
    const models = await new LocalLLMProvider().listModels()
    expect(models[0].id).toBe('apple-intelligence')
  })
  it('throws LOCAL_UNAVAILABLE when unsupported', async () => {
    setPlatform('web', false)
    await expect(new LocalLLMProvider().generateText({ contents: 'x' })).rejects.toThrow(AIServiceError)
  })
})
