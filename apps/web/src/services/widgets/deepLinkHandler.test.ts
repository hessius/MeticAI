import { describe, expect, it, vi } from 'vitest'
import { handleMeticDeepLink } from './deepLinkHandler'

function makeMachine() {
  return {
    loadProfile: vi.fn(async () => ({ ok: true })),
    startShot: vi.fn(async () => ({ ok: true })),
  }
}

describe('handleMeticDeepLink', () => {
  it('loads then starts on a start link, resolving id to a profile name', async () => {
    const machine = makeMachine()
    const lookupName = vi.fn(async (id: string) => (id === 'abc' ? 'Slow-Mo Blossom' : null))

    const result = await handleMeticDeepLink('metic://start?profileId=abc', { machine, lookupName })

    expect(result).toBe('started')
    expect(lookupName).toHaveBeenCalledWith('abc')
    expect(machine.loadProfile).toHaveBeenCalledWith('Slow-Mo Blossom')
    expect(machine.startShot).toHaveBeenCalledTimes(1)
    // load must precede start
    expect(machine.loadProfile.mock.invocationCallOrder[0])
      .toBeLessThan(machine.startShot.mock.invocationCallOrder[0])
  })

  it('does not start when the profile id cannot be resolved', async () => {
    const machine = makeMachine()
    const lookupName = vi.fn(async () => null)
    const result = await handleMeticDeepLink('metic://start?profileId=nope', { machine, lookupName })
    expect(result).toBe('profile-not-found')
    expect(machine.startShot).not.toHaveBeenCalled()
  })

  it('returns "opened" for a bare open link without touching the machine', async () => {
    const machine = makeMachine()
    const result = await handleMeticDeepLink('metic://open', { machine, lookupName: vi.fn() })
    expect(result).toBe('opened')
    expect(machine.loadProfile).not.toHaveBeenCalled()
  })

  it('returns "ignored" for a non-metic url', async () => {
    const machine = makeMachine()
    const result = await handleMeticDeepLink('https://example.com', { machine, lookupName: vi.fn() })
    expect(result).toBe('ignored')
  })
})
