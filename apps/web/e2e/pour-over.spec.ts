import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Pour-Over Mode
 *
 * Tests:
 * - Navigation to pour-over
 * - Timer controls
 * - View elements
 */

const BASE_URL_SET = !!process.env.BASE_URL
const BASE = process.env.BASE_URL || 'http://localhost:3550'
const needsDocker = BASE_URL_SET && BASE.includes('3550')

test.describe('Pour-Over View', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    await page.waitForLoadState('networkidle')
  })

  test('should navigate to pour-over mode', async ({ page }) => {
    // Find Pour Over button
    const pourOverButton = page.getByRole('button', { name: /Pour-over/i })
    await expect(pourOverButton).toBeVisible({ timeout: 5000 })
    await pourOverButton.click()

    // Should show pour-over view
    await expect(page.getByText(/Pour-over/i)).toBeVisible({ timeout: 5000 })
  })

  test('should display timer controls', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const pourOverButton = page.getByRole('button', { name: /Pour-over/i })
    await expect(pourOverButton).toBeVisible({ timeout: 5000 })
    await pourOverButton.click()

    // Should have start control
    const startButton = page.getByRole('button', { name: /Start/i })
    await expect(startButton).toBeVisible({ timeout: 5000 })
  })

  test('should display recipe settings', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const pourOverButton = page.getByRole('button', { name: /Pour-over/i })
    await expect(pourOverButton).toBeVisible({ timeout: 5000 })
    await pourOverButton.click()

    // Should show settings or recipe section
    await page.waitForTimeout(1000)
    const content = page.locator('h2, h3, label, input')
    await expect(content.first()).toBeVisible({ timeout: 5000 })
  })

  test('should allow navigation back', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const pourOverButton = page.getByRole('button', { name: /Pour-over/i })
    await expect(pourOverButton).toBeVisible({ timeout: 5000 })
    await pourOverButton.click()

    // Click logo to go back
    await page.locator('text=MeticAI').first().click()

    // Should be back on start view
    await expect(page.getByRole('button', { name: /Profile Catalogue/i })).toBeVisible({ timeout: 5000 })
  })
})
