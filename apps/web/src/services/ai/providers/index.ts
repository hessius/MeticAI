import type { AIProvider } from './AIProvider'
import { geminiProvider } from './GeminiProvider'
import { localLLMProvider } from './LocalLLMProvider'
import { OpenAICompatProvider } from './OpenAICompatProvider'
import { getActiveProviderId, getProviderDescriptor, type ProviderId } from './providerRegistry'
import { resolveProviderIdForMethod, type AIMethod } from './aiMode'

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

/**
 * Resolve the AIProvider for a specific AI feature, honouring the four-mode
 * routing (#373). Image-bearing requests force a hosted provider since
 * on-device models are text-only.
 */
export function getProviderForMethod(
  method?: AIMethod,
  opts?: { hasImage?: boolean },
): AIProvider {
  return getProvider(resolveProviderIdForMethod(method, opts))
}

export { geminiProvider, GeminiProvider } from './GeminiProvider'
export { localLLMProvider, LocalLLMProvider } from './LocalLLMProvider'
export { OpenAICompatProvider } from './OpenAICompatProvider'
export type { AIProvider, ProviderCapabilities } from './AIProvider'
export {
  isLocalLLMSupported,
  isAppleIntelligenceSupported,
  isLocalLLMConfigured,
  refreshLocalReadiness,
  resolveGemmaModelPath,
  getCachedLocalReadiness,
  generateLocalText,
  APPLE_INTELLIGENCE_MODEL_ID,
  GEMMA_MODEL_ID,
  setLocalBackend,
  getLocalBackend,
  type LocalBackend,
} from './localLLM'
export {
  getAIMode,
  setAIMode,
  getRouteForMethod,
  setRouteForMethod,
  resolveProviderIdForMethod,
  getActiveHostedProviderId,
  isAIConfigured,
  AI_METHODS,
  type AIMode,
  type AIMethod,
  type AIRoute,
} from './aiMode'
export {
  getModelStatus,
  getAvailableBackends,
  checkDeviceCapability,
  downloadModel,
  cancelDownload,
  deleteModel,
  GEMMA_DOWNLOAD_BYTES,
  MIN_FREE_STORAGE_BYTES,
  MIN_RAM_BYTES,
  type ModelStatus,
  type DownloadProgress,
  type DeviceCapability,
} from './LocalModelManager'
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
