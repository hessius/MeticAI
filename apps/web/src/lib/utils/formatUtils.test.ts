import { describe, it, expect } from 'vitest'
import { formatDuration, truncateText } from './formatUtils'

describe('formatDuration null guards', () => {
  it('returns 0s for null', () => {
    expect(formatDuration(null as unknown as number)).toBe('0s')
  })

  it('returns 0s for undefined', () => {
    expect(formatDuration(undefined as unknown as number)).toBe('0s')
  })

  it('returns 0s for NaN', () => {
    expect(formatDuration(NaN)).toBe('0s')
  })

  it('formats valid seconds normally', () => {
    expect(formatDuration(90)).toBe('1m 30s')
  })

  it('formats zero seconds', () => {
    expect(formatDuration(0)).toBe('0s')
  })
})

describe('truncateText null guards', () => {
  it('returns empty string for null', () => {
    expect(truncateText(null as unknown as string, 10)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(truncateText(undefined as unknown as string, 10)).toBe('')
  })

  it('truncates long text normally', () => {
    expect(truncateText('Hello World!', 8)).toBe('Hello...')
  })

  it('returns short text unchanged', () => {
    expect(truncateText('Hi', 10)).toBe('Hi')
  })
})
