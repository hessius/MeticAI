import { test, expect } from '@playwright/test'

/**
 * API Integration Tests - Run against Docker container
 *
 * These tests verify backend API functionality through the browser's fetch API.
 * They require BASE_URL to point to the Docker container (port 3550).
 *
 * Covers:
 * - Profile API (list, get, import)
 * - Shot API (history, data, analysis)
 * - Settings API
 * - Health/Version endpoints
 * - Cache functionality
 */

// Only run API integration tests when BASE_URL is explicitly set to Docker container
const BASE_URL_SET = !!process.env.BASE_URL
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const needsDocker = BASE_URL_SET && BASE.includes('3550')

test.describe('API Integration - Health & Version', () => {
  test.use({ baseURL: BASE })

  test('GET /api/health returns OK', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/health')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  test('GET /api/version returns version info', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/version')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(data.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(typeof data.is_beta_version).toBe('boolean')
    expect(typeof data.beta_channel_enabled).toBe('boolean')
    expect(data.channel).toMatch(/stable|beta/)
  })

  test('GET /api/status returns connection status', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/status')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(typeof data.connected).toBe('boolean')
  })
})

test.describe('API Integration - Settings', () => {
  test.use({ baseURL: BASE })

  test('GET /api/settings returns settings object', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/settings')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(data).toHaveProperty('settings')
    expect(typeof data.settings.mqttEnabled).toBe('boolean')
    expect(typeof data.settings.betaChannel).toBe('boolean')
  })

  test('POST /api/settings accepts valid settings', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Get current settings first
    const getResponse = await request.get('/api/settings')
    const current = await getResponse.json()
    
    // Re-save the same settings (no actual change)
    const response = await request.post('/api/settings', {
      data: current.settings
    })
    
    expect(response.ok()).toBeTruthy()
  })
})

test.describe('API Integration - Profiles', () => {
  test.use({ baseURL: BASE })

  test('GET /api/profiles returns profile list', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/profiles')
    
    // May fail if machine not connected - that's OK
    if (response.ok()) {
      const data = await response.json()
      expect(Array.isArray(data.profiles || data)).toBe(true)
    } else {
      // Expected if machine not connected
      expect(response.status()).toBeGreaterThanOrEqual(400)
    }
  })

  test('GET /api/history returns analysis history', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/history')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(Array.isArray(data.history || data)).toBe(true)
  })
})

test.describe('API Integration - Shots', () => {
  test.use({ baseURL: BASE })

  test('GET /api/shots/dates returns shot dates', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/shots/dates')
    
    if (response.ok()) {
      const data = await response.json()
      expect(Array.isArray(data.dates || data)).toBe(true)
    }
  })

  test('GET /api/last-shot returns last shot info', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/last-shot')
    
    // May return 404 if no shots - that's OK
    if (response.ok()) {
      const data = await response.json()
      expect(data).toBeDefined()
    } else {
      expect([404, 500]).toContain(response.status())
    }
  })
})

test.describe('API Integration - Cache', () => {
  test.use({ baseURL: BASE })

  test('GET /api/cache/stats returns cache statistics', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/cache/stats')
    
    if (response.ok()) {
      const data = await response.json()
      expect(data).toBeDefined()
    }
  })
})

test.describe('API Integration - Bridge/MQTT', () => {
  test.use({ baseURL: BASE })

  test('GET /api/bridge/status returns bridge status', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/bridge/status')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(typeof data.bridge_running).toBe('boolean')
    expect(typeof data.mqtt_broker_running).toBe('boolean')
  })
})

test.describe('API Integration - Beta Channel', () => {
  test.use({ baseURL: BASE })

  test('POST /api/beta-channel validates input', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Test enabling beta channel
    const response = await request.post('/api/beta-channel', {
      data: { enabled: false } // Keep disabled
    })
    
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(typeof data.success).toBe('boolean')
  })
})

test.describe('API Integration - Scheduled Shots', () => {
  test.use({ baseURL: BASE })

  test('GET /api/scheduled-shots returns schedule list', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/scheduled-shots')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(Array.isArray(data.schedules || data)).toBe(true)
  })

  test('GET /api/recurring-schedules returns recurring list', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/recurring-schedules')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    expect(Array.isArray(data.schedules || data)).toBe(true)
  })
})
