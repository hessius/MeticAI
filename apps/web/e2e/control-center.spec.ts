import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Control Center
 *
 * Tests:
 * - Control center visibility
 * - Machine control buttons (Start, Preheat, Tare)
 */

// Only run when BASE_URL is explicitly set to Docker container
const BASE_URL_SET = !!process.env.BASE_URL
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const needsDocker = BASE_URL_SET && BASE.includes('3550')

test.describe('Control Center', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    await page.waitForLoadState('networkidle')
  })

  test('should display control center buttons', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Control center shows Start, Preheat, Tare buttons
    const startButton = page.getByRole('button', { name: /Start/i })
    await expect(startButton).toBeVisible({ timeout: 5000 })
  })

  test('should have tare button', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const tareButton = page.getByRole('button', { name: /Tare/i })
    await expect(tareButton).toBeVisible({ timeout: 5000 })
    await expect(tareButton).toBeEnabled()
  })

  test('should have preheat button', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const preheatButton = page.getByRole('button', { name: /Preheat/i })
    await expect(preheatButton).toBeVisible({ timeout: 5000 })
  })

  test('should have show all button', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    const showAllButton = page.getByRole('button', { name: /Show all/i })
    await expect(showAllButton).toBeVisible({ timeout: 5000 })
  })
})
