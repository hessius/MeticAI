# Screenshots - MeticAI Web Application

This directory contains screenshots of the MeticAI web application in all supported languages.

## Screenshots Generated

Due to the requirement for a running backend server to capture all application states, screenshots can be generated using the Playwright script:

```bash
npm run dev  # Start dev server
npm run e2e -- e2e/screenshots.spec.ts  # Generate screenshots
```

## Expected Screenshots

The following screenshots should be captured for each of the 6 languages (EN, SV, ES, IT, FR, DE):

1. **home_[lang].png** - Start/home view with greeting and action buttons
2. **form_[lang].png** - Profile creation form
3. **loading_[lang].png** - Loading screen with messages
4. **results_[lang].png** - Generated profile results
5. **history_[lang].png** - Profile catalogue
6. **settings_[lang].png** - Settings view

Total: 36 screenshots (6 views × 6 languages)

## Implementation Note

Screenshots require the MeticAI backend server to be running for full functionality. The screenshot script is provided in `e2e/screenshots.spec.ts` for automated capture when the full environment is available.

## Manual Screenshots

For manual screenshot capture, see `SCREENSHOT_GUIDE.md` in the root directory for detailed instructions.
