import { describe, expect, it, vi } from 'vitest'
import { isRetryableError, retryWithBackoff, formatGeminiError } from './retryUtils'

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => {
      const translations: Record<string, string> = {
        'error.aiModelUnavailable': 'The AI model is temporarily unavailable — this is a Google-side outage. Try switching to a different model in Settings, which may also increase token usage.',
        'error.aiQuotaExceeded': 'API quota exceeded. Please wait a moment and try again.',
        'error.analysisFailed': 'Analysis failed',
      }
      return translations[key] ?? key
    },
  },
}))

describe('isRetryableError', () => {
  it('returns true for 503 errors', () => {
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true)
  })

  it('returns true for UNAVAILABLE errors', () => {
    expect(isRetryableError(new Error('UNAVAILABLE: model overloaded'))).toBe(true)
  })

  it('returns true for overloaded errors', () => {
    expect(isRetryableError(new Error('The model is currently overloaded'))).toBe(true)
  })

  it('returns true for RESOURCE_EXHAUSTED errors', () => {
    expect(isRetryableError(new Error('RESOURCE_EXHAUSTED'))).toBe(true)
  })

  it('returns true for 429 rate limit errors', () => {
    expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true)
  })

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false)
    expect(isRetryableError(new Error('Invalid API key'))).toBe(false)
    expect(isRetryableError(new Error('404 Not Found'))).toBe(false)
  })

  it('handles non-Error values', () => {
    expect(isRetryableError('503 error')).toBe(true)
    expect(isRetryableError('auth failed')).toBe(false)
  })
})

describe('retryWithBackoff', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await retryWithBackoff(fn, 2, 1)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on transient 503 errors and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValue('ok')

    const result = await retryWithBackoff(fn, 2, 1)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries up to maxRetries then throws', async () => {
    const err = new Error('503 Service Unavailable')
    const fn = vi.fn().mockRejectedValue(err)

    await expect(retryWithBackoff(fn, 2, 1)).rejects.toThrow('503 Service Unavailable')
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('does not retry on non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'))

    await expect(retryWithBackoff(fn, 2, 1)).rejects.toThrow('401 Unauthorized')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries 429 rate-limit errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValue('ok')

    const result = await retryWithBackoff(fn, 2, 1)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('formatGeminiError', () => {
  it('formats 503 as unavailable message', () => {
    expect(formatGeminiError(new Error('503 Service Unavailable'))).toBe(
      'The AI model is temporarily unavailable — this is a Google-side outage. Try switching to a different model in Settings, which may also increase token usage.',
    )
  })

  it('formats UNAVAILABLE as unavailable message', () => {
    expect(formatGeminiError(new Error('UNAVAILABLE: try again'))).toBe(
      'The AI model is temporarily unavailable — this is a Google-side outage. Try switching to a different model in Settings, which may also increase token usage.',
    )
  })

  it('formats overloaded as unavailable message', () => {
    expect(formatGeminiError(new Error('model overloaded'))).toBe(
      'The AI model is temporarily unavailable — this is a Google-side outage. Try switching to a different model in Settings, which may also increase token usage.',
    )
  })

  it('formats 429 as quota message', () => {
    expect(formatGeminiError(new Error('429 Too Many Requests'))).toBe(
      'API quota exceeded. Please wait a moment and try again.',
    )
  })

  it('formats RESOURCE_EXHAUSTED as quota message', () => {
    expect(formatGeminiError(new Error('RESOURCE_EXHAUSTED'))).toBe(
      'API quota exceeded. Please wait a moment and try again.',
    )
  })

  it('passes through unknown errors verbatim', () => {
    expect(formatGeminiError(new Error('Something unexpected'))).toBe('Something unexpected')
  })

  it('returns fallback for empty error', () => {
    expect(formatGeminiError(new Error(''))).toBe('Analysis failed')
  })
})
