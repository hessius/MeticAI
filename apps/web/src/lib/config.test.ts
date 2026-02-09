import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import and re-export to reset cache
let loadConfig: (typeof import('./config'))['loadConfig']
let getServerUrl: (typeof import('./config'))['getServerUrl']

describe('config loader', () => {
  beforeEach(async () => {
    // Reset modules to clear cached config
    vi.resetModules()
    // Re-import the module to get fresh instances
    const configModule = await import('./config')
    loadConfig = configModule.loadConfig
    getServerUrl = configModule.getServerUrl
  })

  describe('loadConfig', () => {
    it('should return default config when fetch fails', async () => {
      // Mock fetch to fail
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
      
      const config = await loadConfig()
      expect(config.serverUrl).toBe('http://localhost:8000')
    })

    it('should return default config when config.json is not found', async () => {
      // Mock fetch to return 404
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      })
      
      const config = await loadConfig()
      expect(config.serverUrl).toBe('http://localhost:8000')
    })

    it('should load config from config.json when available', async () => {
      // Mock fetch to return a valid config
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ serverUrl: 'http://192.168.1.100:8080' })
      })
      
      const config = await loadConfig()
      expect(config.serverUrl).toBe('http://192.168.1.100:8080')
    })

    it('should merge loaded config with default config', async () => {
      // Mock fetch to return partial config
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ serverUrl: 'http://custom.server:3000' })
      })
      
      const config = await loadConfig()
      expect(config.serverUrl).toBe('http://custom.server:3000')
    })
  })

  describe('getServerUrl', () => {
    it('should return default server URL when no config is available', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
      
      const serverUrl = await getServerUrl()
      expect(serverUrl).toBe('http://localhost:8000')
    })

    it('should return configured server URL from config.json', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ serverUrl: 'http://example.com:9000' })
      })
      
      const serverUrl = await getServerUrl()
      expect(serverUrl).toBe('http://example.com:9000')
    })
  })
})
