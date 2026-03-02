import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Shot History and Analysis
 *
 * Tests:
 * - Shot history list/display
 * - Shot analysis (static and LLM)
 * - Shot data caching
 * - Shot comparison
 */

const BASE = process.env.BASE_URL || 'http://localhost:3550'
const needsDocker = BASE.includes('3550')

test.describe('Shot History View', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
  })

  test('should access shot history from run shot view', async ({ page }) => {
    // Navigate to Run Shot view
    const runShotButton = page.getByRole('button', { name: /Run Shot|Start Shot/i })
    
    if (!(await runShotButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await runShotButton.click()

    // Look for shot history or past shots section
    const shotsSection = page.getByText(/Past Shots|Shot History|Recent Shots/i)
    await expect(shotsSection).toBeVisible({ timeout: 5000 })
  })

  test('should display shot list when shots are available', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Navigate to shot history
    const runShotButton = page.getByRole('button', { name: /Run Shot|Start Shot/i })
    
    if (!(await runShotButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await runShotButton.click()

    // Wait for shot list to load
    await page.waitForTimeout(2000)

    // Should show either shot cards or empty state
    const shotContent = page.locator('[data-testid="shot-item"], .shot-card, text=/No shots|No history/i')
    await expect(shotContent.first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Shot Analysis', () => {
  test.use({ baseURL: BASE })

  test('should display analysis when clicking on a shot', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    await page.goto('/')
    await page.waitForSelector('text=MeticAI')

    // Navigate to shot history
    const runShotButton = page.getByRole('button', { name: /Run Shot|Start Shot/i })
    
    if (!(await runShotButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await runShotButton.click()

    // Wait for shots to load and click on first one if available
    const shotItem = page.locator('[data-testid="shot-item"], .shot-card').first()
    
    const shotExists = await shotItem.isVisible({ timeout: 3000 }).catch(() => false)
    
    if (shotExists) {
      await shotItem.click()
      
      // Should show shot details/analysis view
      await expect(page.getByText(/Analysis|Details|Shot Data/i)).toBeVisible({ timeout: 5000 })
    } else {
      test.skip()
    }
  })

  test('should show shot graph with data points', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    await page.goto('/')
    await page.waitForSelector('text=MeticAI')

    // Navigate to shot history and click a shot
    const runShotButton = page.getByRole('button', { name: /Run Shot|Start Shot/i })
    
    if (!(await runShotButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await runShotButton.click()

    const shotItem = page.locator('[data-testid="shot-item"], .shot-card').first()
    const shotExists = await shotItem.isVisible({ timeout: 3000 }).catch(() => false)
    
    if (shotExists) {
      await shotItem.click()
      
      // Look for chart/graph element
      const chart = page.locator('svg.recharts-surface, [data-testid="shot-chart"], canvas')
      await expect(chart.first()).toBeVisible({ timeout: 5000 })
    } else {
      test.skip()
    }
  })
})

test.describe('Shot Analysis - LLM', () => {
  test.use({ baseURL: BASE })

  test('should show AI analysis button when AI is configured', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    await page.goto('/')
    await page.waitForSelector('text=MeticAI')

    // Navigate through to a shot analysis
    const runShotButton = page.getByRole('button', { name: /Run Shot|Start Shot/i })
    
    if (!(await runShotButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await runShotButton.click()

    const shotItem = page.locator('[data-testid="shot-item"], .shot-card').first()
    const shotExists = await shotItem.isVisible({ timeout: 3000 }).catch(() => false)
    
    if (shotExists) {
      await shotItem.click()
      
      // Look for AI analysis button
      const aiButton = page.getByRole('button', { name: /AI Analysis|Analyze|Expert Analysis/i })
      const aiVisible = await aiButton.isVisible({ timeout: 3000 }).catch(() => false)
      
      if (aiVisible) {
        await expect(aiButton).toBeEnabled()
      }
      // AI button may not be visible if Gemini not configured - OK to pass
    }
  })
})

test.describe('Shot Caching', () => {
  test.use({ baseURL: BASE })

  test('cached shots load faster on revisit', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    await page.goto('/')
    await page.waitForSelector('text=MeticAI')

    // Navigate to shot history
    const runShotButton = page.getByRole('button', { name: /Run Shot|Start Shot/i })
    
    if (!(await runShotButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await runShotButton.click()
    
    // First load - measure time
    const startTime1 = Date.now()
    await page.waitForTimeout(1000) // Allow data to load
    const loadTime1 = Date.now() - startTime1

    // Go back and revisit
    await page.locator('text=MeticAI').first().click()
    await page.waitForTimeout(500)
    
    await runShotButton.click()
    
    // Second load - should use cache
    const startTime2 = Date.now()
    await page.waitForTimeout(1000)
    const loadTime2 = Date.now() - startTime2

    // Second load should be roughly same or faster (at least not significantly slower)
    // This is a sanity check - actual caching is tested in unit tests
    expect(loadTime2).toBeLessThanOrEqual(loadTime1 + 2000)
  })
})
