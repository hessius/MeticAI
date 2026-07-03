import { describe, it, expect } from 'vitest'
import { pointAtTime } from './pointAtTime'

describe('pointAtTime', () => {
  const data = [
    { time: 0, v: 'a' },
    { time: 5, v: 'b' },
    { time: 10, v: 'c' },
  ]

  it('returns undefined for empty data', () => {
    expect(pointAtTime([], 5)).toBeUndefined()
  })

  it('returns the first point at time 0 (scrub at start)', () => {
    expect(pointAtTime(data, 0)?.v).toBe('a')
  })

  it('returns the first point for negative/pre-start time', () => {
    expect(pointAtTime(data, -3)?.v).toBe('a')
  })

  it('returns the last point at or before the requested time', () => {
    expect(pointAtTime(data, 7)?.v).toBe('b')
    expect(pointAtTime(data, 5)?.v).toBe('b')
  })

  it('returns the final point at/after the end (scrub at end)', () => {
    expect(pointAtTime(data, 10)?.v).toBe('c')
    expect(pointAtTime(data, 999)?.v).toBe('c')
  })
})
