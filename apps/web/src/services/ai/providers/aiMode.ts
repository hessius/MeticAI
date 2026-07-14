/**
 * Four-mode AI routing (#373).
 *
 * Sits above the provider registry (#491) and decides, per AI feature, whether
 * a request runs on-device (`local`) or on a hosted provider. The user picks a
 * top-level {@link AIMode}:
 *
 * - `none`   — AI features disabled.
 * - `local`  — every text feature runs on-device (Apple Intelligence / Gemma).
 * - `hosted` — every feature runs on the selected hosted provider (Gemini,
 *              OpenAI-compatible, …). This is the historical behaviour.
 * - `both`   — each text feature is routed independently via the `AI_ROUTE_*`
 *              keys; image generation and image-based profile creation always
 *              fall back to hosted (on-device models are text-only).
 *
 * On-device modes are only honoured on platforms where the bridge is supported
 * (iOS for Apple Intelligence, iOS/Android for Gemma); elsewhere they degrade
 * to `hosted`/`none` so the rest of the app keeps working unchanged.
 */

import { STORAGE_KEYS } from '@/lib/constants'
import { isLocalLLMConfigured, isLocalLLMSupported } from './localLLM'
import {
  DEFAULT_PROVIDER,
  getProviderApiKey,
  type ProviderId,
} from './providerRegistry'

export type AIMode = 'none' | 'local' | 'hosted' | 'both'

/** Text AI features that can be routed independently when mode is `both`. */
export type AIMethod = 'analyzeShot' | 'generateProfile' | 'recommendations' | 'dialIn'

export type AIRoute = 'local' | 'hosted'

const AI_MODES: readonly AIMode[] = ['none', 'local', 'hosted', 'both']

const ROUTE_KEYS: Record<AIMethod, string> = {
  analyzeShot: STORAGE_KEYS.AI_ROUTE_ANALYZE_SHOT,
  generateProfile: STORAGE_KEYS.AI_ROUTE_GENERATE_PROFILE,
  recommendations: STORAGE_KEYS.AI_ROUTE_RECOMMENDATIONS,
  dialIn: STORAGE_KEYS.AI_ROUTE_DIAL_IN,
}

export const AI_METHODS: readonly AIMethod[] = [
  'analyzeShot',
  'generateProfile',
  'recommendations',
  'dialIn',
]

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

/**
 * The hosted provider id, ignoring any stored on-device selection. The legacy
 * `AI_PROVIDER` key could hold `local`; here it is coerced to the default so a
 * hosted fallback always resolves to a real hosted provider.
 */
export function getActiveHostedProviderId(): ProviderId {
  const stored = readLS(STORAGE_KEYS.AI_PROVIDER)
  if (stored && stored !== 'local') {
    return stored as ProviderId
  }
  return DEFAULT_PROVIDER
}

function hostedConfigured(): boolean {
  return Boolean(getProviderApiKey(getActiveHostedProviderId())?.trim())
}

/**
 * The selected AI mode. Falls back to a one-time migration from the legacy
 * `AI_PROVIDER`/key state when `AI_MODE` has never been written, and degrades
 * on-device selections to a hosted/none equivalent on unsupported platforms.
 */
export function getAIMode(): AIMode {
  const stored = readLS(STORAGE_KEYS.AI_MODE) as AIMode | null
  if (stored && AI_MODES.includes(stored)) {
    if ((stored === 'local' || stored === 'both') && !isLocalLLMSupported()) {
      return hostedConfigured() ? 'hosted' : 'none'
    }
    return stored
  }

  // Migration from the pre-#373 single-provider model.
  const legacyProvider = readLS(STORAGE_KEYS.AI_PROVIDER)
  if (legacyProvider === 'local' && isLocalLLMSupported()) return 'local'
  return 'hosted'
}

export function setAIMode(mode: AIMode): void {
  writeLS(STORAGE_KEYS.AI_MODE, mode)
}

/** Per-method route when mode is `both` (defaults to hosted). */
export function getRouteForMethod(method: AIMethod): AIRoute {
  return readLS(ROUTE_KEYS[method]) === 'local' ? 'local' : 'hosted'
}

export function setRouteForMethod(method: AIMethod, route: AIRoute): void {
  writeLS(ROUTE_KEYS[method], route)
}

/**
 * Resolve the provider id to use for a given AI feature, honouring the active
 * mode, per-method routing, and the "vision always hosted" rule.
 *
 * @param method  the feature being invoked; omit for generic uses (model
 *                discovery, capability probing) which always resolve hosted.
 * @param opts.hasImage  true when the request carries image input — forces
 *                hosted because on-device models are text-only.
 */
export function resolveProviderIdForMethod(
  method?: AIMethod,
  opts?: { hasImage?: boolean },
): ProviderId {
  const mode = getAIMode()
  const hosted = getActiveHostedProviderId()

  if (mode === 'none' || mode === 'hosted') return hosted
  if (opts?.hasImage) return hosted
  if (mode === 'local') return 'local'

  // mode === 'both'
  if (!method) return hosted
  return getRouteForMethod(method) === 'local' ? 'local' : hosted
}

/**
 * Whether any AI backend is usable under the current mode. Used by the AI gate
 * and the analyze/recommend call sites so on-device-only setups (no API key)
 * are still considered configured.
 */
export function isAIConfigured(): boolean {
  const mode = getAIMode()
  if (mode === 'none') return false
  if (mode === 'local') return isLocalLLMConfigured()
  if (mode === 'hosted') return hostedConfigured()
  // both — either backend being ready is enough.
  return isLocalLLMConfigured() || hostedConfigured()
}
