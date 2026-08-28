import { describe, expect, it, vi } from 'vitest'
import { extractShareSource, type SharedContent } from './shareImport'

describe('extractShareSource', () => {
  const noRead = vi.fn(async () => {
    throw new Error('should not read')
  })

  it('prefers shared text (a metprofiles link)', async () => {
    const event: SharedContent = {
      texts: ['https://metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd'],
    }
    expect(await extractShareSource(event, noRead)).toBe(
      'https://metprofiles.link/profile/cd10c990-2185-4633-b883-f3fa4ed7dbfd',
    )
  })

  it('returns pasted raw JSON text', async () => {
    const event: SharedContent = { texts: ['  {"name":"Pasted"}  '] }
    expect(await extractShareSource(event, noRead)).toBe('{"name":"Pasted"}')
  })

  it('skips empty texts and falls back to the first non-empty one', async () => {
    const event: SharedContent = { texts: ['', '   ', 'https://example.com/p.json'] }
    expect(await extractShareSource(event, noRead)).toBe('https://example.com/p.json')
  })

  it('reads a shared .json file when no text is present', async () => {
    const readFile = vi.fn(async () => '{"name":"FromFile"}')
    const event: SharedContent = {
      files: [{ uri: 'file:///tmp/p.json', name: 'p.json', mimeType: 'application/json' }],
    }
    expect(await extractShareSource(event, readFile)).toBe('{"name":"FromFile"}')
    expect(readFile).toHaveBeenCalledWith('file:///tmp/p.json')
  })

  it('prefers a profile-like file over an unrelated one', async () => {
    const readFile = vi.fn(async (uri: string) =>
      uri.endsWith('.json') ? '{"name":"Right"}' : 'nope',
    )
    const event: SharedContent = {
      files: [
        { uri: 'file:///a.png', name: 'a.png', mimeType: 'image/png' },
        { uri: 'file:///b.json', name: 'b.json', mimeType: 'application/json' },
      ],
    }
    expect(await extractShareSource(event, readFile)).toBe('{"name":"Right"}')
  })

  it('accepts a .met file', async () => {
    const readFile = vi.fn(async () => '{"name":"Met"}')
    const event: SharedContent = {
      files: [{ uri: 'file:///p.met', name: 'p.met', mimeType: 'application/octet-stream' }],
    }
    expect(await extractShareSource(event, readFile)).toBe('{"name":"Met"}')
  })

  it('returns null when a file read fails', async () => {
    const readFile = vi.fn(async () => {
      throw new Error('io')
    })
    const event: SharedContent = {
      files: [{ uri: 'file:///p.json', name: 'p.json', mimeType: 'application/json' }],
    }
    expect(await extractShareSource(event, readFile)).toBeNull()
  })

  it('returns null for an empty event', async () => {
    expect(await extractShareSource({}, noRead)).toBeNull()
    expect(await extractShareSource({ texts: [], files: [] }, noRead)).toBeNull()
  })
})
