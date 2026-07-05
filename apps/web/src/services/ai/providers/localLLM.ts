/**
 * On-device LLM bridge (#373).
 *
 * Wraps `@capgo/capacitor-llm` for two local backends:
 *
 * - **Apple Intelligence** — iOS 26+, A17 Pro and later. Zero download, system
 *   model loaded via `setModel({ path: 'Apple Intelligence' })`.
 * - **Gemma 4 E2B-IT** — iOS and Android. Requires a ~2.6 GB model download
 *   (managed by {@link LocalModelManager}); loaded via LiteRT-LM from the
 *   downloaded `.litertlm` file path (`modelType: 'litertlm'`).
 *
 * The plugin is event-driven: `sendMessage` resolves immediately and the
 * generated text arrives as a stream of `textFromAi` events terminated by an
 * `aiFinished` event. This module adapts that into a single awaitable call and
 * serialises concurrent requests (the native session generates one reply at a
 * time).
 */

import { CapgoLLM } from '@capgo/capacitor-llm'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { isNativePlatform } from '@/lib/machineMode'
import { STORAGE_KEYS } from '@/lib/constants'
import { AIServiceError } from '../aiErrors'

/** Local backends supported in #373. */
export type LocalBackend = 'apple-intelligence' | 'gemma-4-e2b'

export const APPLE_INTELLIGENCE_MODEL_ID = 'apple-intelligence'
export const GEMMA_MODEL_ID = 'gemma-4-e2b'

/**
 * LiteRT-LM context window (input + output tokens) for Gemma. The plugin
 * defaults to 2048, which the shot-analysis prompt (~2900 tokens) overruns
 * with "exceeding the maximum number of tokens allowed". 4096 fits the prompt
 * with headroom for the response while staying within E2B's on-device memory.
 */
export const GEMMA_CONTEXT_TOKENS = 4096

/** The plugin reports this exact readiness string when the model is usable. */
const READY = 'ready'

/**
 * Hard ceiling for a single on-device generation before we give up (ms).
 * Gemma runs on the CPU (XNNPack) backend on iOS for stability, which is slower
 * than GPU, so a long analysis prompt can take a few minutes on-device.
 */
const GENERATION_TIMEOUT_MS = 240_000

function getCapacitorPlatform(): string {
  const cap = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  try {
    return cap?.getPlatform?.() ?? 'web'
  } catch {
    return 'web'
  }
}

function isIOS(): boolean {
  return isNativePlatform() && getCapacitorPlatform() === 'ios'
}

function isAndroid(): boolean {
  return isNativePlatform() && getCapacitorPlatform() === 'android'
}

/** Apple Intelligence is iOS-only. */
export function isAppleIntelligenceSupported(): boolean {
  return isIOS()
}

/**
 * Whether on-device AI can be offered at all on this platform. Apple
 * Intelligence is iOS-only; Gemma runs on both iOS and Android, so any native
 * iOS/Android build qualifies. The web build never does.
 */
export function isLocalLLMSupported(): boolean {
  return isIOS() || isAndroid()
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

/**
 * The selected on-device backend. Defaults to Apple Intelligence on iOS (no
 * download) and Gemma on Android (the only local option there).
 */
export function getLocalBackend(): LocalBackend {
  const stored = readLS(STORAGE_KEYS.LOCAL_MODEL_TYPE)
  if (stored === APPLE_INTELLIGENCE_MODEL_ID || stored === GEMMA_MODEL_ID) {
    // Apple Intelligence is unavailable off iOS — fall back to Gemma there.
    if (stored === APPLE_INTELLIGENCE_MODEL_ID && !isAppleIntelligenceSupported()) {
      return GEMMA_MODEL_ID
    }
    return stored
  }
  return isAppleIntelligenceSupported() ? APPLE_INTELLIGENCE_MODEL_ID : GEMMA_MODEL_ID
}

export function setLocalBackend(backend: LocalBackend): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LOCAL_MODEL_TYPE, backend)
  } catch {
    /* ignore */
  }
  // Switching backend invalidates the readiness cache.
  cachedReady = null
  cachedReadiness = ''
}

/** Path to the downloaded Gemma model, or null when not yet downloaded. */
export function getGemmaModelPath(): string | null {
  const path = readLS(STORAGE_KEYS.LOCAL_MODEL_PATH)
  const trimmed = path?.trim()
  if (!trimmed) return null
  // Migration: builds before the LiteRT-LM switch downloaded a MediaPipe
  // `-web.task` asset on iOS that can never load natively. Discard any stored
  // path that is not a `.litertlm` bundle so the user is prompted to re-download
  // the correct model instead of hitting a load failure on every generation.
  if (!trimmed.toLowerCase().endsWith('.litertlm')) {
    removeLS(STORAGE_KEYS.LOCAL_MODEL_PATH)
    return null
  }
  return trimmed
}

function fileBasename(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return idx >= 0 ? norm.slice(idx + 1) : norm
}

async function nativeFileExists(path: string): Promise<boolean> {
  // Filesystem.stat accepts either a full file:// URI or a plain absolute path
  // in `path`; try both forms so we work regardless of how the plugin stored it.
  const candidates = path.startsWith('file://') ? [path] : [`file://${path}`, path]
  for (const candidate of candidates) {
    try {
      await Filesystem.stat({ path: candidate })
      return true
    } catch {
      /* try next form */
    }
  }
  return false
}

/**
 * Resolve the stored Gemma model to a path that actually exists in the *current*
 * app container, healing the persisted path when the file has moved.
 *
 * iOS does not guarantee a stable absolute path to the app's Documents
 * directory: the `…/Application/<UUID>/Documents/…` container UUID can be
 * reassigned across app updates, so an absolute path persisted at download time
 * can dangle after a TestFlight/App Store update even though the model file was
 * preserved. When the stored path no longer resolves, re-resolve the filename
 * against the current Documents directory and heal the stored value; if the
 * file is genuinely gone, clear the entry so the UI prompts a fresh download.
 *
 * Returns the usable absolute path, or null when the model is missing.
 */
export async function resolveGemmaModelPath(): Promise<string | null> {
  const stored = getGemmaModelPath()
  if (!stored) return null
  // No native filesystem on web — trust the stored string.
  if (!isLocalLLMSupported()) return stored
  if (await nativeFileExists(stored)) return stored
  // Heal a changed container path by re-resolving the filename against the
  // current Documents directory.
  try {
    const { uri } = await Filesystem.getUri({ directory: Directory.Documents, path: fileBasename(stored) })
    if (await nativeFileExists(uri)) {
      const plain = uri.replace(/^file:\/\//, '')
      writeLS(STORAGE_KEYS.LOCAL_MODEL_PATH, plain)
      return plain
    }
  } catch {
    /* fall through to clearing the stale entry */
  }
  removeLS(STORAGE_KEYS.LOCAL_MODEL_PATH)
  cachedReady = false
  cachedReadiness = 'not-downloaded'
  return null
}

/**
 * Cached readiness so the synchronous `AIProvider.isConfigured()` can answer
 * without an async round-trip. `null` = not yet probed (assume usable on a
 * supported platform); refreshed by {@link refreshLocalReadiness}.
 */
let cachedReady: boolean | null = null
let cachedReadiness = ''

export function getCachedLocalReadiness(): string {
  return cachedReadiness
}

/** Build the `setModel` options for the active backend. */
function modelOptionsFor(backend: LocalBackend, extra: Record<string, unknown> = {}) {
  if (backend === GEMMA_MODEL_ID) {
    const path = getGemmaModelPath()
    if (!path) throw new AIServiceError('LOCAL_MODEL_NOT_DOWNLOADED')
    // Gemma is loaded through LiteRT-LM on both iOS and Android (`@capgo/capacitor-llm`
    // >= 8.1.0). The legacy MediaPipe engine is unavailable in our SPM iOS build, so we
    // pin the model type explicitly rather than letting it be inferred from the path.
    // Enforce a context window large enough for the analysis prompt (the plugin
    // default of 2048 is too small); never shrink below GEMMA_CONTEXT_TOKENS.
    const { maxTokens: requested, ...rest } = extra
    const maxTokens = Math.max(
      typeof requested === 'number' ? requested : 0,
      GEMMA_CONTEXT_TOKENS,
    )
    return { path, modelType: 'litertlm' as const, maxTokens, ...rest }
  }
  return { path: 'Apple Intelligence', ...extra }
}

/** Best-effort sync answer used by the AI gate and provider selection. */
export function isLocalLLMConfigured(): boolean {
  const backend = getLocalBackend()
  if (backend === GEMMA_MODEL_ID) {
    if (!isLocalLLMSupported() || !getGemmaModelPath()) return false
    return cachedReady ?? true
  }
  if (!isAppleIntelligenceSupported()) return false
  return cachedReady ?? true
}

/** Query the plugin for live readiness and update the sync cache. */
export async function refreshLocalReadiness(): Promise<{ ready: boolean; readiness: string }> {
  if (!isLocalLLMSupported()) {
    cachedReady = false
    cachedReadiness = 'unsupported'
    return { ready: false, readiness: 'unsupported' }
  }
  const backend = getLocalBackend()
  if (backend === GEMMA_MODEL_ID && !(await resolveGemmaModelPath())) {
    cachedReady = false
    cachedReadiness = 'not-downloaded'
    return { ready: false, readiness: 'not-downloaded' }
  }
  try {
    await CapgoLLM.setModel(modelOptionsFor(backend))
    const { readiness } = await CapgoLLM.getReadiness()
    cachedReadiness = readiness
    cachedReady = readiness === READY
    return { ready: cachedReady, readiness }
  } catch (err) {
    cachedReady = false
    cachedReadiness = err instanceof Error ? err.message : String(err)
    // Surface the native failure reason (model-format mismatch, MediaPipe
    // unavailable, OOM, …) so beta reports capture why on-device AI reports
    // "unavailable" instead of only the generic user-facing message.
    console.error('[LocalLLM] readiness check failed', { backend, reason: cachedReadiness })
    return { ready: false, readiness: cachedReadiness }
  }
}

// Serialise generations — the native session handles one reply at a time.
let generationChain: Promise<unknown> = Promise.resolve()

interface GenerateOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

function isOutOfMemoryError(message: string): boolean {
  return /out of memory|oom|memory pressure|cannot allocate/i.test(message)
}

async function runGeneration(prompt: string, opts: GenerateOptions): Promise<string> {
  const backend = getLocalBackend()
  // Validate/heal the Gemma model path against the current container before
  // loading it, so a stale iOS Documents path (changed container UUID after an
  // app update) is repaired rather than failing with an opaque "engine" error.
  if (backend === GEMMA_MODEL_ID && !(await resolveGemmaModelPath())) {
    throw new AIServiceError('LOCAL_MODEL_NOT_DOWNLOADED')
  }
  try {
    await CapgoLLM.setModel(
      modelOptionsFor(backend, {
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens ?? 2048,
      }),
    )
  } catch (err) {
    if (err instanceof AIServiceError) throw err
    const message = err instanceof Error ? err.message : String(err)
    // Log the raw native error so beta reports can distinguish a model-format
    // mismatch from a genuinely unsupported device or memory pressure.
    console.error('[LocalLLM] setModel failed during generation', { backend, message })
    if (isOutOfMemoryError(message)) throw new AIServiceError('LOCAL_OUT_OF_MEMORY', err)
    throw new AIServiceError('LOCAL_UNAVAILABLE', err)
  }

  const { id: chatId } = await CapgoLLM.createChat()

  let text = ''
  let resolveDone: () => void
  let rejectDone: (err: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  const textSub = await CapgoLLM.addListener('textFromAi', (event) => {
    if (event.chatId !== chatId) return
    const incoming = event.text ?? ''
    if (!incoming) return
    // Apple Intelligence's streamResponse yields a growing *snapshot* of the
    // full text so far on each chunk (the capgo plugin forwards Snapshot.content
    // verbatim), whereas MediaPipe (Gemma) emits incremental deltas. Detect
    // which by prefix relationship instead of blindly appending, so cumulative
    // snapshots don't pile up into "repeating, slowly growing" output.
    if (incoming.length >= text.length && incoming.startsWith(text)) {
      // Cumulative snapshot (or first chunk): replace with the fuller text.
      text = incoming
    } else if (text.startsWith(incoming)) {
      // Stale/duplicate shorter snapshot — ignore.
    } else {
      // True incremental delta — append.
      text += incoming
    }
  })
  const finishSub = await CapgoLLM.addListener('aiFinished', (event) => {
    if (event.chatId === chatId) resolveDone()
  })
  // The plugin emits `generationError` for native failures that happen *after*
  // streaming has started (e.g. the LiteRT-LM engine aborting mid-decode). Without
  // this listener such failures would hang until GENERATION_TIMEOUT_MS. A hard
  // native crash (EXC_BAD_ACCESS) still terminates the process before this fires,
  // but soft engine errors are surfaced immediately with a localized message.
  const errorSub = await CapgoLLM.addListener('generationError', (event) => {
    if (event.chatId !== undefined && event.chatId !== chatId) return
    const message = event.error ?? ''
    console.error('[LocalLLM] generationError', { backend, message })
    rejectDone(
      new AIServiceError(
        isOutOfMemoryError(message) ? 'LOCAL_OUT_OF_MEMORY' : 'LOCAL_GENERATION_FAILED',
        event.error,
      ),
    )
  })

  const timeout = setTimeout(
    () => rejectDone(new AIServiceError('LOCAL_TIMEOUT')),
    opts.timeoutMs ?? GENERATION_TIMEOUT_MS,
  )

  try {
    await CapgoLLM.sendMessage({ chatId, message: prompt })
    await done
    return text
  } finally {
    clearTimeout(timeout)
    await textSub.remove().catch(() => {})
    await finishSub.remove().catch(() => {})
    await errorSub.remove().catch(() => {})
  }
}

/**
 * Generate text on-device. Calls are queued so a second request waits for the
 * first to finish rather than corrupting the shared session.
 */
export async function generateLocalText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  if (!isLocalLLMSupported()) throw new AIServiceError('LOCAL_UNAVAILABLE')

  const run = generationChain.then(
    () => runGeneration(prompt, opts),
    () => runGeneration(prompt, opts),
  )
  // Keep the chain alive regardless of this call's outcome.
  generationChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Reset cached state — test seam. */
export function __resetLocalLLMCacheForTests(): void {
  cachedReady = null
  cachedReadiness = ''
  generationChain = Promise.resolve()
}
