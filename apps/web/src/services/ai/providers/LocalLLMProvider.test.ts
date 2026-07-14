import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the native plugin and platform detection before importing the modules.
const { listeners, CapgoLLM, Filesystem } = vi.hoisted(() => {
  const sharedListeners: Record<string, Array<(e: unknown) => void>> = {
    textFromAi: [],
    aiFinished: [],
    generationError: [],
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
  // By default the model file exists (stat resolves); tests override `stat` to
  // simulate a missing/dangling path.
  const fs = {
    stat: vi.fn().mockResolvedValue({ type: 'file', size: 1 }),
    getUri: vi.fn(async ({ path }: { directory: string; path: string }) => ({
      uri: `file:///var/mobile/Containers/Data/Application/NEW-UUID/Documents/${path}`,
    })),
  }
  return { listeners: sharedListeners, CapgoLLM: plugin, Filesystem: fs }
})
vi.mock('@capgo/capacitor-llm', () => ({ CapgoLLM }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem, Directory: { Documents: 'DOCUMENTS' } }))

let nativeSupported = true
vi.mock('@/lib/machineMode', () => ({
  isNativePlatform: () => nativeSupported,
}))

import {
  isLocalLLMSupported,
  isLocalLLMConfigured,
  refreshLocalReadiness,
  resolveGemmaModelPath,
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
  listeners.generationError = []
  localStorage.clear()
  __resetLocalLLMCacheForTests()
  vi.clearAllMocks()
  // Restore default Filesystem behaviour (model file present) — some tests set
  // persistent rejections/implementations that would otherwise leak.
  Filesystem.stat.mockResolvedValue({ type: 'file', size: 1 })
  Filesystem.getUri.mockImplementation(async ({ path }: { directory: string; path: string }) => ({
    uri: `file:///var/mobile/Containers/Data/Application/NEW-UUID/Documents/${path}`,
  }))
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

  it('rejects with a generation-failed error when the engine emits generationError', async () => {
    CapgoLLM.sendMessage.mockImplementationOnce(async ({ chatId }: { chatId: string }) => {
      listeners.textFromAi.forEach(fn => fn({ chatId, text: 'partial' }))
      listeners.generationError.forEach(fn => fn({ chatId, error: 'engine aborted mid-decode' }))
    })
    await expect(generateLocalText('Say hi')).rejects.toMatchObject({
      name: 'AIServiceError',
      code: 'LOCAL_GENERATION_FAILED',
    })
  })

  it('maps an out-of-memory generationError to LOCAL_OUT_OF_MEMORY', async () => {
    CapgoLLM.sendMessage.mockImplementationOnce(async ({ chatId }: { chatId: string }) => {
      listeners.generationError.forEach(fn => fn({ chatId, error: 'failed to allocate: out of memory' }))
    })
    await expect(generateLocalText('Say hi')).rejects.toMatchObject({
      code: 'LOCAL_OUT_OF_MEMORY',
    })
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

  it('heals a dangling Gemma path when the iOS container UUID changed', async () => {
    setPlatform('ios', true)
    const stale = '/var/mobile/Containers/Data/Application/OLD-UUID/Documents/gemma-4-E2B-it.litertlm'
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, stale)
    setLocalBackend(GEMMA_MODEL_ID)
    // The stored (old-container) path no longer exists, but the re-resolved
    // current-container path does.
    Filesystem.stat.mockImplementation(async ({ path }: { path: string }) => {
      if (path.includes('OLD-UUID')) throw new Error('No such file')
      if (path.includes('NEW-UUID')) return { type: 'file', size: 1 }
      throw new Error('No such file')
    })
    await generateLocalText('Say hi')
    const healed = '/var/mobile/Containers/Data/Application/NEW-UUID/Documents/gemma-4-E2B-it.litertlm'
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_MODEL_PATH)).toBe(healed)
    expect(CapgoLLM.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ path: healed, modelType: 'litertlm' }),
    )
  })

  it('reports not-downloaded and clears the entry when the model file is truly gone', async () => {
    setPlatform('ios', true)
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, '/var/mobile/gone/gemma-4-E2B-it.litertlm')
    setLocalBackend(GEMMA_MODEL_ID)
    Filesystem.stat.mockRejectedValue(new Error('No such file'))
    await expect(generateLocalText('Say hi')).rejects.toThrow(AIServiceError)
    expect(CapgoLLM.setModel).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_MODEL_PATH)).toBeNull()
  })

  it('resolveGemmaModelPath returns the stored path unchanged when the file exists', async () => {
    setPlatform('ios', true)
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, '/models/gemma-4-E2B-it.litertlm')
    setLocalBackend(GEMMA_MODEL_ID)
    Filesystem.stat.mockResolvedValue({ type: 'file', size: 1 })
    expect(await resolveGemmaModelPath()).toBe('/models/gemma-4-E2B-it.litertlm')
    expect(Filesystem.getUri).not.toHaveBeenCalled()
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
    expect(p.capabilities).toEqual({
      text: true, vision: false, imageGen: false, jsonMode: false, contextWindowTokens: 4096,
    })
    expect(p.generateImage).toBeUndefined()
    expect(p.detectFromKey('whatever')).toBe(false)
  })

  it('advertises a small context window so call sites request compact prompts', () => {
    const p: AIProvider = new LocalLLMProvider()
    expect(p.capabilities.contextWindowTokens).toBeLessThanOrEqual(4096)
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
