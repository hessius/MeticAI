/**
 * Shared retry / error-classification utilities for Gemini AI calls.
 * Used by both BrowserAIService and DirectModeInterceptor.
 */
import i18n from 'i18next'
import { AIServiceError } from './aiErrors'

/** Check if an error is transient and retryable */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof AIServiceError) {
    return err.code === 'SERVICE_UNAVAILABLE' || err.code === 'QUOTA_EXCEEDED'
  }
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('overloaded') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('429')
  )
}

/** Retry a function with exponential backoff on transient errors */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 2000,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < maxRetries && isRetryableError(err)) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

/** Map a raw Gemini error to a user-friendly message */
export function formatGeminiError(err: unknown): string {
  if (err instanceof AIServiceError) {
    if (err.code === 'LOCAL_VISION_UNSUPPORTED') return i18n.t('error.localVisionUnsupported')
    if (err.code === 'LOCAL_UNAVAILABLE') return i18n.t('error.localUnavailable')
    if (err.code === 'LOCAL_TIMEOUT') return i18n.t('error.localTimeout')
    if (err.code === 'LOCAL_MODEL_NOT_DOWNLOADED') return i18n.t('error.localModelNotDownloaded')
    if (err.code === 'LOCAL_OUT_OF_MEMORY') return i18n.t('error.localOutOfMemory')
  }
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('overloaded'))
    return i18n.t('error.aiModelUnavailable')
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota'))
    return i18n.t('error.aiQuotaExceeded')
  if (raw.includes('404') || raw.includes('NOT_FOUND'))
    return i18n.t('error.aiNoCompatibleModel')
  return raw || i18n.t('error.analysisFailed')
}
