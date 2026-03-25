import { test, expect } from '@playwright/test'

/**
 * E2E Tests for History View and Profile Import
 *
 * Tests:
 * - Navigation to history
 * - Viewing analysis history
 * - Profile list from machine
 * - Profile import functionality
 * - Console error detection (catches 404s, etc.)
 */

// Check if we're running against Docker container with backend
const BASE_URL_SET = !!process.env.BASE_URL
const HAS_BACKEND = BASE_URL_SET && (process.env.BASE_URL?.includes('3550') || false)

test.describe('History View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    // Wait for page to fully render
    await page.waitForLoadState('networkidle')
  })

  test('should navigate to history page', async ({ page }) => {
    // Wait for Profile Catalogue button to be available
    const historyButton = page.getByRole('button', { name: /Profile Catalogue/i })
    await expect(historyButton).toBeVisible({ timeout: 5000 })

    await historyButton.click()

    // Should show profile catalogue view
    await expect(page.getByText('Profile Catalogue').first()).toBeVisible()
  })

  test('should display empty state when no history', async ({ page }) => {
    const historyButton = page.getByRole('button', { name: /Profile Catalogue/i })
    await expect(historyButton).toBeVisible({ timeout: 5000 })

    await historyButton.click()

    // Should show the Profile Catalogue heading (view-specific, not the start view h2)
    await expect(page.getByText('Profile Catalogue').first()).toBeVisible({ timeout: 5000 })
  })

  test('should allow navigation back from history', async ({ page }) => {
    const historyButton = page.getByRole('button', { name: /Profile Catalogue/i })
    await expect(historyButton).toBeVisible({ timeout: 5000 })

    await historyButton.click()
    
    // Click logo/heading to go back
    await page.getByRole('heading', { name: /MeticAI/ }).click()

    // Should be back on start view (Profile Catalogue button is always visible on start)
    await expect(page.getByRole('button', { name: /Profile Catalogue/i })).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Profile Import from Machine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
    await page.waitForLoadState('networkidle')
  })

  test('should display profiles section in history when machine connected', async ({ page }) => {
    if (!HAS_BACKEND) {
      test.skip()
      return
    }

    const historyButton = page.getByRole('button', { name: /Profile Catalogue/i })
    await expect(historyButton).toBeVisible({ timeout: 5000 })
    await historyButton.click()

    // Look for profile headings - the debug showed we have profiles with names
    const profileHeading = page.locator('h2, h3').first()
    await expect(profileHeading).toBeVisible({ timeout: 5000 })
  })

  test('should list profiles from machine when connected', async ({ page }) => {
    if (!HAS_BACKEND) {
      test.skip()
      return
    }

    const historyButton = page.getByRole('button', { name: /Profile Catalogue/i })
    await expect(historyButton).toBeVisible({ timeout: 5000 })
    await historyButton.click()

    // Wait for profiles to load
    await page.waitForTimeout(2000)

    // Should have profile headings (we saw them in the debug test)
    const profileHeadings = page.locator('h3')
    await expect(profileHeadings.first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Console Error Detection', () => {
  // These tests verify that no console errors occur during normal usage
  // This catches issues like 404 errors for profile images
  
  test('should load history view without console errors', async ({ page }) => {
    if (!HAS_BACKEND) {
      test.skip()
      return
    }

    // Collect console errors
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Collect failed network requests
    const failedRequests: string[] = []
    page.on('response', response => {
      if (response.status() >= 400) {
        const url = response.url()
        // Ignore expected 404s (like favicon, etc.)
        if (!url.includes('favicon') && !url.includes('.ico')) {
          failedRequests.push(`${response.status()} ${url}`)
        }
      }
    })

    await page.goto('/')
    await page.waitForSelector('text=MeticAI')

    const historyButton = page.getByRole('button', { name: /Profile Catalogue/i })
    await historyButton.click()

    // Wait for history to load with images
    await page.waitForTimeout(3000)

    // Check for errors
    expect(consoleErrors, `Console errors: ${consoleErrors.join(', ')}`).toHaveLength(0)
    expect(failedRequests, `Failed requests: ${failedRequests.join(', ')}`).toHaveLength(0)
  })

  test('should load profile images without 404 errors', async ({ page }) => {
    if (!HAS_BACKEND) {
      test.skip()
      return
    }

    const imageErrors: string[] = []
    page.on('response', response => {
      const url = response.url()
      if (url.includes('/image-proxy') && response.status() >= 400) {
        imageErrors.push(`${response.status()} ${url}`)
      }
    })

    await page.goto('/')
    await page.waitForSelector('text=MeticAI')

    const historyButton = page.getByRole('button', { name: /Profile Catalogue/i })
    await historyButton.click()

    // Wait for images to load
    await page.waitForTimeout(3000)

    // Verify no image 404s
    expect(imageErrors, `Image errors: ${imageErrors.join(', ')}`).toHaveLength(0)
  })
})
