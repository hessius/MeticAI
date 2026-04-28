import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDirectRequestContext, isMeticAIProxyApiPath, jsonResponse } from './directModeHttp'

describe('directModeHttp helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates JSON responses with application/json content type', async () => {
    const response = jsonResponse({ status: 'ok' }, 202)

    expect(response.status).toBe(202)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('identifies MeticAI proxy API paths without intercepting native machine API paths', () => {
    expect(isMeticAIProxyApiPath('/api/history')).toBe(true)
    expect(isMeticAIProxyApiPath(`${window.location.origin}/api/history`)).toBe(true)
    expect(isMeticAIProxyApiPath('http://machine.local:8080/api/getLastShotProfileJSON')).toBe(false)
    expect(isMeticAIProxyApiPath('http://machine.local:8080/api/profile/foo')).toBe(true)
    expect(isMeticAIProxyApiPath('http://machine.local:8080/api/machine/profiles')).toBe(true)
    expect(isMeticAIProxyApiPath('/api/v1/profile/list')).toBe(false)
    expect(isMeticAIProxyApiPath('/api/v10/profile/list')).toBe(false)
    expect(isMeticAIProxyApiPath('http://machine.local:8080/api/v10/profile/list')).toBe(false)
    expect(isMeticAIProxyApiPath('https://example.com/assets/app.js')).toBe(false)
  })

  it('uses a fallback origin outside browser contexts', () => {
    vi.stubGlobal('window', undefined)

    expect(getDirectRequestContext('/api/history')).toEqual({
      url: '/api/history',
      method: 'GET',
      pathname: '/api/history',
    })
    expect(isMeticAIProxyApiPath('/api/v10/profile/list')).toBe(false)
  })

  it('extracts request URL and method from supported fetch inputs', () => {
    expect(getDirectRequestContext('/api/history')).toEqual({
      url: '/api/history',
      method: 'GET',
      pathname: '/api/history',
    })
    expect(getDirectRequestContext(new URL('http://machine.local:8080/api/profile/foo'), { method: 'post' })).toEqual({
      url: 'http://machine.local:8080/api/profile/foo',
      method: 'POST',
      pathname: '/api/profile/foo',
    })
    expect(getDirectRequestContext(new Request('http://machine.local:8080/api/status'))).toEqual({
      url: 'http://machine.local:8080/api/status',
      method: 'GET',
      pathname: '/api/status',
    })
  })
})
