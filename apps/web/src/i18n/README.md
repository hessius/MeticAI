# MeticAI Translation Files

## 📋 Overview

Comprehensive translation files for the MeticAI-web application, covering all UI-facing strings across 6 languages.

## 🌍 Languages Supported

- 🇬🇧 **English (en)** - Original strings
- 🇸🇪 **Swedish (sv)** - Svenska
- 🇪🇸 **Spanish (es)** - Español
- 🇮🇹 **Italian (it)** - Italiano
- 🇫🇷 **French (fr)** - Français
- 🇩🇪 **German (de)** - Deutsch

## 📁 File Structure

```
public/locales/
├── en/translation.json    (16 KB, 354 lines)
├── sv/translation.json    (16 KB, 354 lines)
├── es/translation.json    (16 KB, 354 lines)
├── it/translation.json    (16 KB, 354 lines)
├── fr/translation.json    (20 KB, 354 lines)
└── de/translation.json    (16 KB, 354 lines)
```

## 📊 Coverage Statistics

- **Total Keys**: 302 per language
- **String Categories**: 17 sections
- **Components Covered**: 12 main components
- **File Status**: ✅ All valid JSON, ✅ All keys consistent

## 🗂️ Content Organization

### Top-Level Sections (by string count)

| Section | Strings | Description |
|---------|---------|-------------|
| `runShot` | 60 | Shot execution, scheduling, toast messages |
| `settings` | 56 | App settings, configuration, system info |
| `profileImport` | 34 | Profile import workflow & dialogs |
| `advancedCustomization` | 24 | Advanced profile customization options |
| `profileGeneration` | 15 | Profile creation form & validation |
| `common` | 15 | Universal buttons & actions |
| `history` | 14 | Profile catalogue & filtering |
| `profileBreakdown` | 13 | Profile detail display |
| `updateBanner` | 12 | System update notifications |
| `shotHistory` | 10 | Shot data viewing & analytics |
| `shotComparison` | 7 | Shot comparison interface |
| `imageCrop` | 6 | Image cropping dialog |
| `qrCode` | 5 | QR code sharing |
| `navigation` | 5 | Main navigation items |
| `app` | 4 | App-level strings |
| `greetings` | 3 | Time-based greetings (12 variants) |
| `loading` | 2 | Loading messages (16 variants) |

## 🎯 Key Features

### ✨ High-Quality Translations
- Natural, idiomatic translations in all languages
- Consistent coffee culture terminology
- Preserved brand names (James Hoffmann, Lance Hedrick, etc.)
- Maintained friendly, coffee-focused tone

### 🔄 Interpolation Support
All dynamic variables preserved:
```json
"profileWillRun": "Profile \"{{name}}\" will run in {{time}} minutes"
"youHaveProfiles": "You have {{count}} profile saved"
```

### 📝 Pluralization
Using i18next pluralization format:
```json
"youHaveProfiles": "You have {{count}} profile saved",
"youHaveProfiles_other": "You have {{count}} profiles saved"
```

### ☕ Coffee-Specific Terms
- **"Espresso"** - Never translated (universal term)
- **"Profile"** - Translated appropriately per language
- **"Shot"** - Context-appropriate translations
- **Equipment terms** - Consistent across languages

### 🎭 Special Content
- **16 loading messages** - Coffee-themed, community references
- **12 greeting variants** - Time-based (morning/afternoon/evening)
- **13 toast messages** - Success, error, and info states

## �� Usage

### With i18next

```typescript
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Import all translations
import en from '@/i18n/locales/en/translation.json'
import sv from '@/i18n/locales/sv/translation.json'
import es from '@/i18n/locales/es/translation.json'
import it from '@/i18n/locales/it/translation.json'
import fr from '@/i18n/locales/fr/translation.json'
import de from '@/i18n/locales/de/translation.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    sv: { translation: sv },
    es: { translation: es },
    it: { translation: it },
    fr: { translation: fr },
    de: { translation: de }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})
```

### Example Calls

```typescript
// Simple string
t('common.save')  // "Save" / "Spara" / "Guardar" / etc.

// With interpolation
t('runShot.toasts.profileWillRun', { name: 'Morning Blend' })

// With pluralization
t('profileGeneration.youHaveProfiles', { count: 5 })

// Array access (loading messages)
const messages = t('loading.messages', { returnObjects: true })
```

## ✅ Validation

All files have been validated for:
- ✅ Valid JSON syntax
- ✅ Consistent key structure across all languages
- ✅ Proper UTF-8 encoding
- ✅ Preserved interpolation variables ({{count}}, {{name}}, etc.)
- ✅ Maintained emoji and special characters (❤️, °C, ml/s, bar)

## 📝 What Was Extracted

### ✅ Included
- Button text and labels
- Form labels and placeholders
- Toast/alert messages
- Error messages
- Loading messages
- Greeting messages
- Modal/dialog content
- Headings and titles
- Tooltips and descriptions
- All user-visible text

### ❌ Excluded
- Code comments
- console.log messages
- Technical strings (API endpoints, CSS classes)
- Test data
- Variable names
- Internal debugging strings

## 🎨 Translation Samples

| Key | EN | SV | ES | IT | FR | DE |
|-----|----|----|----|----|----|----|
| `common.save` | Save | Spara | Guardar | Salva | Enregistrer | Speichern |
| `app.title` | Meticulous Espresso AI Profiler | Meticulous Espresso AI-profilerare | Perfilador AI de Meticulous Espresso | Profilatore AI Meticulous Espresso | Profileur AI Meticulous Espresso | Meticulous Espresso KI-Profiler |
| `settings.footer` | Built with ❤️ for coffee lovers | Byggd med ❤️ för kaffeälskare | Construido con ❤️ para amantes del café | Realizzato con ❤️ per gli amanti del caffè | Conçu avec ❤️ pour les amateurs de café | Mit ❤️ für Kaffeeliebhaber entwickelt |

## 🔍 Components Covered

1. **App.tsx** - Main app, greetings, loading messages
2. **HistoryView.tsx** - Profile catalogue, filtering
3. **SettingsView.tsx** - Settings, configuration, updates
4. **RunShotView.tsx** - Shot execution, scheduling
5. **ProfileBreakdown.tsx** - Profile detail display
6. **AdvancedCustomization.tsx** - Advanced options
7. **QRCodeDialog.tsx** - QR code sharing
8. **ProfileImportDialog.tsx** - Profile import workflow
9. **ImageCropDialog.tsx** - Image cropping
10. **UpdateBanner.tsx** - Update notifications
11. **ShotHistoryView.tsx** - Shot data viewing
12. **ShotComparisonView.tsx** - Shot comparison

## 📦 Ready for Integration

All files are production-ready and can be integrated immediately with i18next or similar i18n libraries.

---

**Created**: 2024
**Format**: JSON (i18next compatible)
**Encoding**: UTF-8
**Total Size**: ~94 KB (all 6 languages)
