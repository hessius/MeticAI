/**
 * Generic OpenAI-compatible provider (#491).
 *
 * Talks to `${baseUrl}/chat/completions` and `${baseUrl}/models` over plain
 * fetch — no SDK. Covers OpenAI, DeepSeek, Kimi (Moonshot) and OpenRouter.
 * Translates the Gemini-style `contents` request shape used across the app into
 * OpenAI chat messages so callers stay provider-agnostic.
 */

import { AIServiceError } from '../aiErrors'
import type { AvailableModel } from '../modelResolver'
import type { AIProvider, ProviderCapabilities } from './AIProvider'
import {
  getProviderApiKey,
  getProviderModel,
  type ProviderDescriptor,
  type ProviderId,
} from './providerRegistry'

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}
interface GeminiContent {
  role?: string
  parts: GeminiPart[]
}

type OpenAIContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: OpenAIContent
}

/** Ids that are never text-chat models on OpenAI-compatible providers. */
const NON_CHAT_FRAGMENTS = [
  'embedding',
  'whisper',
  'tts',
  'audio',
  'dall-e',
  'dalle',
  'image',
  'moderation',
  'realtime',
  'transcribe',
  'rerank',
  'guard',
]

function isChatModel(id: string): boolean {
  const lower = id.toLowerCase()
  return !NON_CHAT_FRAGMENTS.some(f => lower.includes(f))
}

function normaliseContents(contents: unknown): GeminiContent[] {
  if (Array.isArray(contents)) return contents as GeminiContent[]
  if (contents && typeof contents === 'object') return [contents as GeminiContent]
  return [{ role: 'user', parts: [{ text: String(contents ?? '') }] }]
}

/** Convert Gemini `contents` into OpenAI chat `messages`. */
export function contentsToMessages(contents: unknown, supportsVision: boolean): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  for (const entry of normaliseContents(contents)) {
    const role: OpenAIMessage['role'] = entry.role === 'model' ? 'assistant' : 'user'
    const parts = entry.parts ?? []
    const hasImage = supportsVision && parts.some(p => p.inlineData)
    if (hasImage) {
      const content: Exclude<OpenAIContent, string> = []
      for (const p of parts) {
        if (p.text) content.push({ type: 'text', text: p.text })
        else if (p.inlineData) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` },
          })
        }
      }
      messages.push({ role, content })
    } else {
      const text = parts
        .map(p => p.text ?? '')
        .filter(Boolean)
        .join('\n')
      messages.push({ role, content: text })
    }
  }
  return messages
}

function mapHttpError(status: number, body: string): never {
  if (status === 401 || status === 403) throw new AIServiceError('API_KEY_INVALID')
  if (status === 429) throw new AIServiceError('QUOTA_EXCEEDED')
  if (status === 404) throw new AIServiceError('MODEL_NOT_FOUND')
  if (status >= 500) throw new AIServiceError('SERVICE_UNAVAILABLE')
  throw new AIServiceError('UNKNOWN', new Error(`HTTP ${status}: ${body.slice(0, 200)}`))
}

export class OpenAICompatProvider implements AIProvider {
  readonly id: ProviderId
  readonly label: string
  readonly capabilities: ProviderCapabilities
  private readonly baseUrl: string

  constructor(private readonly descriptor: ProviderDescriptor) {
    this.id = descriptor.id
    this.label = descriptor.label
    this.capabilities = descriptor.capabilities
    this.baseUrl = (descriptor.baseUrl ?? '').replace(/\/$/, '')
  }

  isConfigured(): boolean {
    return !!getProviderApiKey(this.id)
  }

  detectFromKey(key: string): boolean {
    const k = key.trim()
    return this.descriptor.keyPrefixes.some(p => k.startsWith(p))
  }

  private requireKey(): string {
    const key = getProviderApiKey(this.id)
    if (!key) throw new AIServiceError('API_KEY_MISSING')
    return key
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.requireKey()}`,
    }
  }

  private async postChat(model: string, contents: unknown): Promise<{ text: string }> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages: contentsToMessages(contents, this.capabilities.vision),
        }),
      })
    } catch (err) {
      throw new AIServiceError('NETWORK_ERROR', err)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      mapHttpError(res.status, body)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return { text: data.choices?.[0]?.message?.content ?? '' }
  }

  async generateText(req: { contents: unknown; config?: unknown }): Promise<{ text: string }> {
    const configured = getProviderModel(this.id)
    try {
      return await this.postChat(configured, req.contents)
    } catch (err) {
      // Single reactive retry on a dead model id: re-resolve from discovery.
      if (err instanceof AIServiceError && err.code === 'MODEL_NOT_FOUND') {
        const models = await this.listModels().catch(() => [])
        const fallback = models[0]?.id
        if (fallback && fallback !== configured) {
          return this.postChat(fallback, req.contents)
        }
      }
      throw err
    }
  }

  async listModels(): Promise<AvailableModel[]> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() })
    } catch {
      return this.descriptor.staticModels
    }
    if (!res.ok) return this.descriptor.staticModels
    const data = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null
    const ids = (data?.data ?? []).map(m => m.id).filter(id => typeof id === 'string')
    const chat = ids.filter(isChatModel)
    if (chat.length === 0) return this.descriptor.staticModels
    // Keep the provider's preferred default first when present.
    const preferred = this.descriptor.defaultModel
    chat.sort((a, b) => {
      if (a === preferred) return -1
      if (b === preferred) return 1
      return a.localeCompare(b)
    })
    return chat.map(id => ({ id, display_name: id, description: '' }))
  }
}
