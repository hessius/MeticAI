import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Shot Scheduling and Run View
 *
 * Tests:
 * - Run/Schedule view navigation
 * - Profile selection
 * - Scheduling options
 */

// Only run full tests when BASE_URL is explicitly set to Docker container
const BASE_URL_SET = !!process.env.BASE_URL
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const needsDocker = BASE_URL_SET && BASE.includes('3550')

test.describe('Run / Schedule View', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    await page.waitForLoadState('networkidle')
  })

  test('should access run schedule view', async ({ page }) => {
    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Should show Run / Schedule heading
    await expect(page.getByText('Run / Schedule')).toBeVisible({ timeout: 5000 })
  })

  test('should display scheduling options', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Should show Options and Recurring Schedules sections
    await expect(page.getByText('Options')).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'Recurring Schedules' })).toBeVisible({ timeout: 5000 })
  })

  test('should have profile selection button', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Should have Select Profile button
    await expect(page.getByRole('button', { name: /Select Profile/i })).toBeVisible({ timeout: 5000 })
  })

  test('should have Run Now button', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Should have Run Now button
    await expect(page.getByRole('button', { name: /Run Now/i })).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Shot Scheduling - Recurring', () => {
  test.use({ baseURL: BASE })

  test('should show add schedule button', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    await page.waitForLoadState('networkidle')

    const runShotButton = page.getByRole('button', { name: /Run.*Schedule/i })
    await expect(runShotButton).toBeVisible({ timeout: 5000 })
    await runShotButton.click()

    // Should have Add button for recurring schedules
    await expect(page.getByRole('button', { name: /Add/i })).toBeVisible({ timeout: 5000 })
  })
})
