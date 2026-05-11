# Metic v2.4.1 — TestFlight Testing Checklist

**Build date:** 2025-05-09
**Branch:** `fix/v241-testflight-batch` → `version/2.4.0`
**Changes:** 8 bug fixes, 4 improvements, 28+ dependency updates, image optimization

---

## 🔴 Critical — Bug Fixes

### 1. Toast Notifications Safe Area (#440)
- [ ] Trigger a toast notification (e.g., save settings, AI error)
- [ ] Verify toast does NOT overlap the Dynamic Island / status bar
- [ ] Check on iPhone with notch and iPhone without notch
- [ ] Check on iPad

### 2. AI Model Selection Persistence (#441)
- [ ] Go to Settings → AI Configuration
- [ ] Change the AI model (e.g., from Gemini 2.0 Flash to Gemini 2.5 Pro)
- [ ] Navigate away from Settings
- [ ] Return to Settings — verify the selected model is still correct
- [ ] Trigger an AI analysis — verify it uses the newly selected model
- [ ] Kill and restart the app — verify model selection persists

### 3. Target Overlay Rendering (#417)
- [ ] Open a completed shot that has a profile with targets
- [ ] Verify target curves show as **dashed lines** (not thick solid lines)
- [ ] Pinch-zoom the chart — verify lines stay consistent thickness
- [ ] Check on both iPhone and iPad

### 4. Shot Analysis Layout (#424)
- [ ] Open Shot History → select a shot → view analysis
- [ ] Verify stage names (e.g., "Fill", "Pre-infusion") don't wrap mid-word
- [ ] Verify exit trigger pills don't break across lines
- [ ] Verify Duration/Weight row and Max Pressure/Max Flow row are aligned
- [ ] Scroll through multiple stages — no overlapping or clipped text
- [ ] Check on narrow iPhone (SE/Mini) and wide iPad

### 5. iPad Foreground Layout (#422)
- [ ] On iPad: Open Metic, then switch to another app
- [ ] Switch back to Metic
- [ ] Verify the layout is correct (not squished or mis-sized)
- [ ] Try in both portrait and landscape orientations
- [ ] Try in Split View mode

### 6. Profile JSON Leak in Analysis (#419)
- [ ] Create a new profile via AI
- [ ] View the profile description / analysis text
- [ ] Verify NO raw JSON (```json blocks) appears in the displayed text
- [ ] Check both the profile detail view and analysis modal

### 7. AI Analysis Markdown Rendering (#418)
- [ ] Trigger an AI analysis on a shot
- [ ] Verify markdown formatting renders correctly (bold, lists, headers)
- [ ] Verify it does NOT show raw markdown syntax (**, ##, etc.)
- [ ] Check the fallback view (when analysis has no structured data)

---

## 🟡 Important — Improvements

### 8. AI Unavailable Warning (#442)
- [ ] If an AI request fails due to service unavailability, verify the error message:
  - Mentions it's a Google-side outage
  - Suggests switching to a different model in Settings
- [ ] Verify the message is helpful and actionable

### 9. Retraction Phase in Shot Graph (#438)
- [ ] Open a completed shot with retraction data
- [ ] Verify the graph shows a labeled "Retraction" stage after the last brewing stage
- [ ] Verify the retraction data (pressure drop, weight) is visible in the chart
- [ ] Verify the stage color is distinct from brewing stages

### 10. Stage Exit Reasoning (#425)
- [ ] Open Shot History → select a shot → view stage analysis
- [ ] Look for "Exited because: [trigger name]" or "Exited by [limit type]" text
- [ ] Verify it appears between the Profile Target and Exit Triggers sections
- [ ] Check a shot where a stage exited by trigger vs. by limit — both should be clear
- [ ] If a stage has no exit info, verify no broken/empty text appears

### 11. Boiler Temperature Display (#421)
- [ ] Start a brew (or view pre-brew state)
- [ ] Verify TWO temperature readings are visible:
  - **Brew temperature** (primary)
  - **Boiler temperature** (secondary, labeled)
- [ ] Verify both update in real-time during a shot
- [ ] Verify they show reasonable values (not 0°C or NaN)

---

## 🟢 General — Regression Checks

### 12. Dependency Updates
- [ ] App launches without crashes
- [ ] Navigate through all main screens (Home, Live Shot, History, Settings, Profiles)
- [ ] AI features work (analysis, profile creation)
- [ ] i18n: Switch language — verify no missing translation keys (no "key.name" showing)
- [ ] Forms work correctly (settings save, profile editing)
- [ ] Charts render correctly (pressure, flow, weight, temperature)

### 13. Image Assets
- [ ] Splash screen displays correctly on launch
- [ ] App icon looks correct on home screen
- [ ] No missing or broken images anywhere in the app

### 14. Core Functionality
- [ ] Connect to Meticulous machine
- [ ] View live shot data during brew
- [ ] View shot history
- [ ] Create/edit/delete profiles
- [ ] AI analysis of a shot
- [ ] AI profile creation
- [ ] Settings save and persist across app restarts
- [ ] Sound effects (if enabled) play correctly

### 15. Platform-Specific
- [ ] **iPhone**: All above checks pass
- [ ] **iPad**: All above checks pass, including split view
- [ ] **Docker/Web**: App loads at machine IP:3550, core features work

---

## 📝 Issues Deferred to v2.5.0

These are NOT expected to work in this build:
- **#439** — Dynamic Island / Live Activities (not implemented)
- **#420** — Pre-infusion flow/time/dose rules (not implemented)
- **#423** — Targets vs Limits naming discussion (pending design decision)

---

## 📊 Changes Summary

| Category | Count | Details |
|----------|-------|---------|
| Bug Fixes | 7 | #417, #418, #419, #422, #424, #440, #441 |
| Improvements | 4 | #421, #425, #438, #442 |
| Dep Updates | 28+ | 8 frontend production, 14 frontend dev, 5 backend |
| Image Optimization | 1 | ImgBot PR #414 (36% size reduction) |

**Frontend deps updated:** lucide-react, react-resizable-panels, i18next-http-backend (4.0.0), react-hook-form, zod, @xmldom/xmldom, + 14 dev deps
**Backend deps updated:** uvicorn, python-multipart, pytest-asyncio, pytest-cov, paho-mqtt
