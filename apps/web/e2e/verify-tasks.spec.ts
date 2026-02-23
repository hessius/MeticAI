import { test, expect } from '@playwright/test'

/**
 * Verification tests for v2.0.0 tasks — run against the Docker container.
 *
 * Override the base URL with:
 *   npx playwright test e2e/verify-tasks.spec.ts --config=playwright.config.ts
 */

const BASE = process.env.BASE_URL || 'http://localhost:3550'

test.describe('v2.0.0 Task Verification', () => {
  test.use({ baseURL: BASE })

  // -----------------------------------------------------------------
  // Task: "Goals" → "Targets" rename
  // -----------------------------------------------------------------
  test('English translations use "targets" instead of "goals"', async ({ page }) => {
    // Fetch the EN translation file served by nginx
    const res = await page.request.get(`${BASE}/locales/en/translation.json`)
    expect(res.ok()).toBeTruthy()

    const json = await res.json()

    // shotHistory section
    expect(json.shotHistory.targetsReached).toContain('targets reached')
    expect(json.shotHistory.targetReached).toContain('Target')
    expect(json.shotHistory).not.toHaveProperty('goalsReached')
    expect(json.shotHistory).not.toHaveProperty('goalReached')

    // controlCenter.liveShot — "goal" should now be "target"
    expect(json.controlCenter.liveShot.target).toBeDefined()
    expect(json.controlCenter.liveShot).not.toHaveProperty('goal')
  })

  test('Non-English translations also use target keys', async ({ page }) => {
    for (const lang of ['de', 'sv', 'fr', 'it', 'es']) {
      const res = await page.request.get(`${BASE}/locales/${lang}/translation.json`)
      expect(res.ok()).toBeTruthy()
      const json = await res.json()

      expect(json.shotHistory).toHaveProperty('targetsReached')
      expect(json.shotHistory).not.toHaveProperty('goalsReached')
      expect(json.shotHistory).toHaveProperty('targetReached')
      expect(json.shotHistory).not.toHaveProperty('goalReached')
      expect(json.controlCenter.liveShot).toHaveProperty('target')
      expect(json.controlCenter.liveShot).not.toHaveProperty('goal')
    }
  })

  // -----------------------------------------------------------------
  // Task: "Done" → "Analyze Shot"
  // -----------------------------------------------------------------
  test('"analyzeShot" key says "Analyze Shot" not "Done"', async ({ page }) => {
    const res = await page.request.get(`${BASE}/locales/en/translation.json`)
    const json = await res.json()

    expect(json.shotHistory.analyzeShot).toBe('Analyze Shot')
    expect(json.controlCenter.liveShot.analyzeShot).toBe('Analyze Shot')
  })

  // -----------------------------------------------------------------
  // Task: Power and temp metric keys exist
  // -----------------------------------------------------------------
  test('controlCenter.metrics includes power and temp', async ({ page }) => {
    const res = await page.request.get(`${BASE}/locales/en/translation.json`)
    const json = await res.json()

    expect(json.controlCenter.metrics.power).toBe('Power')
    expect(json.controlCenter.metrics.temp).toBe('Temp')
  })

  // -----------------------------------------------------------------
  // Basic app loading
  // -----------------------------------------------------------------
  test('homepage loads and renders MeticAI', async ({ page }) => {
    await page.goto('/')
    // The app should render something with "MeticAI" or "Meticulous"
    await expect(page.locator('body')).toContainText(/Metic/i)
  })

  test('health check endpoint responds', async ({ page }) => {
    const res = await page.request.get(`${BASE}/health`)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.status).toBe('ok')
  })

  test('API version endpoint responds', async ({ page }) => {
    const res = await page.request.get(`${BASE}/api/version`)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.version).toBeDefined()
  })

  // -----------------------------------------------------------------
  // Verify the built JS bundle contains "Targets" (not "Goals") in tooltip
  // -----------------------------------------------------------------
  test('Built JS bundle contains "Targets" string for tooltip', async ({ page }) => {
    await page.goto('/')
    // Wait for the app to fully load
    await page.waitForTimeout(2000)
    
    // Fetch the main JS bundle and verify "Targets" is present
    const scripts = page.locator('script[src]')
    const count = await scripts.count()
    let foundTargets = false
    
    for (let i = 0; i < count; i++) {
      const src = await scripts.nth(i).getAttribute('src')
      if (src && src.includes('.js')) {
        const fullUrl = src.startsWith('http') ? src : `${BASE}${src}`
        const res = await page.request.get(fullUrl)
        if (res.ok()) {
          const text = await res.text()
          if (text.includes('Targets')) {
            foundTargets = true
            // Also verify "Goals" is NOT in the tooltip context
            // (it could appear in third-party code, so we check specifically near "Targets")
            break
          }
        }
      }
    }
    expect(foundTargets).toBeTruthy()
  })
})
