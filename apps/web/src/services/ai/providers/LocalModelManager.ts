/**
 * On-device model lifecycle manager (#373).
 *
 * Handles the Gemma 4 download/delete/status lifecycle and device-capability
 * checks. Apple Intelligence needs none of this (it is a zero-download system
 * model), so this manager is concerned solely with the downloadable Gemma
 * backend.
 *
 * Native plugin notes:
 * - `@capgo/capacitor-llm` exposes `downloadModel()` + a `downloadProgress`
 *   event but no native cancel/delete. Cancel is therefore best-effort (we stop
 *   reacting to progress and never mark the model ready); delete removes the
 *   file via `@capacitor/filesystem`.
 */

import { CapgoLLM } from '@capgo/capacitor-llm'
import { Filesystem } from '@capacitor/filesystem'
import { Device } from '@capacitor/device'
import { STORAGE_KEYS } from '@/lib/constants'
import { AIServiceError } from '../aiErrors'
import {
  GEMMA_MODEL_ID,
  isAppleIntelligenceSupported,
  isLocalLLMSupported,
  setLocalBackend,
  type LocalBackend,
} from './localLLM'

export type ModelStatus = 'not-downloaded' | 'downloading' | 'ready' | 'error'

export interface DownloadProgress {
  /** 0–100, or `null` when the total size is unknown (indeterminate). */
  percent: number | null
  downloadedBytes?: number
  totalBytes?: number
}

export interface DeviceCapability {
  freeStorageBytes?: number
  totalMemoryBytes?: number
  /** ≥ {@link MIN_FREE_STORAGE_BYTES} free disk (when measurable). */
  enoughStorage: boolean
  /** ≥ {@link MIN_RAM_BYTES} total RAM (when measurable). */
  enoughMemory: boolean
}

/**
 * Approximate Gemma 4 E2B download size (~2.0 GB, measured from the HF LFS
 * redirect Content-Length). Used as a denominator for progress % when the
 * download stream does not report a total size (the HF xet CDN often omits
 * Content-Length, leaving the native delegate unable to compute a percentage).
 */
export const GEMMA_DOWNLOAD_BYTES = 2_003_697_664
/** Require ≥ 3 GB free before downloading. */
export const MIN_FREE_STORAGE_BYTES = 3_000_000_000
/** Recommend ≥ 4 GB total RAM. */
export const MIN_RAM_BYTES = 4_000_000_000

// `?download=true` forces the HuggingFace LFS endpoint to serve the file as an
// attachment (Content-Disposition), which some CDN paths need to expose a size
// and to avoid an inline-render redirect that can stall native downloaders.
const GEMMA_URLS = {
  ios: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task?download=true',
  android:
    'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm?download=true',
} as const

function getCapacitorPlatform(): string {
  const cap = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  try {
    return cap?.getPlatform?.() ?? 'web'
  } catch {
    return 'web'
  }
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

let downloading = false
let cancelled = false

/** Backends available on the current device. */
export function getAvailableBackends(): LocalBackend[] {
  if (!isLocalLLMSupported()) return []
  const backends: LocalBackend[] = []
  if (isAppleIntelligenceSupported()) backends.push('apple-intelligence')
  backends.push(GEMMA_MODEL_ID)
  return backends
}

/** Current Gemma model status. */
export function getModelStatus(): ModelStatus {
  if (downloading) return 'downloading'
  return readLS(STORAGE_KEYS.LOCAL_MODEL_PATH)?.trim() ? 'ready' : 'not-downloaded'
}

/** Device RAM/storage capability for the Gemma download. */
export async function checkDeviceCapability(): Promise<DeviceCapability> {
  try {
    const info = (await Device.getInfo()) as {
      realDiskFree?: number
      diskFree?: number
      memUsed?: number
      // Capacitor doesn't expose total RAM directly; some platforms include it.
      totalMemory?: number
    }
    const freeStorageBytes = info.realDiskFree ?? info.diskFree
    const totalMemoryBytes = info.totalMemory
    return {
      freeStorageBytes,
      totalMemoryBytes,
      enoughStorage:
        freeStorageBytes === undefined || freeStorageBytes >= MIN_FREE_STORAGE_BYTES,
      enoughMemory:
        totalMemoryBytes === undefined || totalMemoryBytes >= MIN_RAM_BYTES,
    }
  } catch {
    // Unknown capability — don't block; surface as "measurable: unknown".
    return { enoughStorage: true, enoughMemory: true }
  }
}

/**
 * Download the Gemma model for the current platform, reporting progress. On
 * success the model path is persisted and the active local backend is switched
 * to Gemma. Throws {@link AIServiceError} on unsupported platforms or failure.
 */
export async function downloadModel(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (!isLocalLLMSupported()) throw new AIServiceError('LOCAL_UNAVAILABLE')
  if (downloading) return

  const platform = getCapacitorPlatform()
  const url = platform === 'android' ? GEMMA_URLS.android : GEMMA_URLS.ios

  downloading = true
  cancelled = false

  console.log('[LocalModelManager] starting Gemma download', { platform, url })

  const progressSub = await CapgoLLM.addListener('downloadProgress', (event) => {
    if (cancelled) return
    const downloadedBytes = event.downloadedBytes
    const totalBytes = event.totalBytes
    let percent = event.progress
    // Fallback: the native delegate reports a percentage from the response's
    // total size, but the HF xet CDN may not provide Content-Length, leaving
    // `progress` at 0. Derive it from bytes-downloaded against the known model
    // size instead, so the UI advances rather than sitting at 0%.
    if (
      (percent == null || percent <= 0) &&
      typeof downloadedBytes === 'number' &&
      downloadedBytes > 0
    ) {
      percent = (downloadedBytes / GEMMA_DOWNLOAD_BYTES) * 100
    }
    // When neither a real percentage nor a byte count is available (e.g. the
    // iOS delegate never fires incremental events for a chunk-transfer CDN
    // download), report `null` so the UI shows an indeterminate spinner rather
    // than a stuck 0%.
    const hasMeaningfulPercent = typeof percent === 'number' && percent > 0
    const reportedPercent = hasMeaningfulPercent
      ? Math.max(0, Math.min(100, percent as number))
      : null
    console.log('[LocalModelManager] downloadProgress', {
      rawProgress: event.progress,
      downloadedBytes,
      totalBytes,
      computedPercent: reportedPercent,
    })
    onProgress?.({
      percent: reportedPercent,
      downloadedBytes,
      totalBytes,
    })
  })

  try {
    const result = await CapgoLLM.downloadModel({ url })
    if (cancelled) {
      // Best-effort: discard a download the user asked to cancel.
      console.log('[LocalModelManager] download cancelled; discarding', result.path)
      await deleteFileQuietly(result.path)
      return
    }
    console.log('[LocalModelManager] download complete', { path: result.path })
    writeLS(STORAGE_KEYS.LOCAL_MODEL_PATH, result.path)
    setLocalBackend(GEMMA_MODEL_ID)
    onProgress?.({ percent: 100 })
  } catch (err) {
    if (cancelled) return
    console.error('[LocalModelManager] download failed', err)
    throw new AIServiceError('LOCAL_UNAVAILABLE', err)
  } finally {
    downloading = false
    await progressSub.remove().catch(() => {})
  }
}

/**
 * Best-effort cancel. The plugin cannot abort an in-flight native download, so
 * this flags the operation; any completed file is removed and the model is left
 * un-persisted.
 */
export function cancelDownload(): void {
  if (downloading) cancelled = true
}

async function deleteFileQuietly(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path })
  } catch {
    /* best effort */
  }
}

/** Delete the downloaded Gemma model and clear its persisted path. */
export async function deleteModel(): Promise<void> {
  const path = readLS(STORAGE_KEYS.LOCAL_MODEL_PATH)
  if (path?.trim()) await deleteFileQuietly(path.trim())
  removeLS(STORAGE_KEYS.LOCAL_MODEL_PATH)
}

/** Reset module state — test seam. */
export function __resetModelManagerForTests(): void {
  downloading = false
  cancelled = false
}
