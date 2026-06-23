export type AIErrorCode =
  | 'API_KEY_MISSING'
  | 'QUOTA_EXCEEDED'
  | 'API_KEY_INVALID'
  | 'MODEL_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'IMAGE_GENERATION_FAILED'
  | 'IMAGE_NO_DATA'
  | 'LOCAL_UNAVAILABLE'
  | 'LOCAL_VISION_UNSUPPORTED'
  | 'LOCAL_TIMEOUT'
  | 'UNKNOWN'

export class AIServiceError extends Error {
  constructor(public readonly code: AIErrorCode, cause?: unknown) {
    super(code)
    this.name = 'AIServiceError'
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause })
  }
}
