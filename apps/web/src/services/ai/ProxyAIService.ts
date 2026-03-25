/**
 * ProxyAIService — AIService implementation that delegates to the
 * MeticAI FastAPI backend. Used in Docker deployment mode.
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
import { getServerUrl } from '@/lib/config'

export function createProxyAIService(): AIService {
  return {
    name: 'ProxyAIService',

    isConfigured: () => true, // Backend manages its own key

    generateProfile: async (
      request: ProfileGenerationRequest,
      onProgress?: ProgressCallback,
    ): Promise<ProfileGenerationResult> => {
      const serverUrl = await getServerUrl()

      // Start SSE listener for progress if callback provided
      let es: EventSource | null = null
      if (onProgress) {
        es = new EventSource(`${serverUrl}/api/generate/progress`)
        es.addEventListener('progress', (ev) => {
          try {
            onProgress(JSON.parse(ev.data))
          } catch { /* ignore parse errors */ }
        })
        es.addEventListener('error', () => {
          es?.close()
          es = null
        })
      }

      try {
        const formData = new FormData()
        if (request.image) formData.append('image', request.image)
        if (request.preferences) formData.append('preferences', request.preferences)
        if (request.tags.length) formData.append('tags', JSON.stringify(request.tags))
        if (request.advancedOptions) {
          formData.append('advanced_options', JSON.stringify(request.advancedOptions))
        }

        const response = await fetch(`${serverUrl}/api/analyze_and_profile`, {
          method: 'POST',
          body: formData,
        })

        if (response.status === 409) {
          throw new Error('BUSY')
        }

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        return await response.json()
      } finally {
        es?.close()
      }
    },

    analyzeShot: async (request: ShotAnalysisRequest): Promise<ShotAnalysisResult> => {
      const serverUrl = await getServerUrl()
      const formData = new FormData()
      formData.append('profile_name', request.profileName)
      formData.append('shot_date', request.shotDate)
      formData.append('shot_filename', request.shotFilename)
      if (request.profileDescription) formData.append('profile_description', request.profileDescription)
      if (request.forceRefresh) formData.append('force_refresh', 'true')

      const response = await fetch(`${serverUrl}/api/shots/analyze-llm`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Analysis failed' }))
        throw new Error(
          errorData.detail?.message || errorData.detail?.error || errorData.message || 'Analysis failed',
        )
      }

      return await response.json()
    },

    generateImage: async (request: ImageGenerationRequest): Promise<Blob> => {
      const serverUrl = await getServerUrl()
      const params = new URLSearchParams({
        style: request.style,
        tags: request.tags.join(','),
      })
      if (request.preview) params.set('preview', 'true')

      const response = await fetch(
        `${serverUrl}/api/profile/${encodeURIComponent(request.profileName)}/generate-image?${params}`,
        { method: 'POST' },
      )

      if (response.status === 402) {
        throw new Error('PAID_KEY_REQUIRED')
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Image generation failed' }))
        throw new Error(
          typeof error.detail === 'string' ? error.detail : error.detail?.message || 'Image generation failed',
        )
      }

      return await response.blob()
    },

    getRecommendations: async (request: RecommendationRequest): Promise<Recommendation[]> => {
      const serverUrl = await getServerUrl()
      const form = new FormData()
      form.append('profile_name', request.profileName)
      form.append('shot_filename', request.shotFilename)

      const res = await fetch(`${serverUrl}/api/shots/analyze-recommendations`, {
        method: 'POST',
        body: form,
      })

      if (!res.ok) throw new Error('Backend classification failed')
      const data = await res.json()
      return (data.recommendations ?? []).map((r: Record<string, unknown>) => ({
        variable: String(r.variable ?? ''),
        current_value: Number(r.current_value ?? 0),
        recommended_value: Number(r.recommended_value ?? 0),
        stage: String(r.stage ?? ''),
        confidence: (['high', 'medium', 'low'].includes(String(r.confidence))
          ? String(r.confidence)
          : 'low') as 'high' | 'medium' | 'low',
        reason: String(r.reason ?? ''),
        is_patchable: Boolean(r.is_patchable),
      }))
    },

    createDialInSession: async (coffee: Record<string, unknown>): Promise<DialInSession> => {
      const serverUrl = await getServerUrl()
      const res = await fetch(`${serverUrl}/api/dialin/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coffee),
      })
      if (!res.ok) throw new Error('Failed to create dial-in session')
      return await res.json()
    },

    getDialInRecommendation: async (sessionId: string): Promise<DialInRecommendation[]> => {
      const serverUrl = await getServerUrl()
      const res = await fetch(`${serverUrl}/api/dialin/sessions/${sessionId}/recommend`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to get dial-in recommendation')
      const data = await res.json()
      return data.recommendations ?? []
    },
  }
}
