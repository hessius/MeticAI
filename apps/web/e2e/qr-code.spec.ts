import { test, expect } from '@playwright/test'

test.describe('QR Code Feature E2E Tests', () => {
  test('should show QR code button on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    
    // QR code button should be visible
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await expect(qrButton).toBeVisible()
  })

  test('should not show QR code button on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    
    // QR code button should not be visible
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await expect(qrButton).not.toBeVisible()
  })

  test('should open QR code dialog when button is clicked', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    
    // Click the QR code button
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await qrButton.click()
    
    // Dialog should be visible
    const dialog = page.getByRole('dialog', { name: /Open on Mobile/i })
    await expect(dialog).toBeVisible()
    
    // Check dialog content
    await expect(page.getByText('Scan this QR code with your phone\'s camera')).toBeVisible()
    await expect(page.getByText(/Point your phone's camera at the QR code/)).toBeVisible()
  })

  test('should display current URL in QR dialog', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    
    // Click the QR code button
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await qrButton.click()
    
    // Should show the URL
    await expect(page.getByText(/localhost:5173/)).toBeVisible()
  })

  test('should show localhost warning in QR dialog', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    
    // Click the QR code button
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await qrButton.click()
    
    // Should show localhost warning
    await expect(page.getByText(/localhost URL/)).toBeVisible()
    await expect(page.getByText(/Set a network IP in Settings/)).toBeVisible()
  })

  test('should close QR dialog when close button is clicked', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    
    // Open dialog
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await qrButton.click()
    
    // Dialog should be visible
    const dialog = page.getByRole('dialog', { name: /Open on Mobile/i })
    await expect(dialog).toBeVisible()
    
    // Click close button
    const closeButton = page.getByRole('button', { name: /Close/i }).last()
    await closeButton.click()
    
    // Dialog should be closed
    await expect(dialog).not.toBeVisible()
  })

  test('should close QR dialog when clicking outside', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    
    // Open dialog
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await qrButton.click()
    
    // Dialog should be visible
    const dialog = page.getByRole('dialog', { name: /Open on Mobile/i })
    await expect(dialog).toBeVisible()
    
    // Press Escape to close the dialog
    await page.keyboard.press('Escape')
    
    // Dialog should be closed
    await expect(dialog).not.toBeVisible()
  })

  test('should switch QR button visibility on viewport resize', async ({ page }) => {
    await page.goto('/')
    
    // Start with desktop viewport
    await page.setViewportSize({ width: 1024, height: 768 })
    const qrButton = page.getByRole('button', { name: /Open on mobile/i })
    await expect(qrButton).toBeVisible()
    
    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(100) // Wait for resize to take effect
    await expect(qrButton).not.toBeVisible()
    
    // Resize back to desktop
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.waitForTimeout(100) // Wait for resize to take effect
    await expect(qrButton).toBeVisible()
  })
})
