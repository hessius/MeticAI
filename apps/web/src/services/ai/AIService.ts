/**
 * AIService interface — abstraction layer for AI-powered features.
 *
 * Two implementations:
 * - **ProxyAIService** — delegates to MeticAI FastAPI backend (Docker mode)
 * - **BrowserAIService** — uses @google/genai SDK directly (PWA mode)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileGenerationRequest {
  image: File | null
  preferences: string
  tags: string[]
  advancedOptions?: Record<string, unknown>
}

export interface ProfileGenerationResult {
  status: 'success' | 'error'
  analysis: string
  reply: string
  history_id?: string
}

export interface ShotAnalysisRequest {
  profileName: string
  shotDate: string
  shotFilename: string
  profileDescription?: string
  forceRefresh?: boolean
}

export interface ShotAnalysisResult {
  status: 'success' | 'error'
  llm_analysis: string
  cached: boolean
}

export interface ImageGenerationRequest {
  profileName: string
  style: string
  tags: string[]
  preview?: boolean
}

export interface Recommendation {
  variable: string
  current_value: number
  recommended_value: number
  stage: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
  is_patchable: boolean
}

export interface RecommendationRequest {
  profileName: string
  shotFilename: string
}

export interface DialInSession {
  id: string
  coffee: Record<string, unknown>
  steps: Record<string, unknown>[]
}

export interface DialInRecommendation {
  parameter: string
  direction: string
  magnitude: string
  reason: string
}

export interface ProgressEvent {
  phase: string
  message: string
  attempt?: number
  max_attempts?: number
  elapsed?: number
  result?: unknown
  error?: string
}

export type ProgressCallback = (event: ProgressEvent) => void

// ---------------------------------------------------------------------------
// Main Interface
// ---------------------------------------------------------------------------

export interface AIService {
  readonly name: string

  /** Whether AI features are available (API key configured, etc.) */
  isConfigured(): boolean

  /** Generate a coffee profile from an image and preferences */
  generateProfile(
    request: ProfileGenerationRequest,
    onProgress?: ProgressCallback,
  ): Promise<ProfileGenerationResult>

  /** Analyze a shot with AI */
  analyzeShot(request: ShotAnalysisRequest): Promise<ShotAnalysisResult>

  /** Generate a profile cover image */
  generateImage(request: ImageGenerationRequest): Promise<Blob>

  /** Get AI-classified recommendations from shot analysis */
  getRecommendations(request: RecommendationRequest): Promise<Recommendation[]>

  /** Create a dial-in session */
  createDialInSession(coffee: Record<string, unknown>): Promise<DialInSession>

  /** Get dial-in recommendations for a session */
  getDialInRecommendation(sessionId: string): Promise<DialInRecommendation[]>
}
