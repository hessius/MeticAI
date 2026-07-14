import { describe, expect, it } from 'vitest'
import { buildFullProfilePrompt, buildCompactProfilePrompt } from './profilePromptFull'

describe('buildFullProfilePrompt (compact / on-device)', () => {
  const args = ['Metic', 'light roast, 1:3 ratio', ['turbo'], false] as const

  it('is materially smaller than the full prompt', () => {
    const full = buildFullProfilePrompt(...args)
    const compact = buildFullProfilePrompt(...args, true)
    expect(compact.length).toBeLessThan(full.length * 0.6)
  })

  it('delegates to the compact builder when compact=true', () => {
    const viaFlag = buildFullProfilePrompt(...args, true)
    const direct = buildCompactProfilePrompt(...args)
    expect(viaFlag).toBe(direct)
  })

  it('preserves the output contract the extractor needs', () => {
    const p = buildFullProfilePrompt(...args, true)
    expect(p).toContain('**Profile Created:**')
    expect(p).toContain('```json')
    expect(p).toContain('author')
  })

  it('keeps the rejection-critical validation rules', () => {
    const p = buildFullProfilePrompt(...args, true)
    // paradox rule, failsafe/time backup, cross-type limits, relative time
    expect(p).toMatch(/flow stage must NOT have a flow exit trigger/i)
    expect(p).toMatch(/time exit trigger/i)
    expect(p).toMatch(/pressure stages need a flow limit/i)
    expect(p).toMatch(/relative/i)
  })

  it('honours mandatory user preferences', () => {
    const p = buildFullProfilePrompt('Metic', '20g dose', [], false, true)
    expect(p).toContain('20g dose')
    expect(p).toMatch(/MANDATORY/i)
  })

  it('adapts the task line for image input', () => {
    const withImage = buildFullProfilePrompt('Metic', '', [], true, true)
    const noImage = buildFullProfilePrompt('Metic', '', [], false, true)
    expect(withImage).toMatch(/coffee bag image/i)
    expect(noImage).not.toMatch(/coffee bag image/i)
  })
})
