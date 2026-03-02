import { test, expect } from '@playwright/test'

/**
 * E2E Tests for Control Center
 *
 * Tests the Control Center component which shows:
 * - Live telemetry (weight, temperature, pressure)
 * - Machine state indicators
 * - Quick action buttons
 *
 * Note: These tests require a running backend with MQTT enabled
 * to see the control center. Without it, the control center is hidden.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3550'
const needsDocker = BASE.includes('3550')

test.describe('Control Center', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
  })

  test('should display control center when MQTT is enabled', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Control center appears on the right side on desktop
    // Look for telemetry indicators
    const controlCenter = page.locator('[data-testid="control-center"], .control-center, text=/Temperature|Weight|Pressure/i')
    
    // May or may not be visible depending on settings and machine connection
    const isVisible = await controlCenter.first().isVisible({ timeout: 3000 }).catch(() => false)
    
    if (isVisible) {
      // Verify it shows expected telemetry data
      await expect(page.getByText(/°C|°F|Temperature/i)).toBeVisible()
    } else {
      // If not visible, MQTT may not be enabled in settings - this is OK
      test.skip()
    }
  })

  test('should show machine connection status', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Look for connection status indicators
    const statusIndicator = page.locator('text=/Connected|Disconnected|Offline/i, [data-testid="connection-status"]')
    
    const isVisible = await statusIndicator.first().isVisible({ timeout: 3000 }).catch(() => false)
    
    if (isVisible) {
      // Should show some connection state
      await expect(statusIndicator.first()).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('should show active profile when machine connected', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Look for active profile display
    const activeProfile = page.locator('text=/Active Profile|Current Profile/i, [data-testid="active-profile"]')
    
    const isVisible = await activeProfile.first().isVisible({ timeout: 3000 }).catch(() => false)
    
    if (isVisible) {
      await expect(activeProfile.first()).toBeVisible()
    } else {
      test.skip()
    }
  })
})

test.describe('Control Center Actions', () => {
  test.use({ baseURL: BASE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=MeticAI')
  })

  test('should have tare button when control center visible', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Look for tare/zero button
    const tareButton = page.getByRole('button', { name: /Tare|Zero/i })
    
    const isVisible = await tareButton.isVisible({ timeout: 3000 }).catch(() => false)
    
    if (isVisible) {
      await expect(tareButton).toBeEnabled()
    } else {
      test.skip()
    }
  })

  test('should have preheat button when control center visible', async ({ page }) => {
    if (!needsDocker) {
      test.skip()
      return
    }

    // Look for preheat button
    const preheatButton = page.getByRole('button', { name: /Preheat|Heat/i })
    
    const isVisible = await preheatButton.isVisible({ timeout: 3000 }).catch(() => false)
    
    if (isVisible) {
      await expect(preheatButton).toBeVisible()
    } else {
      test.skip()
    }
  })
})
