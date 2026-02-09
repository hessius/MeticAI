# 📸 Screenshot Guide for MeticAI-Web Refactoring

## Overview
This guide provides step-by-step instructions for capturing screenshots of the MeticAI-web application in all supported languages to demonstrate the comprehensive refactoring improvements.

---

## Prerequisites

1. **Start the development server**:
   ```bash
   cd /home/runner/work/MeticAI-web/MeticAI-web
   npm install
   npm run dev
   ```

2. **Open browser**: Navigate to `http://localhost:5173`

3. **Ensure backend is running**: The app requires the MeticAI backend server for full functionality

---

## Screenshot Checklist

### 🏠 View 1: Start Screen / Home Page

**What to capture**:
- MeticAI logo and branding
- Time-based greeting (Good morning/afternoon/evening)
- "Get Started" button
- Language selector (Globe icon) in header
- Profile count display

**Languages to capture**: All 6 (EN, SV, ES, IT, FR, DE)

**Steps**:
1. Click language selector (Globe icon)
2. Select language
3. Verify greeting text changes
4. Take screenshot
5. Save as: `1_home_{language}.png` (e.g., `1_home_en.png`)

**Files**:
- `1_home_en.png` - English
- `1_home_sv.png` - Swedish (Svenska)
- `1_home_es.png` - Spanish (Español)
- `1_home_it.png` - Italian (Italiano)
- `1_home_fr.png` - French (Français)
- `1_home_de.png` - German (Deutsch)

---

### 📝 View 2: Form View (Profile Creation)

**What to capture**:
- Image upload area with "Upload coffee bag image" text
- Preferences textarea with placeholder
- Tag selection (preset tags like "Fruity", "Chocolate", "Bright")
- Advanced customization section (collapsed/expanded)
- "Create Profile" button

**Languages to capture**: All 6

**Steps**:
1. Click "Get Started" or navigate to form view
2. Switch language
3. Verify all form labels, placeholders, and button text change
4. Take screenshot
5. Save as: `2_form_{language}.png`

**Files**:
- `2_form_en.png` through `2_form_de.png` (6 files)

---

### ⏳ View 3: Loading Screen

**What to capture**:
- Loading spinner/animation
- Coffee-themed loading message (e.g., "Analyzing coffee beans...", "Watching a Lance video...")
- Progress indicator

**Languages to capture**: All 6

**Steps**:
1. Submit a profile creation (upload image + preferences)
2. Quickly capture loading screen
3. Note: Loading messages rotate, try to capture different ones
4. Save as: `3_loading_{language}.png`

**Files**:
- `3_loading_en.png` through `3_loading_de.png` (6 files)

**Tip**: Loading screen appears for a few seconds. Have screenshot tool ready!

---

### ✅ View 4: Results View (Generated Profile)

**What to capture**:
- Generated profile name
- AI analysis text
- Profile breakdown (stages, parameters)
- Action buttons ("Save to History", "Download JSON", "Run Shot")

**Languages to capture**: All 6

**Steps**:
1. After profile generation completes
2. Switch language
3. Verify all text translates
4. Take screenshot showing full results
5. Save as: `4_results_{language}.png`

**Files**:
- `4_results_en.png` through `4_results_de.png` (6 files)

---

### 📚 View 5: History View (Profile Catalogue)

**What to capture**:
- Grid of saved profiles with thumbnails
- Search bar
- Filter tags
- "Load More" button
- Profile count indicator

**Languages to capture**: All 6

**Steps**:
1. Click "History" navigation button
2. Switch language
3. Verify search placeholder, filter labels, button text
4. Take screenshot
5. Save as: `5_history_{language}.png`

**Files**:
- `5_history_en.png` through `5_history_de.png` (6 files)

---

### 🔍 View 6: Profile Detail View

**What to capture**:
- Full profile information
- Profile name and metadata
- Stage-by-stage breakdown
- Temperature, pressure, flow parameters
- Actions (Edit, Delete, Download, Run)

**Languages to capture**: All 6

**Steps**:
1. From History view, click on a profile
2. Switch language
3. Verify all labels and button text
4. Take screenshot
5. Save as: `6_profile_detail_{language}.png`

**Files**:
- `6_profile_detail_en.png` through `6_profile_detail_de.png` (6 files)

---

### ⚙️ View 7: Settings View

**What to capture**:
- Server configuration
- Theme selector (if visible)
- Export/Import section
- System information
- Language selector (showing all 6 languages)

**Languages to capture**: All 6

**Steps**:
1. Click "Settings" gear icon
2. Switch language
3. Verify section headers, labels, button text
4. Take screenshot
5. Save as: `7_settings_{language}.png`

**Files**:
- `7_settings_en.png` through `7_settings_de.png` (6 files)

---

### ♿ View 8: Accessibility Features

**What to capture**:
- Skip navigation link (press Tab to reveal)
- Focus indicator on buttons (outline ring)
- Language selector dropdown (expanded showing all languages)

**Languages to capture**: English only (1 screenshot)

**Steps**:
1. Press Tab key to reveal skip navigation link
2. Take screenshot showing "Skip to main content"
3. Tab through elements to show focus indicators
4. Take screenshot of focused button
5. Click language selector to show dropdown
6. Take screenshot of language menu

**Files**:
- `8_accessibility_skip_nav.png` - Skip navigation
- `8_accessibility_focus.png` - Focus indicator
- `8_accessibility_language_menu.png` - Language dropdown

---

### 🎨 Bonus: Demo Page (Optional)

**What to capture**:
- RefactoringDemo component showcasing all features
- Feature cards (i18n, Accessibility, Type Safety, Architecture)
- Interactive demo section
- Technical details

**Languages to capture**: All 6

**Note**: This requires adding the demo component to a route. If not integrated, skip this.

---

## Automated Screenshot Script (Optional)

For automated screenshot capture, use Playwright:

```typescript
// scripts/take-screenshots.spec.ts
import { test, expect } from '@playwright/test';

const languages = [
  { code: 'en', name: 'English' },
  { code: 'sv', name: 'Svenska' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
];

const views = [
  { name: 'home', path: '/' },
  { name: 'form', action: 'click-get-started' },
  { name: 'history', action: 'click-history' },
  { name: 'settings', action: 'click-settings' },
];

for (const lang of languages) {
  for (const view of views) {
    test(`Screenshot ${view.name} in ${lang.code}`, async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      // Wait for app to load
      await page.waitForLoadState('networkidle');
      
      // Select language
      await page.click('[aria-label*="Language"]');
      await page.click(`text="${lang.name}"`);
      await page.waitForTimeout(500); // Wait for translations to load
      
      // Navigate to view
      if (view.action === 'click-get-started') {
        await page.click('text=/Get Started|Kom igång|Comenzar|Inizia|Commencer|Jetzt starten/');
      } else if (view.action === 'click-history') {
        await page.click('[aria-label*="History"]');
      } else if (view.action === 'click-settings') {
        await page.click('[aria-label*="Settings"]');
      }
      
      await page.waitForTimeout(500);
      
      // Take screenshot
      await page.screenshot({
        path: `screenshots/${view.name}_${lang.code}.png`,
        fullPage: true,
      });
    });
  }
}

// Accessibility screenshots (English only)
test('Screenshot skip navigation', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.keyboard.press('Tab'); // Reveal skip link
  await page.screenshot({ path: 'screenshots/8_accessibility_skip_nav.png' });
});

test('Screenshot language menu', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.click('[aria-label*="Language"]');
  await page.screenshot({ path: 'screenshots/8_accessibility_language_menu.png' });
});
```

Run with:
```bash
npx playwright test scripts/take-screenshots.spec.ts
```

---

## Screenshot Organization

### Recommended folder structure:
```
screenshots/
├── 1_home/
│   ├── en.png
│   ├── sv.png
│   ├── es.png
│   ├── it.png
│   ├── fr.png
│   └── de.png
├── 2_form/
│   ├── en.png
│   ├── sv.png
│   └── ...
├── 3_loading/
│   └── ...
├── 4_results/
│   └── ...
├── 5_history/
│   └── ...
├── 6_profile_detail/
│   └── ...
├── 7_settings/
│   └── ...
└── 8_accessibility/
    ├── skip_nav.png
    ├── focus.png
    └── language_menu.png
```

**Total**: 43 screenshots (7 views × 6 languages + 3 accessibility)

---

## Screenshot Quality Guidelines

### Technical Requirements
- **Resolution**: 1920x1080 or higher
- **Format**: PNG (lossless)
- **Color**: Full color (24-bit or 32-bit)
- **DPI**: 72 (screen resolution)

### Composition
- ✅ **Include full viewport** - show entire page
- ✅ **Clean browser** - hide bookmarks bar, extensions
- ✅ **Consistent zoom** - 100% zoom level
- ✅ **Light/Dark theme** - choose one theme, stick to it
- ✅ **Data populated** - show realistic content, not empty states

### Annotations (Optional)
For documentation, you may want to add:
- Arrows pointing to key features
- Text labels explaining new functionality
- Highlighting of translated text

Tools: Snagit, Skitch, or any annotation tool

---

## Verification Checklist

Before submitting screenshots, verify:

- [ ] All 6 languages captured for each view
- [ ] Text is clearly readable (not blurry)
- [ ] All UI elements visible (not cut off)
- [ ] Consistent theme across all screenshots
- [ ] File names follow convention
- [ ] Screenshots show actual translations (not English fallback)
- [ ] Accessibility features clearly demonstrated

---

## Troubleshooting

### Issue: Language selector not visible
**Solution**: Check header area, it's a Globe icon button

### Issue: Translations not loading
**Solution**: Check browser console, verify translation files loaded

### Issue: Empty states in screenshots
**Solution**: Create sample profiles first, then take screenshots

### Issue: Loading screen too fast
**Solution**: Use browser DevTools → Network tab → Throttle to "Slow 3G"

### Issue: Focus indicators not showing
**Solution**: Use Tab key to navigate, press (don't click) buttons

---

## Delivery Format

### Option 1: GitHub Issue Comment
Upload screenshots to GitHub issue with structure:
```markdown
## Screenshots - All Languages

### Home Screen
![English](screenshots/1_home/en.png)
![Swedish](screenshots/1_home/sv.png)
...

### Form View
...
```

### Option 2: ZIP Archive
Create `MeticAI_Screenshots.zip` containing:
- All screenshots organized by view/language
- README.txt with file naming explanation

### Option 3: Google Drive / Dropbox
Upload folder structure, share link with view permissions

---

## Notes for Reviewer

When reviewing screenshots, look for:

1. **Translation Quality**: All text properly translated, no placeholders
2. **Layout Integrity**: UI doesn't break with longer/shorter text
3. **Accessibility**: Focus indicators, skip links visible
4. **Consistency**: Same theme, resolution, zoom across all
5. **Completeness**: All vital views captured in all languages

---

**Questions?**
- Check SUMMARY.md for testing instructions
- Review REFACTORING.md for technical details
- Check src/i18n/README.md for translation info

**Last Updated**: February 2026
