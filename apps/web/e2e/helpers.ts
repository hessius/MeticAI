import type { Page } from '@playwright/test'

/**
 * Navigate from the start view to the profile creation form.
 *
 * In v2.4.0 the flow is:
 *   Start → click "Add Profile" → ProfileImportDialog opens
 *         → click "Generate New Profile" inside the dialog → FormView
 */
export async function navigateToForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Add Profile/i }).click()
  await page.getByRole('button', { name: /Generate New Profile/i }).click()
  await page.waitForSelector('text=New Profile')
}

/**
 * Check whether AI-dependent form submission is available.
 * Returns true if the "Generate Profile" button becomes enabled after input.
 * Must be called AFTER navigateToForm().
 */
export async function isAiAvailableInForm(page: Page): Promise<boolean> {
  const textarea = page.getByPlaceholder(/Balanced extraction/i)
  const submitButton = page.getByRole('button', { name: /Generate Profile/i })
  await textarea.fill('test probe')
  const enabled = await submitButton.isEnabled()
  await textarea.clear()
  return enabled
}
