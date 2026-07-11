import { describe, expect, it } from 'vitest'
import {
  needsCompactPrompt,
  COMPACT_PROMPT_CONTEXT_THRESHOLD,
  getProvider,
} from './index'
import type { AIProvider } from './AIProvider'

function fakeProvider(contextWindowTokens?: number): AIProvider {
  return {
    id: 'fake',
    label: 'Fake',
    capabilities: { text: true, vision: false, imageGen: false, jsonMode: false, contextWindowTokens },
    isConfigured: () => true,
    detectFromKey: () => false,
    generateText: async () => ({ text: '' }),
    listModels: async () => [],
  }
}

describe('needsCompactPrompt', () => {
  it('is true for a small-window (on-device) provider', () => {
    expect(needsCompactPrompt(fakeProvider(4096))).toBe(true)
    expect(needsCompactPrompt(fakeProvider(COMPACT_PROMPT_CONTEXT_THRESHOLD))).toBe(true)
  })

  it('is false when no window is advertised (hosted, effectively unbounded)', () => {
    expect(needsCompactPrompt(fakeProvider(undefined))).toBe(false)
  })

  it('is false for a large-window provider', () => {
    expect(needsCompactPrompt(fakeProvider(COMPACT_PROMPT_CONTEXT_THRESHOLD + 1))).toBe(false)
    expect(needsCompactPrompt(fakeProvider(1_000_000))).toBe(false)
  })

  it('flags the on-device local provider and not the hosted Gemini provider', () => {
    expect(needsCompactPrompt(getProvider('local'))).toBe(true)
    expect(needsCompactPrompt(getProvider('gemini'))).toBe(false)
  })
})
