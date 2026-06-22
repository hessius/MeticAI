import { describe, expect, it, vi, beforeEach } from 'vitest'
import { __resetModelCache } from './modelResolver'
import { generateTextWithRetry } from './BrowserAIService'

describe('BrowserAIService reactive model retry', () => {
  beforeEach(() => __resetModelCache())

  it('re-resolves and retries once on MODEL_NOT_FOUND', async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(new Error('404 NOT_FOUND: model gemini-2.5-flash'))
      .mockResolvedValueOnce({ text: 'ok' })
    const fakeClient = {
      models: {
        generateContent,
        get: vi.fn().mockResolvedValue({}),
        list: vi.fn().mockResolvedValue([{ name: 'gemini-2.5-pro', supportedActions: ['generateContent'] }]),
      },
    }
    const res = await generateTextWithRetry(fakeClient as never, 'gemini-2.5-flash', { contents: 'hi' })
    expect((res as { text: string }).text).toBe('ok')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })
})
