import type { AIProvider } from './AIProvider'
import { geminiProvider } from './GeminiProvider'

export function getActiveProvider(): AIProvider {
  return geminiProvider
}

export { geminiProvider, GeminiProvider } from './GeminiProvider'
export type { AIProvider, ProviderCapabilities } from './AIProvider'
