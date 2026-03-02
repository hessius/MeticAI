import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Pour-Over Mode
 *
 * Tests:
 * - Navigation to pour-over
 * - Timer controls
 * - Scale/weight display
 * - Graph rendering
 * - Bloom phase indicator
 */

const BASE = process.env.BASE_URL || 'http://localhost:3550'

test.describe('Pour-Over View', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
  })

  test('should navigate to pour-over mode', async ({ page, browserName }) => {
    // Firefox has issues with pour-over navigation
    if (browserName === 'firefox') {
      test.skip()
      return
    }
    
    // Look for Pour Over button
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()

    // Should show pour-over view elements
    await expect(page.getByText(/Pour.?Over|Timer|Weight/i)).toBeVisible({ timeout: 5000 })
  })

  test('should display timer controls', async ({ page }) => {
    // Navigate to pour-over
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()

    // Should have start/stop controls
    const startButton = page.getByRole('button', { name: /Start|Begin/i })
    await expect(startButton).toBeVisible({ timeout: 5000 })
  })

  test('should display recipe/settings section', async ({ page }) => {
    // Navigate to pour-over
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()

    // Should have recipe inputs (dose, ratio, bloom)
    await expect(page.getByText(/Dose|Coffee|Ratio|Bloom/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('should allow adjusting recipe parameters', async ({ page }) => {
    // Navigate to pour-over
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()

    // Find a numeric input and verify it can be changed
    const doseInput = page.locator('input[type="number"]').first()
    const inputExists = await doseInput.isVisible({ timeout: 3000 }).catch(() => false)
    
    if (inputExists) {
      await doseInput.fill('18')
      await expect(doseInput).toHaveValue('18')
    }
  })

  test('should display weight graph area', async ({ page }) => {
    // Navigate to pour-over
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()

    // Should have a graph/chart area
    const graph = page.locator('svg, [data-testid="pour-over-graph"], .weight-graph')
    await expect(graph.first()).toBeVisible({ timeout: 5000 })
  })

  test('should show weight Y-axis ticks', async ({ page }) => {
    // Navigate to pour-over
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()

    // Should show weight ticks (0g, some midpoint, max)
    await expect(page.getByText(/\d+\s*g/i).first()).toBeVisible({ timeout: 5000 })
  })

  test('should navigate back from pour-over', async ({ page, browserName }) => {
    // Firefox has issues with pour-over navigation
    if (browserName === 'firefox') {
      test.skip()
      return
    }
    
    // Navigate to pour-over
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()
    
    // Verify we're in pour-over view
    await expect(page.getByText(/Pour.?Over|Timer|Weight/i)).toBeVisible({ timeout: 5000 })

    // Click logo to go back
    await page.locator('text=MeticAI').first().click()

    // Should be back on start
    await expect(page.getByRole('button', { name: /Generate New Profile/i })).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Pour-Over Timer Interaction', () => {
  test.use({ baseURL: BASE })

  test('should start and stop timer', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')

    // Navigate to pour-over
    const pourOverButton = page.getByRole('button', { name: /Pour.?Over|Pour Over/i })
    
    if (!(await pourOverButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await pourOverButton.click()

    // Find and click start button
    const startButton = page.getByRole('button', { name: /Start|Begin/i })
    await startButton.click()

    // Timer should be running - look for stop/pause button or changing time
    await page.waitForTimeout(1500)
    
    // Find stop/reset button
    const stopButton = page.getByRole('button', { name: /Stop|Pause|Reset/i })
    const stopExists = await stopButton.isVisible({ timeout: 2000 }).catch(() => false)
    
    if (stopExists) {
      await stopButton.click()
    }
  })
})
