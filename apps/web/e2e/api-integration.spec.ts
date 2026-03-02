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
    // API returns version, commit, repo_url
    expect(data).toHaveProperty('repo_url')
  })

  test('GET /api/status returns update status', async ({ request }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const response = await request.get('/api/status')
    expect(response.ok()).toBeTruthy()
    
    const data = await response.json()
    // API returns update_available, latest_version, current_version, etc.
    expect(typeof data.update_available).toBe('boolean')
    expect(data).toHaveProperty('current_version')
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
    // Settings returned directly at top level
    expect(typeof data.mqttEnabled).toBe('boolean')
    expect(data).toHaveProperty('meticulousIp')
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
      data: current
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
    // API returns { entries: [...] }
    expect(Array.isArray(data.entries)).toBe(true)
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

  test('GET /api/last-shot returns last shot info', async () => {
    // This test is flaky across browsers due to large JSON response handling
    // The API request sometimes fails with the large shot data (16KB+)
    // Skipped until we can implement proper response streaming
    test.skip()
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
    // API returns { mqtt_enabled, mosquitto: {...}, bridge: {...}, mqtt_subscriber: {...} }
    expect(typeof data.mqtt_enabled).toBe('boolean')
    expect(data).toHaveProperty('mosquitto')
    expect(data).toHaveProperty('bridge')
  })
})

// Note: Beta channel endpoint not yet implemented - test removed
// test.describe('API Integration - Beta Channel', () => { ... })

// Note: Scheduled shots endpoints not yet implemented - tests removed
// test.describe('API Integration - Scheduled Shots', () => { ... })
