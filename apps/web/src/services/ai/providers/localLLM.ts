/**
 * On-device LLM bridge (#373).
 *
 * Thin wrapper over `@capgo/capacitor-llm` for Apple Intelligence (iOS 26+,
 * A17 Pro and later). Gemma / MediaPipe download support is intentionally
 * scaffolded but inert for this first iteration — only the Apple Intelligence
 * (zero-download, system model) path is wired up.
 *
 * The plugin is event-driven: `sendMessage` resolves immediately and the
 * generated text arrives as a stream of `textFromAi` events terminated by an
 * `aiFinished` event. This module adapts that into a single awaitable call and
 * serialises concurrent requests (the native session generates one reply at a
 * time).
 */

import { CapgoLLM } from '@capgo/capacitor-llm'
import { isNativePlatform } from '@/lib/machineMode'
import { AIServiceError } from '../aiErrors'

/** Local backends planned for #373. Only `apple-intelligence` ships in v1. */
export type LocalBackend = 'apple-intelligence' | 'gemma-4-e2b'

export const APPLE_INTELLIGENCE_MODEL_ID = 'apple-intelligence'

/** The plugin reports this exact readiness string when the model is usable. */
const READY = 'ready'

/** Hard ceiling for a single on-device generation before we give up (ms). */
const GENERATION_TIMEOUT_MS = 120_000

function getCapacitorPlatform(): string {
  const cap = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  try {
    return cap?.getPlatform?.() ?? 'web'
  } catch {
    return 'web'
  }
}

/**
 * Whether on-device AI can be offered at all on this platform. Apple
 * Intelligence is iOS-only; Android (Gemma) is deferred, so non-iOS natives and
 * the web build report unsupported.
 */
export function isLocalLLMSupported(): boolean {
  return isNativePlatform() && getCapacitorPlatform() === 'ios'
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

/** Best-effort sync answer used by the AI gate and provider selection. */
export function isLocalLLMConfigured(): boolean {
  if (!isLocalLLMSupported()) return false
  return cachedReady ?? true
}

/** Query the plugin for live readiness and update the sync cache. */
export async function refreshLocalReadiness(): Promise<{ ready: boolean; readiness: string }> {
  if (!isLocalLLMSupported()) {
    cachedReady = false
    cachedReadiness = 'unsupported'
    return { ready: false, readiness: 'unsupported' }
  }
  try {
    await CapgoLLM.setModel({ path: 'Apple Intelligence', engine: 'apple' })
    const { readiness } = await CapgoLLM.getReadiness()
    cachedReadiness = readiness
    cachedReady = readiness === READY
    return { ready: cachedReady, readiness }
  } catch (err) {
    cachedReady = false
    cachedReadiness = err instanceof Error ? err.message : String(err)
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

async function runGeneration(prompt: string, opts: GenerateOptions): Promise<string> {
  await CapgoLLM.setModel({
    path: 'Apple Intelligence',
    engine: 'apple',
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 2048,
  })

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
    // verbatim), whereas other engines (MediaPipe) emit incremental deltas.
    // Detect which by prefix relationship instead of blindly appending, so
    // cumulative snapshots don't pile up into "repeating, slowly growing" output.
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
