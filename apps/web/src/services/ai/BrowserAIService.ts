/**
 * BrowserAIService — AIService implementation that uses the
 * browser AI provider directly in the browser.
 *
 * Used in machine-hosted PWA and Capacitor app modes.
 * The user provides their own Gemini API key (stored in localStorage/IndexedDB).
 */

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
  buildShotAnalysisPrompt,
  buildImagePrompt,
  buildRecommendationPrompt,
  buildDialInPrompt,
} from './prompts'
import { buildFullProfilePrompt, validateAndRetryProfile } from './profilePromptFull'
import { retryWithBackoff } from './retryUtils'
import i18n from 'i18next'

import { STORAGE_KEYS } from '@/lib/constants'
import { lintShotAnalysis, repairShotAnalysis } from '@/lib/analysisLint'
import { safeRandomUUID } from '@/lib/uuid'
import { AIServiceError, type AIErrorCode as AIErrorCodeBase } from './aiErrors'
import { getProviderForMethod, isAIConfigured } from './providers'

/**
 * Typed AI service error codes — UI layer translates these via i18n.
 * This keeps the service layer free of user-facing strings.
 */
export type AIErrorCode = AIErrorCodeBase
export { AIServiceError }
export { generateTextWithRetry } from './providers/GeminiProvider'

export function createBrowserAIService(): AIService {
  return {
    name: 'BrowserAIService',

    isConfigured: () => isAIConfigured(),

    generateProfile: async (
      request: ProfileGenerationRequest,
      onProgress?: ProgressCallback,
    ): Promise<ProfileGenerationResult> => {
      const provider = getProviderForMethod('generateProfile', { hasImage: Boolean(request.image) })
      onProgress?.({ phase: 'analyzing', message: 'generation.progress.preparingPrompt' })

      // Build multipart content
      const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = []

      // Add image if provided
      if (request.image) {
        onProgress?.({ phase: 'analyzing', message: 'generation.progress.processingImage' })
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

      // Build the full system prompt (matching server parity)
      const authorName = (() => {
        try { return localStorage.getItem(STORAGE_KEYS.AUTHOR_NAME) || 'Metic' }
        catch { return 'Metic' }
      })()
      const systemPrompt = buildFullProfilePrompt(
        authorName,
        request.preferences,
        request.tags,
        !!request.image,
      )
      parts.push({ text: systemPrompt })

      onProgress?.({ phase: 'generating', message: 'generation.progress.generatingProfile' })

      const response = await provider.generateText({
        contents: [{ role: 'user', parts }],
      })
      let text = response.text

      onProgress?.({ phase: 'validating', message: 'generation.progress.validatingProfile' })

      // Validation + retry loop
      const generateFix = async (fixPrompt: string) => {
        const fixResponse = await provider.generateText({
          contents: [{ role: 'user', parts: [{ text: fixPrompt }] }],
        })
        return fixResponse.text
      }

      const { reply: validatedReply } = await validateAndRetryProfile(text, generateFix)
      text = validatedReply

      onProgress?.({ phase: 'complete', message: 'generation.progress.profileGenerated' })

      // Strip raw JSON blocks from analysis text shown to user (#419)
      const cleanAnalysis = text
        .replace(/```json\s*[\s\S]*?```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      return {
        status: 'success',
        analysis: cleanAnalysis || i18n.t('profileCreatedSuccessfully'),
        reply: text, // Keep full reply with fenced JSON for downstream extraction
      }
    },

    analyzeShot: async (request: ShotAnalysisRequest): Promise<ShotAnalysisResult> => {
      const provider = getProviderForMethod('analyzeShot')
      const prompt = buildShotAnalysisPrompt(
        request.profileName,
        request.shotDate,
        request.shotFilename,
        request.profileDescription,
      )

      const runAnalysis = () =>
        retryWithBackoff(() =>
          provider.generateText({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          })
        )

      // Validate the model output the same way profile generation is validated:
      // on-device models occasionally loop a sentence dozens of times while
      // dropping other sections. Regenerate once on malformed output, then fall
      // back to a best-effort repair so the user still gets usable analysis.
      const response = await runAnalysis()
      let text = response.text
      if (!lintShotAnalysis(text).valid) {
        const retry = await runAnalysis()
        text = lintShotAnalysis(retry.text).valid
          ? retry.text
          : repairShotAnalysis(retry.text.length >= text.length ? retry.text : text)
      }

      return {
        status: 'success',
        llm_analysis: text,
        cached: false,
      }
    },

    generateImage: async (request: ImageGenerationRequest): Promise<Blob> => {
      // Image generation is always hosted — on-device models are text-only.
      const provider = getProviderForMethod(undefined, { hasImage: true })
      if (!provider.capabilities.imageGen || !provider.generateImage) {
        throw new AIServiceError('IMAGE_GENERATION_FAILED')
      }
      const prompt = buildImagePrompt(request.profileName, request.style, request.tags)
      return provider.generateImage(prompt)
    },

    getRecommendations: async (request: RecommendationRequest): Promise<Recommendation[]> => {
      const provider = getProviderForMethod('recommendations')
      const prompt = buildRecommendationPrompt(request.profileName, request.shotFilename)

      const response = await provider.generateText({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      })

      const text = response.text
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
        id: safeRandomUUID(),
        coffee,
        steps: [],
      }
    },

    getDialInRecommendation: async (): Promise<DialInRecommendation[]> => {
      const provider = getProviderForMethod('dialIn')
      const prompt = buildDialInPrompt()

      const response = await provider.generateText({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      })

      const text = response.text
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
