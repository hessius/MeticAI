import { describe, it, expect, vi, beforeEach } from 'vitest'
import { preparePourOver, cleanupPourOver, forceCleanupPourOver, getActivePourOver, getPourOverPreferences, savePourOverPreferences } from './pourOverApi'

// Mock getServerUrl
vi.mock('@/lib/config', () => ({
  getServerUrl: vi.fn().mockResolvedValue('http://localhost:3550'),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('pourOverApi', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('preparePourOver', () => {
    it('sends POST with correct body and returns response', async () => {
      const response = { profile_id: 'abc-123', profile_name: '[Temp] Pour-Over', loaded: true }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
      })

      const result = await preparePourOver({
        target_weight: 300,
        bloom_enabled: true,
        bloom_seconds: 30,
        dose_grams: 20,
        brew_ratio: 15,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3550/api/pour-over/prepare',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_weight: 300,
            bloom_enabled: true,
            bloom_seconds: 30,
            dose_grams: 20,
            brew_ratio: 15,
          }),
        },
      )
      expect(result).toEqual(response)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ detail: 'Invalid weight' }),
      })

      await expect(preparePourOver({ target_weight: -1 })).rejects.toThrow('Invalid weight')
    })

    it('uses statusText when detail is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('no json')),
      })

      await expect(preparePourOver({ target_weight: 300 })).rejects.toThrow('Prepare failed: Internal Server Error')
    })
  })

  describe('cleanupPourOver', () => {
    it('sends POST and returns cleanup response', async () => {
      const response = { deleted: true, purged: true }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
      })

      const result = await cleanupPourOver()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3550/api/pour-over/cleanup',
        { method: 'POST' },
      )
      expect(result).toEqual(response)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ detail: 'No active profile' }),
      })

      await expect(cleanupPourOver()).rejects.toThrow('No active profile')
    })
  })

  describe('forceCleanupPourOver', () => {
    it('sends POST and returns response', async () => {
      const response = { deleted: true }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
      })

      const result = await forceCleanupPourOver()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3550/api/pour-over/force-cleanup',
        { method: 'POST' },
      )
      expect(result).toEqual(response)
    })
  })

  describe('getActivePourOver', () => {
    it('sends GET and returns active status', async () => {
      const response = { active: true, profile_id: 'abc', profile_name: '[Temp] Test', created_at: '2025-01-01T00:00:00' }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
      })

      const result = await getActivePourOver()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3550/api/pour-over/active',
      )
      expect(result).toEqual(response)
    })

    it('returns inactive when no profile', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ active: false }),
      })

      const result = await getActivePourOver()
      expect(result.active).toBe(false)
    })
  })

  describe('getPourOverPreferences', () => {
    it('sends GET and returns preferences', async () => {
      const prefs = {
        free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, machineIntegration: false },
        ratio: { autoStart: false, bloomEnabled: false, bloomSeconds: 45, machineIntegration: true },
      }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(prefs),
      })

      const result = await getPourOverPreferences()
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3550/api/pour-over/preferences')
      expect(result).toEqual(prefs)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ detail: 'Read failed' }),
      })

      await expect(getPourOverPreferences()).rejects.toThrow('Read failed')
    })
  })

  describe('savePourOverPreferences', () => {
    it('sends PUT with body and returns saved preferences', async () => {
      const prefs = {
        free: { autoStart: false, bloomEnabled: true, bloomSeconds: 60, machineIntegration: false },
        ratio: { autoStart: true, bloomEnabled: false, bloomSeconds: 20, machineIntegration: true },
      }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(prefs),
      })

      const result = await savePourOverPreferences(prefs)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3550/api/pour-over/preferences',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs),
        },
      )
      expect(result).toEqual(prefs)
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ detail: 'Validation error' }),
      })

      await expect(savePourOverPreferences({
        free: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, machineIntegration: false },
        ratio: { autoStart: true, bloomEnabled: true, bloomSeconds: 30, machineIntegration: false },
      })).rejects.toThrow('Validation error')
    })
  })
})
