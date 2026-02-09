import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getNetworkUrl, isLocalhostUrl } from './network-url'

// Mock the config module
vi.mock('./config', () => ({
  getServerUrl: vi.fn().mockResolvedValue('http://localhost:5000')
}))

describe('network-url utilities', () => {
  beforeEach(() => {
    // Reset location mock before each test
    delete (window as { location?: Location }).location
    vi.clearAllMocks()
  })

  describe('isLocalhostUrl', () => {
    it('should return true for localhost hostname', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
        configurable: true,
      })
      
      expect(isLocalhostUrl()).toBe(true)
    })

    it('should return true for 127.0.0.1 hostname', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: '127.0.0.1' },
        writable: true,
        configurable: true,
      })
      
      expect(isLocalhostUrl()).toBe(true)
    })

    it('should return true for ::1 hostname', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: '::1' },
        writable: true,
        configurable: true,
      })
      
      expect(isLocalhostUrl()).toBe(true)
    })

    it('should return false for non-localhost hostname', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com' },
        writable: true,
        configurable: true,
      })
      
      expect(isLocalhostUrl()).toBe(false)
    })

    it('should return false for IP address hostname', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: '192.168.1.100' },
        writable: true,
        configurable: true,
      })
      
      expect(isLocalhostUrl()).toBe(false)
    })
  })

  describe('getNetworkUrl', () => {
    it('should return current URL when not localhost', async () => {
      Object.defineProperty(window, 'location', {
        value: { 
          href: 'https://example.com/app',
          hostname: 'example.com'
        },
        writable: true,
        configurable: true,
      })
      
      const url = await getNetworkUrl()
      expect(url).toBe('https://example.com/app')
    })

    it('should return current URL when localhost and server URL is also localhost', async () => {
      const { getServerUrl } = await import('./config')
      vi.mocked(getServerUrl).mockResolvedValue('http://localhost:5000')
      
      Object.defineProperty(window, 'location', {
        value: { 
          href: 'http://localhost:5173/app',
          hostname: 'localhost',
          protocol: 'http:',
          port: '5173',
          pathname: '/app',
          search: '',
          hash: ''
        },
        writable: true,
        configurable: true,
      })
      
      const url = await getNetworkUrl()
      expect(url).toBe('http://localhost:5173/app')
    })

    it('should replace localhost with server IP when server URL has network IP', async () => {
      const { getServerUrl } = await import('./config')
      vi.mocked(getServerUrl).mockResolvedValue('http://192.168.1.100:5000')
      
      Object.defineProperty(window, 'location', {
        value: { 
          href: 'http://localhost:5173/app',
          hostname: 'localhost',
          protocol: 'http:',
          port: '5173',
          pathname: '/app',
          search: '',
          hash: ''
        },
        writable: true,
        configurable: true,
      })
      
      const url = await getNetworkUrl()
      expect(url).toBe('http://192.168.1.100:5173/app')
    })

    it('should handle errors gracefully', async () => {
      const { getServerUrl } = await import('./config')
      vi.mocked(getServerUrl).mockRejectedValue(new Error('Config load failed'))
      
      Object.defineProperty(window, 'location', {
        value: { 
          href: 'http://localhost:5173/app',
          hostname: 'localhost'
        },
        writable: true,
        configurable: true,
      })
      
      const url = await getNetworkUrl()
      expect(url).toBe('http://localhost:5173/app')
    })
  })
})
