import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Live Shot / Run Shot View
 *
 * Tests the Run / Schedule view and live shot monitoring:
 * - Navigation to run shot view
 * - Profile selection
 * - Start button availability
 */

// Only run when BASE_URL is explicitly set to Docker container
const BASE_URL_SET = !!process.env.BASE_URL
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const needsDocker = BASE_URL_SET && BASE.includes('3550')

test.describe('Live Shot View', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    await page.waitForLoadState('networkidle')
  })

  test('should navigate to run shot view', async ({ page }) => {
    // Navigate to Run / Schedule
    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Verify we're in the run shot view
    await expect(page.getByText('Run / Schedule')).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Run Shot View - Profile Selection', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    await page.waitForLoadState('networkidle')
  })

  test('should display profile selector', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Should have profile selection
    const selectProfile = page.getByRole('button', { name: /Select Profile/i })
    await expect(selectProfile).toBeVisible({ timeout: 5000 })
  })

  test('should show run now button', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Should have Run Now button
    const runNowButton = page.getByRole('button', { name: /Run Now/i })
    await expect(runNowButton).toBeVisible({ timeout: 5000 })
  })

  test('should navigate back to start', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Click logo to go back
    await page.locator('text=MeticAI').first().click()

    // Should be back on start
    await expect(page.getByRole('button', { name: /Profile Catalogue/i })).toBeVisible({ timeout: 5000 })
  })
})
