import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Pour-Over Mode
 *
 * These tests require a running MeticAI container (localhost:3550).
 * They are skipped in CI unless BASE_URL is explicitly set.
 *
 * Tests:
 * - Navigation to pour-over
 * - Timer controls
 * - View elements
 */

const BASE = process.env.BASE_URL || 'http://localhost:3550'
// These tests need a running server — skip when none is configured
const serverAvailable = !!process.env.BASE_URL

test.describe('Pour-Over View', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    test.skip(!serverAvailable, 'Requires running MeticAI server (set BASE_URL)')
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
    const pourOverButton = page.getByRole('button', { name: /Pour-over/i })
    await expect(pourOverButton).toBeVisible({ timeout: 5000 })
    await pourOverButton.click()

    // Should have start control
    const startButton = page.getByRole('button', { name: /Start/i })
    await expect(startButton).toBeVisible({ timeout: 5000 })
  })

  test('should display recipe settings', async ({ page }) => {
    const pourOverButton = page.getByRole('button', { name: /Pour-over/i })
    await expect(pourOverButton).toBeVisible({ timeout: 5000 })
    await pourOverButton.click()

    // Should show settings or recipe section
    await page.waitForTimeout(1000)
    const content = page.locator('h2, h3, label, input')
    await expect(content.first()).toBeVisible({ timeout: 5000 })
  })

  test('should allow navigation back', async ({ page }) => {
    const pourOverButton = page.getByRole('button', { name: /Pour-over/i })
    await expect(pourOverButton).toBeVisible({ timeout: 5000 })
    await pourOverButton.click()

    // Click logo to go back
    await page.locator('text=MeticAI').first().click()

    // Should be back on start view
    await expect(page.getByRole('button', { name: /Profile Catalogue/i })).toBeVisible({ timeout: 5000 })
  })
})
