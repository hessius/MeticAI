import { describe, expect, it } from 'vitest'
import { GoogleGenAI } from '@google/genai'
import { rankModels, type DiscoveredModel } from './modelResolver'

const KEY = process.env.GEMINI_API_KEY
const maybe = KEY ? describe : describe.skip

maybe('LIVE: Gemini models.list() (opt-in)', () => {
  it('lists real models and ranks one that validates', async () => {
    const client = new GoogleGenAI({ apiKey: KEY! })
    const models: DiscoveredModel[] = []
    for await (const m of await client.models.list()) {
      models.push(m as unknown as DiscoveredModel)
    }
    expect(models.length).toBeGreaterThan(0)

    const best = rankModels(models)
    expect(best).toBeTruthy()

    // The chosen model must exist on the API.
    await expect(client.models.get({ model: best! })).resolves.toBeTruthy()
  }, 30_000)
})
