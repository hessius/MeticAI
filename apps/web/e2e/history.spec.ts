import { test, expect } from '@playwright/test'

/**
 * E2E Tests for History View and Profile Import
 *
 * Tests:
 * - Navigation to history
 * - Viewing analysis history
 * - Profile list from machine
 * - Profile import functionality
 */

test.describe('History View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
  })

  test('should navigate to history page', async ({ page }) => {
    // Look for history button
    const historyButton = page.getByRole('button', { name: /View History|History/i })
    
    // Skip if button not visible (AI not configured)
    if (!(await historyButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await historyButton.click()

    // Should show history view
    await expect(page.getByText(/History|Analysis History|Generated Profiles/i)).toBeVisible()
  })

  test('should display empty state when no history', async ({ page }) => {
    // Navigate to history
    const historyButton = page.getByRole('button', { name: /View History|History/i })
    
    if (!(await historyButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await historyButton.click()

    // Should show either entries or empty state
    const historyContent = page.locator('[data-testid="history-list"], text=/No.*history|Start by/i')
    await expect(historyContent.first()).toBeVisible({ timeout: 5000 })
  })

  test('should allow navigation back from history', async ({ page }) => {
    // Navigate to history
    const historyButton = page.getByRole('button', { name: /View History|History/i })
    
    if (!(await historyButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await historyButton.click()
    
    // Click logo to go back
    await page.locator('text=MeticAI').first().click()

    // Should be back on start view
    await expect(page.getByRole('button', { name: /Generate New Profile/i })).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Profile Import from Machine', () => {
  // These tests require a running backend with machine connection
  const needsBackend = process.env.BASE_URL?.includes('3550') || false

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
  })

  test('should display profiles section in history when machine connected', async ({ page }) => {
    if (!needsBackend) {
      test.skip()
      return
    }

    // Navigate to history
    const historyButton = page.getByRole('button', { name: /View History|History/i })
    
    if (!(await historyButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await historyButton.click()

    // Look for machine profiles section
    const profilesSection = page.getByText(/Machine Profiles|Profiles on Machine/i)
    await expect(profilesSection).toBeVisible({ timeout: 5000 })
  })

  test('should list profiles from machine when connected', async ({ page }) => {
    if (!needsBackend) {
      test.skip()
      return
    }

    // Navigate to history
    const historyButton = page.getByRole('button', { name: /View History|History/i })
    
    if (!(await historyButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip()
      return
    }

    await historyButton.click()

    // Wait for profiles to load
    await page.waitForTimeout(2000)

    // Should have at least one profile card or empty state
    const profileCards = page.locator('[data-testid="profile-card"], .profile-item, text=/No profiles/i')
    await expect(profileCards.first()).toBeVisible({ timeout: 5000 })
  })
})
