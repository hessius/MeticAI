import { describe, it, expect } from 'vitest'
import { sanitizeFileName } from './profileUtils'

describe('sanitizeFileName null guards', () => {
  it('returns unnamed for null', () => {
    expect(sanitizeFileName(null as unknown as string)).toBe('unnamed')
  })

  it('returns unnamed for undefined', () => {
    expect(sanitizeFileName(undefined as unknown as string)).toBe('unnamed')
  })

  it('returns unnamed for empty string', () => {
    expect(sanitizeFileName('')).toBe('unnamed')
  })

  it('sanitizes valid name normally', () => {
    expect(sanitizeFileName('My Profile!')).toBe('my_profile')
  })

  it('handles special characters', () => {
    expect(sanitizeFileName('Test@#$Name')).toBe('test_name')
  })
})
