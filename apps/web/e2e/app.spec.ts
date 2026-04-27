import { test, expect } from '@playwright/test'
import { navigateToForm, isAiAvailableInForm } from './helpers'

/**
 * E2E Tests for Metic Web Application
 *
 * Note: Tests that require the "Generate Profile" submit button to be enabled
 * will be skipped when AI features are unavailable (no API key configured in CI).
 */

test.describe('Metic Web Application E2E Tests', () => {
  test('should load the homepage successfully', async ({ page }) => {
    await page.goto('/')
    
    // Check that the page loaded with correct title
    await expect(page).toHaveTitle('Metic.')
    
    // Check for the application title
    await expect(page.getByRole('heading', { name: /Metic/ })).toBeVisible()
  })

  test('should display form elements', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Add Profile')
    
    await navigateToForm(page)
    
    // Now check for form elements
    // Check for file upload area
    await expect(page.getByText(/Tap to upload or take photo/)).toBeVisible()
    
    // Check for textarea
    await expect(page.getByPlaceholder(/Balanced extraction/)).toBeVisible()
    
    // Check for tags
    await expect(page.getByText('Light Body')).toBeVisible()
    await expect(page.getByText('Florals')).toBeVisible()
    
    // Check for submit button (should be disabled initially)
    const submitButton = page.getByRole('button', { name: /Generate Profile/i })
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toBeDisabled()
  })

  test('should enable submit button when text is entered', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Add Profile')
    
    await navigateToForm(page)
    
    // Skip test if AI is unavailable (submit button won't enable)
    if (!(await isAiAvailableInForm(page))) {
      test.skip()
      return
    }
    
    const textarea = page.getByPlaceholder(/Balanced extraction/)
    const submitButton = page.getByRole('button', { name: /Generate Profile/i })
    
    // Initially disabled
    await expect(submitButton).toBeDisabled()
    
    // Type something
    await textarea.fill('Fruity notes with bright acidity')
    
    // Should be enabled
    await expect(submitButton).toBeEnabled()
  })

  test('should enable submit button when a tag is selected', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Add Profile')
    
    await navigateToForm(page)
    
    // Skip test if AI is unavailable
    if (!(await isAiAvailableInForm(page))) {
      test.skip()
      return
    }
    
    const submitButton = page.getByRole('button', { name: /Generate Profile/i })
    
    // Initially disabled
    await expect(submitButton).toBeDisabled()
    
    // Click a tag
    await page.getByText('Light Body').first().click()
    
    // Should be enabled
    await expect(submitButton).toBeEnabled()
  })

  test('should allow selecting multiple tags', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Add Profile')
    
    await navigateToForm(page)
    
    // Select multiple tags
    await page.getByText('Light Body').first().click()
    await page.getByText('Florals').first().click()
    await page.getByText('Chocolate').first().click()
    
    // All selected tags should use selected style classes
    await expect(page.locator('[data-slot="badge"]:has-text("Light Body")')).toHaveClass(/shadow-sm/)
    await expect(page.locator('[data-slot="badge"]:has-text("Florals")')).toHaveClass(/shadow-sm/)
    await expect(page.locator('[data-slot="badge"]:has-text("Chocolate")')).toHaveClass(/shadow-sm/)
  })

  test('should be able to deselect tags', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Add Profile')
    
    await navigateToForm(page)
    
    const lightBodyTag = page.locator('[data-slot="badge"]:has-text("Light Body")')
    
    // Select
    await lightBodyTag.click()
    await expect(lightBodyTag).toHaveClass(/shadow-sm/)
    
    // Deselect
    await lightBodyTag.click()
    await expect(lightBodyTag).not.toHaveClass(/shadow-sm/)
  })

  test('should have responsive design', async ({ page }) => {
    await page.goto('/')
    
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect(page.getByRole('heading', { name: /Metic/ })).toBeVisible()
    
    // Navigate to form
    await page.waitForSelector('text=Add Profile')
    await navigateToForm(page)
    
    // Test mobile view — header h1 is only on start view, check form heading instead
    await page.setViewportSize({ width: 375, height: 667 })
    await expect(page.getByText(/New Profile/)).toBeVisible()
    await expect(page.getByPlaceholder(/Balanced extraction/)).toBeVisible()
  })

  test('should show form validation', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Add Profile')
    
    await navigateToForm(page)
    
    // Skip test if AI is unavailable
    if (!(await isAiAvailableInForm(page))) {
      test.skip()
      return
    }
    
    const submitButton = page.getByRole('button', { name: /Generate Profile/i })
    
    // Button should be disabled when form is empty
    await expect(submitButton).toBeDisabled()
    
    // Enter text, then clear it
    const textarea = page.getByPlaceholder(/Balanced extraction/)
    await textarea.fill('test')
    await expect(submitButton).toBeEnabled()
    
    await textarea.clear()
    await expect(submitButton).toBeDisabled()
  })
})

test.describe('User Flows', () => {
  test('complete coffee preference submission flow', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Add Profile')
    
    await navigateToForm(page)
    
    // Skip test if AI is unavailable
    if (!(await isAiAvailableInForm(page))) {
      test.skip()
      return
    }
    
    // Fill in preferences
    await page.getByPlaceholder(/Balanced extraction/).fill('I prefer fruity and bright espresso with floral notes')
    
    // Select some tags
    await page.getByText('Light Body').first().click()
    await page.getByText('Florals').first().click()
    await page.getByText('Acidity').first().click()
    
    // Verify submit button is enabled
    const submitButton = page.getByRole('button', { name: /Generate Profile/i })
    await expect(submitButton).toBeEnabled()
    
    // Note: We don't actually submit as there's no backend in test environment
  })
})
