import type { AIProvider } from './AIProvider'
import { geminiProvider } from './GeminiProvider'
import { localLLMProvider } from './LocalLLMProvider'
import { OpenAICompatProvider } from './OpenAICompatProvider'
import { getActiveProviderId, getProviderDescriptor, type ProviderId } from './providerRegistry'

const openAiCompatCache = new Map<ProviderId, OpenAICompatProvider>()

/** Resolve the AIProvider implementation for a given provider id. */
export function getProvider(id: ProviderId): AIProvider {
  if (id === 'gemini') return geminiProvider
  if (id === 'local') return localLLMProvider
  let provider = openAiCompatCache.get(id)
  if (!provider) {
    provider = new OpenAICompatProvider(getProviderDescriptor(id))
    openAiCompatCache.set(id, provider)
  }
  return provider
}

/** The provider currently selected by the user (defaults to Gemini). */
export function getActiveProvider(): AIProvider {
  return getProvider(getActiveProviderId())
}

export { geminiProvider, GeminiProvider } from './GeminiProvider'
export { localLLMProvider, LocalLLMProvider } from './LocalLLMProvider'
export { OpenAICompatProvider } from './OpenAICompatProvider'
export type { AIProvider, ProviderCapabilities } from './AIProvider'
export {
  isLocalLLMSupported,
  isLocalLLMConfigured,
  refreshLocalReadiness,
  getCachedLocalReadiness,
  generateLocalText,
  APPLE_INTELLIGENCE_MODEL_ID,
} from './localLLM'
export {
  PROVIDERS,
  PROVIDER_IDS,
  ALL_PROVIDER_IDS,
  HOSTED_PROVIDER_IDS,
  getSelectableProviderIds,
  DEFAULT_PROVIDER,
  detectProviderFromKey,
  getActiveProviderId,
  setActiveProviderId,
  getProviderApiKey,
  setProviderApiKey,
  getProviderModel,
  setProviderModel,
  getProviderDescriptor,
  apiKeyStorageKey,
  modelStorageKey,
  type ProviderId,
  type ProviderDescriptor,
} from './providerRegistry'
