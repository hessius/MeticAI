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
    test(`Home view - ${lang.name}`, async ({ page }, testInfo) => {
      // Set the language via localStorage before navigating so i18next picks it up
      await page.addInitScript((langCode) => {
        localStorage.setItem('meticai-language', langCode);
      }, lang.code);

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('text=MeticAI');

      // Allow i18n to settle after page load
      await page.waitForTimeout(500);

      await page.screenshot({
        path: testInfo.outputPath(`home_${lang.code}.png`),
        fullPage: true,
      });
    });
  }
});
