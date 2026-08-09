import { describe, expect, it } from 'vitest'
import { getScaleReadout } from './ControlCenter'

describe('getScaleReadout', () => {
  it('formats the current weight to one decimal place', () => {
    const r = getScaleReadout(12.34, null)
    expect(r.value).toBe('12.3')
  })

  it('shows 0.0 at rest', () => {
    expect(getScaleReadout(0, null).value).toBe('0.0')
  })

  it('treats null/undefined weight as 0.0', () => {
    expect(getScaleReadout(null, null).value).toBe('0.0')
    expect(getScaleReadout(undefined, null).value).toBe('0.0')
  })

  it('rounds the target weight to a whole number', () => {
    const r = getScaleReadout(12.3, 36.0)
    expect(r.target).toBe('36')
  })

  it('rounds fractional targets to the nearest integer', () => {
    expect(getScaleReadout(0, 35.6).target).toBe('36')
  })

  it('omits the target when the machine reports none', () => {
    expect(getScaleReadout(18, null).target).toBeNull()
    expect(getScaleReadout(18, undefined).target).toBeNull()
  })

  it('suppresses the target while idle (stale remnant of the last shot)', () => {
    expect(getScaleReadout(0, 36, true).target).toBeNull()
    expect(getScaleReadout(18, 36, false).target).toBe('36')
  })
})
