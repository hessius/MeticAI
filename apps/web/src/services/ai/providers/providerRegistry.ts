/**
 * AI provider registry (#491).
 *
 * A single generic OpenAI-compatible provider talks to `/v1/chat/completions`
 * + `/v1/models` over plain fetch, covering OpenAI, DeepSeek, Kimi (Moonshot)
 * and OpenRouter with zero added SDK dependencies. Gemini keeps its native
 * `@google/genai` SDK path. No free-text model entry — every provider feeds the
 * dynamic ranked model picker.
 */

import { STORAGE_KEYS } from '@/lib/constants'
import type { ProviderCapabilities } from './AIProvider'
import { isLocalLLMSupported } from './localLLM'

export type ProviderId = 'gemini' | 'openai' | 'deepseek' | 'kimi' | 'openrouter' | 'local'

export interface ProviderDescriptor {
  id: ProviderId
  label: string
  /** Base URL for OpenAI-compatible REST calls (omitted for the native Gemini SDK). */
  baseUrl?: string
  /** Key-shape prefixes used for auto-detection, most specific first. */
  keyPrefixes: string[]
  capabilities: ProviderCapabilities
  /** Default model id when discovery is unavailable. */
  defaultModel: string
  /** Offline / no-key fallback list for the picker. */
  staticModels: { id: string; display_name: string; description: string }[]
}

const TEXT_ONLY: ProviderCapabilities = {
  text: true,
  vision: false,
  imageGen: false,
  jsonMode: true,
}

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    keyPrefixes: ['AIza'],
    capabilities: { text: true, vision: true, imageGen: true, jsonMode: true },
    defaultModel: 'gemini-2.5-flash',
    staticModels: [
      { id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
      { id: 'gemini-2.5-flash-lite', display_name: 'Gemini 2.5 Flash Lite', description: 'Lightweight' },
      { id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro', description: 'Most capable' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyPrefixes: ['sk-proj-', 'sk-'],
    capabilities: { text: true, vision: true, imageGen: false, jsonMode: true },
    defaultModel: 'gpt-4o-mini',
    staticModels: [
      { id: 'gpt-4o-mini', display_name: 'GPT-4o mini', description: 'Fast and affordable' },
      { id: 'gpt-4o', display_name: 'GPT-4o', description: 'Most capable' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyPrefixes: ['sk-'],
    capabilities: TEXT_ONLY,
    defaultModel: 'deepseek-chat',
    staticModels: [
      { id: 'deepseek-chat', display_name: 'DeepSeek Chat', description: 'General purpose' },
      { id: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', description: 'Reasoning model' },
    ],
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/v1',
    keyPrefixes: ['sk-'],
    capabilities: TEXT_ONLY,
    defaultModel: 'kimi-k2-0905-preview',
    staticModels: [
      { id: 'kimi-k2-0905-preview', display_name: 'Kimi K2', description: 'General purpose' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPrefixes: ['sk-or-'],
    capabilities: { text: true, vision: true, imageGen: false, jsonMode: true },
    defaultModel: 'openai/gpt-4o-mini',
    staticModels: [
      { id: 'openai/gpt-4o-mini', display_name: 'GPT-4o mini', description: 'Affordable' },
      { id: 'anthropic/claude-3.5-sonnet', display_name: 'Claude 3.5 Sonnet', description: 'Anthropic' },
    ],
  },
  // On-device AI (#373). No API key, no network; availability is gated by
  // platform support (iOS 26+ / Apple Intelligence) rather than a stored key.
  local: {
    id: 'local',
    label: 'On-device (Apple Intelligence)',
    keyPrefixes: [],
    capabilities: { text: true, vision: false, imageGen: false, jsonMode: false },
    defaultModel: 'apple-intelligence',
    staticModels: [
      {
        id: 'apple-intelligence',
        display_name: 'Apple Intelligence',
        description: 'On-device, private, no API key',
      },
    ],
  },
}

/** All registered provider ids (includes on-device `local`). */
export const ALL_PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]
/** Hosted (BYO-key) providers only — used for key-based detection/iteration. */
export const HOSTED_PROVIDER_IDS = ALL_PROVIDER_IDS.filter(id => id !== 'local')
export const PROVIDER_IDS = HOSTED_PROVIDER_IDS
export const DEFAULT_PROVIDER: ProviderId = 'gemini'

/** Provider ids the user can actually pick on this platform. */
export function getSelectableProviderIds(): ProviderId[] {
  return ALL_PROVIDER_IDS.filter(id => id !== 'local' || isLocalLLMSupported())
}

function isProviderId(value: string | null): value is ProviderId {
  return !!value && (ALL_PROVIDER_IDS as string[]).includes(value)
}

/**
 * Detect a provider from the shape of an API key. Unambiguous prefixes
 * (`AIza…` → Gemini, `sk-or-…` → OpenRouter, `sk-proj-…` → OpenAI) win; a bare
 * `sk-…` is ambiguous and resolves to OpenAI as the most common default while
 * the manual dropdown remains the source of truth.
 */
export function detectProviderFromKey(key: string): ProviderId | null {
  const k = key.trim()
  if (!k) return null
  if (/^AIza/.test(k)) return 'gemini'
  if (k.startsWith('sk-or-')) return 'openrouter'
  if (k.startsWith('sk-proj-')) return 'openai'
  if (k.startsWith('sk-')) return 'openai'
  return null
}

export function getActiveProviderId(): ProviderId {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.AI_PROVIDER)
    if (isProviderId(stored)) {
      // A stored on-device selection is only honoured where supported.
      if (stored === 'local' && !isLocalLLMSupported()) return DEFAULT_PROVIDER
      return stored
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PROVIDER
}

export function setActiveProviderId(id: ProviderId): void {
  try {
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, id)
  } catch {
    /* ignore */
  }
}

/** localStorage key holding the API key for a provider. */
export function apiKeyStorageKey(id: ProviderId): string {
  return id === 'gemini' ? STORAGE_KEYS.GEMINI_API_KEY : `${STORAGE_KEYS.AI_KEY_PREFIX}${id}`
}

/** localStorage key holding the selected model for a provider. */
export function modelStorageKey(id: ProviderId): string {
  return id === 'gemini' ? STORAGE_KEYS.GEMINI_MODEL : `${STORAGE_KEYS.AI_MODEL_PREFIX}${id}`
}

export function getProviderApiKey(id: ProviderId = getActiveProviderId()): string | null {
  try {
    return localStorage.getItem(apiKeyStorageKey(id))
  } catch {
    return null
  }
}

export function setProviderApiKey(id: ProviderId, key: string): void {
  try {
    localStorage.setItem(apiKeyStorageKey(id), key)
  } catch {
    /* ignore */
  }
}

export function getProviderModel(id: ProviderId = getActiveProviderId()): string {
  try {
    const stored = localStorage.getItem(modelStorageKey(id))
    if (stored?.trim()) return stored.trim()
  } catch {
    /* ignore */
  }
  return PROVIDERS[id].defaultModel
}

export function setProviderModel(id: ProviderId, model: string): void {
  try {
    localStorage.setItem(modelStorageKey(id), model)
  } catch {
    /* ignore */
  }
}

export function getProviderDescriptor(id: ProviderId = getActiveProviderId()): ProviderDescriptor {
  return PROVIDERS[id]
}
