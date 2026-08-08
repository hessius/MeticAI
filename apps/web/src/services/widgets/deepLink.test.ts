import { describe, expect, it } from 'vitest'
import { parseMeticDeepLink } from './deepLink'

describe('parseMeticDeepLink', () => {
  it('parses a start link with a profileId', () => {
    expect(parseMeticDeepLink('metic://start?profileId=abc123'))
      .toEqual({ action: 'start', profileId: 'abc123' })
  })

  it('url-decodes the profileId', () => {
    expect(parseMeticDeepLink('metic://start?profileId=a%20b'))
      .toEqual({ action: 'start', profileId: 'a b' })
  })

  it('parses a bare open link', () => {
    expect(parseMeticDeepLink('metic://open')).toEqual({ action: 'open' })
  })

  it('returns null for a start link without profileId', () => {
    expect(parseMeticDeepLink('metic://start')).toBeNull()
  })

  it('returns null for an empty profileId', () => {
    expect(parseMeticDeepLink('metic://start?profileId=')).toBeNull()
  })

  it('returns null for the wrong scheme', () => {
    expect(parseMeticDeepLink('https://start?profileId=x')).toBeNull()
  })

  it('returns null for an unknown host', () => {
    expect(parseMeticDeepLink('metic://frobnicate')).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(parseMeticDeepLink('not a url')).toBeNull()
  })
})
