import { describe, expect, it } from 'vitest'
import { rankModels } from './modelResolver'

const m = (name: string) => ({ name, supportedActions: ['generateContent'] })

describe('rankModels', () => {
  it('prefers flash over pro', () => {
    expect(rankModels([m('gemini-2.5-pro'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('prefers higher version', () => {
    expect(rankModels([m('gemini-2.0-flash'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('flash beats flash-lite', () => {
    expect(rankModels([m('gemini-2.5-flash-lite'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('flash-lite beats pro', () => {
    expect(rankModels([m('gemini-2.5-pro'), m('gemini-2.5-flash-lite')])).toBe('gemini-2.5-flash-lite')
  })
  it('prefers stable over preview', () => {
    expect(rankModels([m('gemini-3.0-flash-preview-09-2025'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('allows preview as last resort', () => {
    expect(rankModels([m('gemini-3.0-flash-exp')])).toBe('gemini-3.0-flash-exp')
  })
  it('excludes non-text families', () => {
    expect(rankModels([m('imagen-4.0-generate-001'), m('text-embedding-004')])).toBeNull()
  })
  it('strips models/ prefix', () => {
    expect(rankModels([m('models/gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('filters models without generateContent', () => {
    expect(rankModels([{ name: 'gemini-2.5-flash', supportedActions: ['embedContent'] }])).toBeNull()
  })
  it('returns null for empty input', () => {
    expect(rankModels([])).toBeNull()
  })
})
