/**
 * BrowserAIService — AIService implementation that uses the
 * @google/genai SDK directly in the browser.
 *
 * Used in machine-hosted PWA and Capacitor app modes.
 * The user provides their own Gemini API key (stored in localStorage/IndexedDB).
 */

import { GoogleGenAI } from '@google/genai'
import type {
  AIService,
  ProfileGenerationRequest,
  ProfileGenerationResult,
  ShotAnalysisRequest,
  ShotAnalysisResult,
  ImageGenerationRequest,
  Recommendation,
  RecommendationRequest,
  DialInSession,
  DialInRecommendation,
  ProgressCallback,
} from './AIService'
import {
  buildProfileSystemPrompt,
  buildShotAnalysisPrompt,
  buildImagePrompt,
  buildRecommendationPrompt,
  buildDialInPrompt,
} from './prompts'

const GEMINI_MODEL = 'gemini-2.5-flash'
const IMAGE_MODEL = 'imagen-3.0-generate-002'
const API_KEY_STORAGE = 'meticai-gemini-api-key'

function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE)
  } catch {
    return null
  }
}

function getClient(): GoogleGenAI {
  const key = getStoredApiKey()
  if (!key) throw new Error('Gemini API key not configured. Please set your API key in Settings.')
  return new GoogleGenAI({ apiKey: key })
}

/** Map common Gemini SDK errors to user-friendly messages */
function wrapApiError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota'))
    throw new Error('API quota exceeded. Please check your Gemini billing settings or try again later.')
  if (msg.includes('401') || msg.includes('403') || msg.includes('API_KEY_INVALID'))
    throw new Error('Invalid Gemini API key. Please check your key in Settings.')
  if (msg.includes('404') || msg.includes('NOT_FOUND'))
    throw new Error('AI model not available. Please update MeticAI to the latest version.')
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch'))
    throw new Error('Network error. Please check your internet connection.')
  throw err
}

export function createBrowserAIService(): AIService {
  return {
    name: 'BrowserAIService',

    isConfigured: () => !!getStoredApiKey(),

    generateProfile: async (
      request: ProfileGenerationRequest,
      onProgress?: ProgressCallback,
    ): Promise<ProfileGenerationResult> => {
      const client = getClient()
      onProgress?.({ phase: 'analyzing', message: 'Preparing prompt...' })

      // Build multipart content
      const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = []

      // Add image if provided
      if (request.image) {
        onProgress?.({ phase: 'analyzing', message: 'Processing image...' })
        const buffer = await request.image.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
        )
        parts.push({
          inlineData: {
            mimeType: request.image.type || 'image/jpeg',
            data: base64,
          },
        })
      }

      // Build the system prompt
      const systemPrompt = buildProfileSystemPrompt(request.preferences, request.tags, request.advancedOptions)
      parts.push({ text: systemPrompt })

      onProgress?.({ phase: 'generating', message: 'Generating profile...' })

      let response
      try {
        response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: 'user', parts }],
        })
      } catch (err) {
        wrapApiError(err)
      }

      const text = response.text ?? ''

      onProgress?.({ phase: 'validating', message: 'Validating profile...' })

      // Parse the JSON profile from the response
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/)
      const profileJson = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text

      onProgress?.({ phase: 'complete', message: 'Profile generated successfully' })

      return {
        status: 'success',
        analysis: text,
        reply: profileJson,
      }
    },

    analyzeShot: async (request: ShotAnalysisRequest): Promise<ShotAnalysisResult> => {
      const client = getClient()
      const prompt = buildShotAnalysisPrompt(
        request.profileName,
        request.shotDate,
        request.shotFilename,
        request.profileDescription,
      )

      let response
      try {
        response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        })
      } catch (err) {
        wrapApiError(err)
      }

      return {
        status: 'success',
        llm_analysis: response.text ?? '',
        cached: false,
      }
    },

    generateImage: async (request: ImageGenerationRequest): Promise<Blob> => {
      const client = getClient()
      const prompt = buildImagePrompt(request.profileName, request.style, request.tags)

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
        wrapApiError(err)
      }

      const images = response.generatedImages
      if (!images || images.length === 0) {
        throw new Error('No image generated')
      }

      const imageData = images[0].image
      if (!imageData?.imageBytes) {
        throw new Error('No image data in response')
      }

      // Convert base64 to Blob
      const binary = atob(imageData.imageBytes)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return new Blob([bytes], { type: 'image/png' })
    },

    getRecommendations: async (request: RecommendationRequest): Promise<Recommendation[]> => {
      const client = getClient()
      const prompt = buildRecommendationPrompt(request.profileName, request.shotFilename)

      let response
      try {
        response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        })
      } catch (err) {
        wrapApiError(err)
      }

      const text = response.text ?? ''
      try {
        const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\[[\s\S]*\]/)
        const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text)
        return (Array.isArray(parsed) ? parsed : parsed.recommendations ?? []).map(
          (r: Record<string, unknown>) => ({
            variable: String(r.variable ?? ''),
            current_value: Number(r.current_value ?? 0),
            recommended_value: Number(r.recommended_value ?? 0),
            stage: String(r.stage ?? ''),
            confidence: (['high', 'medium', 'low'].includes(String(r.confidence))
              ? String(r.confidence)
              : 'low') as 'high' | 'medium' | 'low',
            reason: String(r.reason ?? ''),
            is_patchable: r.is_patchable !== false,
          }),
        )
      } catch {
        return []
      }
    },

    createDialInSession: async (coffee: Record<string, unknown>): Promise<DialInSession> => {
      // In browser mode, sessions are client-side only
      return {
        id: crypto.randomUUID(),
        coffee,
        steps: [],
      }
    },

    getDialInRecommendation: async (): Promise<DialInRecommendation[]> => {
      const client = getClient()
      const prompt = buildDialInPrompt()

      let response
      try {
        response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        })
      } catch (err) {
        wrapApiError(err)
      }

      const text = response.text ?? ''
      try {
        const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\[[\s\S]*\]/)
        const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text)
        return Array.isArray(parsed) ? parsed : parsed.recommendations ?? []
      } catch {
        return []
      }
    },
  }
}
