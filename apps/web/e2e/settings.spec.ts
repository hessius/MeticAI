import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Settings View
 *
 * Tests the settings page functionality including:
 * - Navigation to settings
 * - Configuration fields (API key, machine IP)
 * - Beta channel toggle (when available)
 * - About section
 */

test.describe('Settings View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for app to initialize
    await page.waitForSelector('text=MeticAI')
  })

  test('should navigate to settings page', async ({ page }) => {
    // Click settings button - it has text "Settings"  
    const settingsButton = page.getByRole('button', { name: /^Settings$/i })
    await settingsButton.click()

    // Verify settings view loaded - should show configuration section
    await expect(page.getByText(/Configuration/i)).toBeVisible({ timeout: 5000 })
  })

  test('should display configuration section', async ({ page }) => {
    // Navigate to settings
    const settingsButton = page.getByRole('button', { name: /^Settings$/i })
    await settingsButton.click()

    // Wait for page to load and scroll to ensure Configuration section is visible
    await page.waitForTimeout(500)
    
    // Configuration section should be present (may need scrolling)
    const configSection = page.getByText('Configuration')
    await expect(configSection).toBeVisible({ timeout: 5000 })
  })

  test('should display about section', async ({ page }) => {
    // Navigate to settings
    const settingsButton = page.getByRole('button', { name: /^Settings$/i })
    await settingsButton.click()

    // Check for about section
    await expect(page.getByText(/About MeticAI/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/GitHub/i)).toBeVisible({ timeout: 5000 })
  })

  test('should display version information', async ({ page }) => {
    // Navigate to settings
    const settingsButton = page.getByRole('button', { name: /^Settings$/i })
    await settingsButton.click()

    // Version Info section should be visible
    await expect(page.getByText('Version Info')).toBeVisible({ timeout: 5000 })
  })

  test('should allow saving settings', async ({ page }) => {
    // Navigate to settings
    const settingsButton = page.getByRole('button', { name: /^Settings$/i })
    await settingsButton.click()

    // Find a save button
    const saveButton = page.getByRole('button', { name: /Save/i })
    await expect(saveButton).toBeVisible({ timeout: 5000 })
  })

  test('should navigate back from settings', async ({ page }) => {
    // Navigate to settings
    const settingsButton = page.getByRole('button', { name: /^Settings$/i })
    await settingsButton.click()

    // Verify we're in settings
    await expect(page.getByText(/Configuration/i)).toBeVisible({ timeout: 5000 })

    // Click the MeticAI title/logo to go home
    await page.locator('h1:has-text("MeticAI")').click()

    // Should be back on home - look for Settings button again
    await expect(page.getByRole('button', { name: /^Settings$/i })).toBeVisible({ timeout: 5000 })
  })
})
