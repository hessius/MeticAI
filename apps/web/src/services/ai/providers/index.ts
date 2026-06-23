import type { AIProvider } from './AIProvider'
import { geminiProvider } from './GeminiProvider'
import { OpenAICompatProvider } from './OpenAICompatProvider'
import { getActiveProviderId, getProviderDescriptor, type ProviderId } from './providerRegistry'

const openAiCompatCache = new Map<ProviderId, OpenAICompatProvider>()

/** Resolve the AIProvider implementation for a given provider id. */
export function getProvider(id: ProviderId): AIProvider {
  if (id === 'gemini') return geminiProvider
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
export { OpenAICompatProvider } from './OpenAICompatProvider'
export type { AIProvider, ProviderCapabilities } from './AIProvider'
export {
  PROVIDERS,
  PROVIDER_IDS,
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
