import { test, expect } from '@playwright/test'

/**
 * E2E Tests for MeticAI Web Application
 *
 * Note: Tests that require the "Generate New Profile" button will be skipped
 * when AI features are unavailable (no API key configured in CI).
 */

test.describe('MeticAI Web Application E2E Tests', () => {
  test('should load the homepage successfully', async ({ page }) => {
    await page.goto('/')
    
    // Check that the page loaded with correct title
    await expect(page).toHaveTitle('MeticAI - Espresso Profile Generator')
    
    // Check for the application title
    await expect(page.getByRole('heading', { name: /MeticAI/ })).toBeVisible()
  })

  test('should display form elements', async ({ page }) => {
    await page.goto('/')
    
    // Wait for the app to load and click "Generate New Profile" to access the form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
    // Now check for form elements
    // Check for file upload area
    await expect(page.getByText(/Tap to upload or take photo/)).toBeVisible()
    
    // Check for textarea - use partial match since placeholder includes "e.g., " prefix and "..." suffix
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
    
    // Navigate to form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
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
    
    // Navigate to form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
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
    
    // Navigate to form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
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
    
    // Navigate to form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
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
    await expect(page.getByRole('heading', { name: /MeticAI/ })).toBeVisible()
    
    // Navigate to form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 })
    await expect(page.getByRole('heading', { name: /MeticAI/ })).toBeVisible()
    await expect(page.getByPlaceholder(/Balanced extraction/)).toBeVisible()
  })

  test('should show form validation', async ({ page }) => {
    await page.goto('/')
    
    // Navigate to form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
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
    
    // Navigate to form
    await page.waitForSelector('text=Generate New Profile')
    const generateButton = page.getByRole('button', { name: /Generate New Profile/i })
    
    // Skip test if button is disabled (AI unavailable in CI)
    if (await generateButton.isDisabled()) {
      test.skip()
      return
    }
    
    await generateButton.click()
    
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
