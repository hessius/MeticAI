import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { CapgoLLM, Filesystem, Device, listeners } = vi.hoisted(() => {
  const sharedListeners: Record<string, Array<(e: unknown) => void>> = {
    downloadProgress: [],
  }
  return {
    listeners: sharedListeners,
    CapgoLLM: {
      downloadModel: vi.fn().mockResolvedValue({ path: '/models/gemma.task' }),
      addListener: vi.fn(async (event: string, fn: (e: unknown) => void) => {
        sharedListeners[event] = sharedListeners[event] ?? []
        sharedListeners[event].push(fn)
        return {
          remove: async () => {
            sharedListeners[event] = sharedListeners[event].filter(f => f !== fn)
          },
        }
      }),
    },
    Filesystem: { deleteFile: vi.fn().mockResolvedValue(undefined) },
    Device: { getInfo: vi.fn().mockResolvedValue({ realDiskFree: 10_000_000_000, totalMemory: 6_000_000_000 }) },
  }
})
vi.mock('@capgo/capacitor-llm', () => ({ CapgoLLM }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem }))
vi.mock('@capacitor/device', () => ({ Device }))

let supported = true
let appleSupported = true
vi.mock('./localLLM', () => ({
  GEMMA_MODEL_ID: 'gemma',
  isLocalLLMSupported: () => supported,
  isAppleIntelligenceSupported: () => appleSupported,
  setLocalBackend: vi.fn(),
}))

import { STORAGE_KEYS } from '@/lib/constants'
import { AIServiceError } from '../aiErrors'
import {
  getAvailableBackends,
  getModelStatus,
  checkDeviceCapability,
  downloadModel,
  deleteModel,
  cancelDownload,
  MIN_FREE_STORAGE_BYTES,
  GEMMA_DOWNLOAD_BYTES,
  __resetModelManagerForTests,
} from './LocalModelManager'

beforeEach(() => {
  localStorage.clear()
  supported = true
  appleSupported = true
  listeners.downloadProgress = []
  __resetModelManagerForTests()
  vi.clearAllMocks()
})

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor
})

describe('getAvailableBackends', () => {
  it('lists Apple Intelligence + Gemma on iOS', () => {
    expect(getAvailableBackends()).toEqual(['apple-intelligence', 'gemma'])
  })
  it('lists only Gemma when Apple Intelligence is unavailable (Android)', () => {
    appleSupported = false
    expect(getAvailableBackends()).toEqual(['gemma'])
  })
  it('lists nothing on unsupported platforms', () => {
    supported = false
    expect(getAvailableBackends()).toEqual([])
  })
})

describe('getModelStatus', () => {
  it('is not-downloaded when no path is persisted', () => {
    expect(getModelStatus()).toBe('not-downloaded')
  })
  it('is ready when a path is persisted', () => {
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, '/models/gemma.task')
    expect(getModelStatus()).toBe('ready')
  })
})

describe('checkDeviceCapability', () => {
  it('reports enough storage/memory from Device info', async () => {
    const cap = await checkDeviceCapability()
    expect(cap.enoughStorage).toBe(true)
    expect(cap.enoughMemory).toBe(true)
    expect(cap.freeStorageBytes).toBe(10_000_000_000)
  })
  it('flags low storage', async () => {
    Device.getInfo.mockResolvedValueOnce({ realDiskFree: MIN_FREE_STORAGE_BYTES - 1 })
    const cap = await checkDeviceCapability()
    expect(cap.enoughStorage).toBe(false)
  })
  it('degrades gracefully when Device info throws', async () => {
    Device.getInfo.mockRejectedValueOnce(new Error('nope'))
    const cap = await checkDeviceCapability()
    expect(cap.enoughStorage).toBe(true)
    expect(cap.enoughMemory).toBe(true)
  })
})

describe('downloadModel', () => {
  it('downloads, reports progress, and persists the path', async () => {
    const progress: number[] = []
    const promise = downloadModel(p => progress.push(p.percent))
    // Emit a progress event mid-flight.
    listeners.downloadProgress.forEach(fn => fn({ progress: 42 }))
    await promise
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_MODEL_PATH)).toBe('/models/gemma.task')
    expect(progress).toContain(42)
    expect(progress).toContain(100)
    expect(getModelStatus()).toBe('ready')
  })
  it('derives progress from bytes when the stream omits a percentage', async () => {
    const progress: number[] = []
    const promise = downloadModel(p => progress.push(p.percent))
    // HF xet CDN case: no `progress`/`totalBytes`, only bytes downloaded so far.
    listeners.downloadProgress.forEach(fn =>
      fn({ progress: 0, downloadedBytes: GEMMA_DOWNLOAD_BYTES / 2 }),
    )
    await promise
    // Half of the known model size ⇒ ~50%.
    expect(progress.some(p => p >= 49 && p <= 51)).toBe(true)
  })
  it('caps derived progress at 100% when bytes exceed the expected size', async () => {
    const progress: number[] = []
    const promise = downloadModel(p => progress.push(p.percent))
    listeners.downloadProgress.forEach(fn =>
      fn({ progress: 0, downloadedBytes: GEMMA_DOWNLOAD_BYTES * 2 }),
    )
    await promise
    expect(Math.max(...progress)).toBeLessThanOrEqual(100)
  })
  it('throws on unsupported platforms', async () => {
    supported = false
    await expect(downloadModel()).rejects.toThrow(AIServiceError)
  })
  it('wraps a download failure as AIServiceError', async () => {
    CapgoLLM.downloadModel.mockRejectedValueOnce(new Error('network'))
    await expect(downloadModel()).rejects.toThrow(AIServiceError)
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_MODEL_PATH)).toBeNull()
  })
  it('discards a cancelled download and leaves the model un-persisted', async () => {
    CapgoLLM.downloadModel.mockImplementationOnce(async () => {
      cancelDownload()
      return { path: '/models/gemma.task' }
    })
    await downloadModel()
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_MODEL_PATH)).toBeNull()
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({ path: '/models/gemma.task' })
  })
})

describe('deleteModel', () => {
  it('removes the file and clears the persisted path', async () => {
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_PATH, '/models/gemma.task')
    await deleteModel()
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({ path: '/models/gemma.task' })
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_MODEL_PATH)).toBeNull()
    expect(getModelStatus()).toBe('not-downloaded')
  })
  it('is a no-op when nothing is downloaded', async () => {
    await deleteModel()
    expect(Filesystem.deleteFile).not.toHaveBeenCalled()
  })
})
