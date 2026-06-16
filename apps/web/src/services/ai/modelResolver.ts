/**
 * Dynamic Gemini model discovery & ranking for the native/browser runtime.
 * Mirrors the server-side heuristic in services/gemini_service.py (#485).
 */

export interface DiscoveredModel {
  name: string
  supportedActions?: string[]
  // Optional display metadata from the SDK, surfaced by listAvailableModels (Task 7B).
  displayName?: string
  description?: string
}

const NON_TEXT_FRAGMENTS = ['embedding', 'aqa', 'imagen', 'image', 'tts']
const UNSTABLE_RE = /(preview|experimental|-exp\b|exp$|-\d{2}-\d{2}|-\d{3,4}$)/

function shortName(name: string): string {
  return (name.split('/').pop() ?? '').trim().toLowerCase()
}

/**
 * Pick the best generateContent-capable model from a discovered list.
 * Returns the model id (without the 'models/' prefix) or null.
 */
export function rankModels(models: DiscoveredModel[]): string | null {
  const candidates = models
    .filter(m => (m.supportedActions ?? ['generateContent']).includes('generateContent'))
    .map(m => shortName(m.name))
    .filter(s => s && !NON_TEXT_FRAGMENTS.some(f => s.includes(f)))

  if (candidates.length === 0) return null

  const score = (s: string): [number, number, number, number, string] => {
    const unstable = UNSTABLE_RE.test(s) ? 1 : 0
    const cls = s.includes('flash-lite') ? 1 : s.includes('flash') ? 0 : s.includes('pro') ? 2 : 3
    const vm = s.match(/gemini-(\d+)\.(\d+)/)
    const major = vm ? parseInt(vm[1], 10) : 0
    const minor = vm ? parseInt(vm[2], 10) : 0
    return [unstable, cls, -major, -minor, s]
  }

  return candidates.slice().sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    for (let i = 0; i < 4; i++) {
      if ((sa[i] as number) !== (sb[i] as number)) return (sa[i] as number) - (sb[i] as number)
    }
    return (sa[4] as string).localeCompare(sb[4] as string)
  })[0]
}

import { AIServiceError } from './BrowserAIService'

/** Minimal shape of the @google/genai client we depend on. */
export interface ModelClient {
  models: {
    get: (args: { model: string }) => Promise<unknown>
    list: () => Promise<Iterable<DiscoveredModel> | AsyncIterable<DiscoveredModel>>
  }
}

let _cachedModel: string | null = null

/** Test-only: clear the in-memory resolved-model cache. */
export function __resetModelCache(): void {
  _cachedModel = null
}

async function validateModel(client: ModelClient, model: string): Promise<boolean> {
  try {
    await client.models.get({ model })
    return true
  } catch {
    return false
  }
}

async function listModels(client: ModelClient): Promise<DiscoveredModel[]> {
  const out: DiscoveredModel[] = []
  const res = await client.models.list()
  // The SDK may return a sync iterable or an async pager.
  for await (const m of res as AsyncIterable<DiscoveredModel>) out.push(m)
  return out
}

/**
 * Resolve a working, served model id. Tries the configured model first, then
 * dynamic discovery. Caches the result in memory (session-scoped). Throws
 * AIServiceError('MODEL_NOT_FOUND') when nothing compatible is available.
 */
export async function resolveWorkingModel(
  client: ModelClient,
  configured: string,
  forceRefresh = false,
): Promise<string> {
  if (_cachedModel && !forceRefresh) return _cachedModel

  // On a forced refresh, skip the (likely dead) configured model and go
  // straight to discovery. Otherwise honor the configured model when served.
  if (!forceRefresh && await validateModel(client, configured)) {
    _cachedModel = configured
    return configured
  }

  const best = rankModels(await listModels(client))
  if (best) {
    _cachedModel = best
    return best
  }
  throw new AIServiceError('MODEL_NOT_FOUND')
}

export interface AvailableModel {
  id: string
  display_name: string
  description: string
}

/** Offline / no-API-key fallback. Single source of truth for the static list. */
export const STATIC_FALLBACK_MODELS: AvailableModel[] = [
  { id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
  { id: 'gemini-2.5-flash-lite', display_name: 'Gemini 2.5 Flash Lite', description: 'Lightweight' },
  { id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro', description: 'Most capable' },
]

/**
 * List served, generateContent-capable models for the model-picker UI, ordered
 * best-first by the same heuristic as rankModels(). Maps to the
 * { id, display_name, description } shape the Settings dropdown expects.
 * Throws if the underlying models.list() call fails (caller handles fallback).
 */
export async function listAvailableModels(client: ModelClient): Promise<AvailableModel[]> {
  const discovered = await listModels(client)
  const byShort = new Map<string, DiscoveredModel>()
  let pool = discovered.filter(
    m => (m.supportedActions ?? ['generateContent']).includes('generateContent'),
  )
  for (const m of pool) byShort.set(shortName(m.name), m)

  const ordered: string[] = []
  // Repeatedly pull the best remaining model so the list is preference-ordered.
  while (pool.length) {
    const best = rankModels(pool)
    if (!best) break
    ordered.push(best)
    pool = pool.filter(m => shortName(m.name) !== best)
  }
  return ordered.map(id => {
    const src = byShort.get(id)
    return {
      id,
      display_name: src?.displayName?.trim() || id,
      description: src?.description?.trim() || '',
    }
  })
}
