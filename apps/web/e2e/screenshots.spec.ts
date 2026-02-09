import { test } from '@playwright/test';

const languages = [
  { code: 'en', name: 'English' },
  { code: 'sv', name: 'Svenska' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
];

test.describe('Screenshot Generation', () => {
  for (const lang of languages) {
    test(`Home view - ${lang.name}`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('text=MeticAI');
      
      // Select language
      if (lang.code !== 'en') {
        await page.click('[aria-label*="language"], [aria-label*="Language"]').catch(() => {});
        await page.getByText(lang.name).click().catch(() => {});
        await page.waitForTimeout(500);
      }
      
      await page.screenshot({
        path: `screenshots/home_${lang.code}.png`,
        fullPage: true,
      });
    });
  }
});
