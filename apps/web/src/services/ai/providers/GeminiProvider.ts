import { GoogleGenAI } from '@google/genai'
import { STORAGE_KEYS } from '@/lib/constants'
import { AIServiceError } from '../aiErrors'
import {
  listAvailableModels,
  resolveWorkingModel,
  STATIC_FALLBACK_MODELS,
  type ModelClient,
} from '../modelResolver'
import type { AIProvider, ProviderCapabilities } from './AIProvider'

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const IMAGE_MODEL = 'imagen-4.0-generate-001'
const IMAGE_MODEL_FALLBACK = 'imagen-3.0-generate-002'

function getGeminiModel(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.GEMINI_MODEL)
    return stored?.trim() || DEFAULT_GEMINI_MODEL
  } catch {
    return DEFAULT_GEMINI_MODEL
  }
}

function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)
  } catch {
    return null
  }
}

function getClient(): GoogleGenAI {
  const key = getStoredApiKey()
  if (!key) throw new AIServiceError('API_KEY_MISSING')
  return new GoogleGenAI({ apiKey: key })
}

/** Map common Gemini SDK errors to typed error codes */
function wrapApiError(err: unknown): never {
  if (err instanceof AIServiceError) throw err
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded'))
    throw new AIServiceError('SERVICE_UNAVAILABLE', err)
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota'))
    throw new AIServiceError('QUOTA_EXCEEDED', err)
  if (msg.includes('401') || msg.includes('403') || msg.includes('API_KEY_INVALID'))
    throw new AIServiceError('API_KEY_INVALID', err)
  if (msg.includes('404') || msg.includes('NOT_FOUND'))
    throw new AIServiceError('MODEL_NOT_FOUND', err)
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch'))
    throw new AIServiceError('NETWORK_ERROR', err)
  throw new AIServiceError('UNKNOWN', err)
}

/** Client shape used for text generation: model resolution plus generateContent. */
export type TextGenClient = ModelClient & {
  models: {
    generateContent: (args: { model: string; contents: unknown; config?: unknown }) => Promise<unknown>
  }
}

/**
 * Run a text generateContent call through dynamic model resolution with a
 * single reactive retry: if the call fails with a model-not-found error, the
 * working model is re-resolved (bypassing cache) and the call is retried once.
 */
export async function generateTextWithRetry(
  client: TextGenClient,
  configured: string,
  req: { contents: unknown; config?: unknown },
): Promise<unknown> {
  const model = await resolveWorkingModel(client, configured)
  try {
    return await client.models.generateContent({ model, ...req })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!(msg.includes('404') || msg.includes('NOT_FOUND'))) throw err
    const retryModel = await resolveWorkingModel(client, configured, true)
    return client.models.generateContent({ model: retryModel, ...req })
  }
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini'
  readonly label = 'Google Gemini'
  readonly capabilities: ProviderCapabilities = {
    text: true,
    vision: true,
    imageGen: true,
    jsonMode: true,
  }

  isConfigured(): boolean {
    return !!getStoredApiKey()
  }

  detectFromKey(key: string): boolean {
    return /^AIza/.test(key.trim())
  }

  async generateText(req: { contents: unknown; config?: unknown }): Promise<{ text: string }> {
    try {
      const response = await generateTextWithRetry(
        getClient() as unknown as TextGenClient,
        getGeminiModel(),
        req,
      ) as { text?: string }
      return { text: response.text ?? '' }
    } catch (err) {
      wrapApiError(err)
    }
  }

  async generateImage(prompt: string): Promise<Blob> {
    const client = getClient()
    let response
    try {
      response = await client.models.generateImages({
        model: IMAGE_MODEL,
        prompt,
        config: {
          numberOfImages: 1,
        },
      })
    } catch (err) {
      try {
        response = await client.models.generateImages({
          model: IMAGE_MODEL_FALLBACK,
          prompt,
          config: {
            numberOfImages: 1,
          },
        })
      } catch {
        wrapApiError(err)
      }
    }

    const images = response.generatedImages
    if (!images || images.length === 0) {
      throw new AIServiceError('IMAGE_GENERATION_FAILED')
    }

    const imageData = images[0].image
    if (!imageData?.imageBytes) {
      throw new AIServiceError('IMAGE_NO_DATA')
    }

    const binary = atob(imageData.imageBytes)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: 'image/png' })
  }

  async listModels(): Promise<import('../modelResolver').AvailableModel[]> {
    try {
      return await listAvailableModels(getClient() as unknown as ModelClient)
    } catch {
      return STATIC_FALLBACK_MODELS
    }
  }
}

export const geminiProvider = new GeminiProvider()
