/**
 * On-device AI provider (#373) — Apple Intelligence.
 *
 * Implements the same {@link AIProvider} contract as the hosted providers so it
 * slots into the existing registry, `BrowserAIService` and the native
 * DirectMode interceptor with no call-site changes. It is text-only: image
 * generation and vision (image-based profile creation) are unsupported and
 * fall back to a hosted provider, matching the issue's "image generation always
 * hosted" rule.
 */

import type { AvailableModel } from '../modelResolver'
import { AIServiceError } from '../aiErrors'
import type { AIProvider, ProviderCapabilities } from './AIProvider'
import {
  APPLE_INTELLIGENCE_MODEL_ID,
  GEMMA_MODEL_ID,
  generateLocalText,
  getLocalBackend,
  isLocalLLMConfigured,
} from './localLLM'

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}
interface GeminiContent {
  role?: string
  parts?: GeminiPart[]
}

function normaliseContents(contents: unknown): GeminiContent[] {
  if (Array.isArray(contents)) return contents as GeminiContent[]
  if (contents && typeof contents === 'object') return [contents as GeminiContent]
  return [{ role: 'user', parts: [{ text: String(contents ?? '') }] }]
}

/**
 * Flatten Gemini-style `contents` into a single prompt string. Apple
 * Intelligence chats take no separate system instruction over the JS bridge, so
 * every text part (system + user) is concatenated. Image parts are unsupported.
 */
export function contentsToPrompt(contents: unknown): string {
  const segments: string[] = []
  for (const entry of normaliseContents(contents)) {
    const parts = entry.parts ?? []
    if (parts.some(p => p.inlineData)) {
      throw new AIServiceError('LOCAL_VISION_UNSUPPORTED')
    }
    const text = parts
      .map(p => p.text ?? '')
      .filter(Boolean)
      .join('\n')
    if (text) segments.push(text)
  }
  return segments.join('\n\n')
}

export class LocalLLMProvider implements AIProvider {
  readonly id = 'local'
  readonly label = 'On-device (Apple Intelligence)'
  readonly capabilities: ProviderCapabilities = {
    text: true,
    vision: false,
    imageGen: false,
    jsonMode: false,
  }

  isConfigured(): boolean {
    return isLocalLLMConfigured()
  }

  detectFromKey(): boolean {
    // On-device AI has no API key — never auto-detected from key input.
    return false
  }

  async generateText(req: { contents: unknown; config?: unknown }): Promise<{ text: string }> {
    if (!isLocalLLMConfigured()) throw new AIServiceError('LOCAL_UNAVAILABLE')
    const prompt = contentsToPrompt(req.contents)
    const text = await generateLocalText(prompt)
    return { text }
  }

  async listModels(): Promise<AvailableModel[]> {
    if (getLocalBackend() === GEMMA_MODEL_ID) {
      return [
        {
          id: GEMMA_MODEL_ID,
          display_name: 'Gemma 4 E2B',
          description: 'On-device, private — 2.6 GB download',
        },
      ]
    }
    return [
      {
        id: APPLE_INTELLIGENCE_MODEL_ID,
        display_name: 'Apple Intelligence',
        description: 'On-device, private, no API key',
      },
    ]
  }
}

export const localLLMProvider = new LocalLLMProvider()
