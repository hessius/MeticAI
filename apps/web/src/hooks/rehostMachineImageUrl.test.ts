import { describe, expect, it } from 'vitest'
import { rehostMachineImageUrl } from './useProfileImageSrc'

const BASE = 'http://192.168.0.5' // port 80 (implicit)

describe('rehostMachineImageUrl', () => {
  it('rewrites a stale :8080 machine image URL onto the current base', () => {
    expect(
      rehostMachineImageUrl(
        'http://192.168.0.5:8080/api/v1/profile/image/abc.jpeg',
        BASE,
      ),
    ).toBe('http://192.168.0.5/api/v1/profile/image/abc.jpeg')
  })

  it('rewrites the host when the machine IP changed', () => {
    expect(
      rehostMachineImageUrl(
        'http://10.0.0.9:8080/api/v1/profile/image/abc.jpeg',
        'http://192.168.0.5:8080',
      ),
    ).toBe('http://192.168.0.5:8080/api/v1/profile/image/abc.jpeg')
  })

  it('resolves a relative machine path against the base', () => {
    expect(
      rehostMachineImageUrl('/api/v1/profile/image/abc.jpeg', 'http://192.168.0.5:8080'),
    ).toBe('http://192.168.0.5:8080/api/v1/profile/image/abc.jpeg')
  })

  it('leaves data URIs untouched', () => {
    const uri = 'data:image/png;base64,AAAA'
    expect(rehostMachineImageUrl(uri, BASE)).toBe(uri)
  })

  it('leaves external (non-machine) image URLs untouched', () => {
    const cdn = 'https://cdn.metprofiles.com/img/xyz.jpg'
    expect(rehostMachineImageUrl(cdn, BASE)).toBe(cdn)
  })

  it('returns undefined for empty input', () => {
    expect(rehostMachineImageUrl(undefined, BASE)).toBeUndefined()
    expect(rehostMachineImageUrl(null, BASE)).toBeUndefined()
    expect(rehostMachineImageUrl('', BASE)).toBeUndefined()
  })

  it('returns the input unchanged when the base is unparseable', () => {
    const url = 'http://192.168.0.5:8080/api/v1/profile/image/abc.jpeg'
    expect(rehostMachineImageUrl(url, 'not a url')).toBe(url)
  })
})
