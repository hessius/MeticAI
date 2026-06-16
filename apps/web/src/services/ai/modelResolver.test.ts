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

import { resolveWorkingModel, __resetModelCache } from './modelResolver'
import { beforeEach } from 'vitest'

interface FakeClient {
  models: {
    get: (args: { model: string }) => Promise<unknown>
    list: () => Promise<{ name: string; supportedActions: string[] }[]>
  }
}

const makeClient = (opts: { validConfigured: boolean; list: string[] }): FakeClient => ({
  models: {
    get: async ({ model }) => {
      if (opts.validConfigured && model === 'gemini-2.5-flash') return {}
      throw new Error('404 NOT_FOUND')
    },
    list: async () => opts.list.map(n => ({ name: n, supportedActions: ['generateContent'] })),
  },
})

describe('resolveWorkingModel', () => {
  beforeEach(() => __resetModelCache())

  it('returns the configured model when it validates', async () => {
    const c = makeClient({ validConfigured: true, list: ['gemini-2.5-pro'] })
    expect(await resolveWorkingModel(c as never, 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('falls back to a discovered model when configured is dead', async () => {
    const c = makeClient({ validConfigured: false, list: ['gemini-2.5-pro', 'gemini-2.5-flash'] })
    expect(await resolveWorkingModel(c as never, 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('throws MODEL_NOT_FOUND when nothing is available', async () => {
    const c = makeClient({ validConfigured: false, list: [] })
    await expect(resolveWorkingModel(c as never, 'gemini-2.5-flash')).rejects.toThrow('MODEL_NOT_FOUND')
  })

  it('caches the resolved model (no second validation)', async () => {
    const c = makeClient({ validConfigured: true, list: [] })
    let getCalls = 0
    const orig = c.models.get
    c.models.get = async (a) => { getCalls++; return orig(a) }
    await resolveWorkingModel(c as never, 'gemini-2.5-flash')
    await resolveWorkingModel(c as never, 'gemini-2.5-flash')
    expect(getCalls).toBe(1)
  })

  it('forceRefresh bypasses the cache and re-resolves via discovery', async () => {
    // forceRefresh skips the (assumed dead) configured model and goes straight
    // to dynamic discovery, so the freshly-discovered model is returned instead
    // of the cached configured one.
    const c = makeClient({ validConfigured: true, list: ['gemini-2.5-pro'] })
    let listCalls = 0
    const origList = c.models.list
    c.models.list = async () => { listCalls++; return origList() }

    const first = await resolveWorkingModel(c as never, 'gemini-2.5-flash')
    expect(first).toBe('gemini-2.5-flash')
    expect(listCalls).toBe(0)

    const second = await resolveWorkingModel(c as never, 'gemini-2.5-flash', true)
    expect(second).toBe('gemini-2.5-pro')
    expect(listCalls).toBe(1)
  })
})
