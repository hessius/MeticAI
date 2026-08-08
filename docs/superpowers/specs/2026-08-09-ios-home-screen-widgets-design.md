# iOS Home-Screen Widgets — Design

**Date:** 2026-08-09
**Branch:** `version/3.0.0`
**Status:** Approved design — ready for implementation planning
**Platform scope:** iOS 17+ only (WidgetKit interactive widgets / App Intents). Android and web/server builds are unaffected.

---

## 1. Summary

Add iOS home-screen widgets to the Metic Capacitor app. Two widget kinds ship together on a shared foundation:

1. **Favourite Profiles** — a grid of the user's favourite espresso profiles (circular profile image + name + target temp/weight). Tapping a profile loads and starts it.
2. **Control Center** — quick machine controls (Start, Preheat, Tare, and an on-demand **Now** snapshot). The snapshot briefly overlays live machine status, loaded profile, and current→target temp/weight.

Both widgets perform their actions in the background via **App Intents** (iOS 17+), talking **directly to the machine over the LAN**. A single global setting lets cautious users force **Start** to open the app instead of firing silently.

This feature also introduces a **Favourites** concept in the app itself (useful independently of widgets) and a `metic://` deep-link handler.

---

## 2. Goals & Non-Goals

### Goals
- Start a favourite profile from the home screen, ideally without opening the app.
- Fire safe machine controls (Preheat, Tare) from the home screen.
- Provide an honest, on-demand snapshot of machine status/temp/weight — never stale data.
- Introduce an in-app Favourites concept that also powers the widgets.

### Non-Goals (documented follow-ups)
- **Proxy/server-mode support** for widgets. v1 is direct-LAN only.
- **Localization of native widget strings.** Widget UI ships English-first; localization is a later pass. (The in-app web strings ARE fully localized — see §9.)
- **iOS 16 / lock-screen / StandBy / iPad `systemExtraLarge`** widgets. v1 targets iOS 17+ home-screen `systemSmall/Medium/Large`.
- **Live/streaming data** in widgets. WidgetKit cannot stream; the only live-ish view is the on-demand Snapshot overlay.

---

## 3. Key Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | Both widgets, designed together on shared plumbing. |
| 2 | Interaction model | Background App Intents (iOS 17+), with an opt-in to open the app on **Start** only. |
| 3 | Control Center data | On-demand snapshot only. No stale/last-known data ever shown. Snapshot expires (~10s). |
| 4 | Favourites source | Explicit in-app favourites **and** the widget is configurable (which favourites, layout/density). |
| 5 | iOS floor | iOS 17+ required. No iOS 16 degradation path. |
| 6 | Machine connectivity | Direct-to-machine on the LAN only. Off-LAN taps fail gracefully and offer "Open Metic". |
| 7 | "Open app on Start" | Single **global** setting (default off = background). Applies to Start only; Preheat/Tare/Now always silent. |
| 8 | Snapshot button copy | Labeled **"Now"**. |
| 9 | Snapshot overlay | Overlays the entire widget face for its lifetime, then reverts to controls. |

---

## 4. Architecture & Components

### 4.1 New targets / modules
1. **`MeticWidgets` app-extension target** — WidgetKit + App Intents, SwiftUI. Location: `apps/web/ios/App/MeticWidgets/`. Registered in `App.xcodeproj` alongside the existing `ShareExtension`. Shares App Group `group.com.metic.app`. Deployment target iOS 17.0.
2. **`WidgetBridge` Capacitor plugin** (Swift, in the main app) — the sole channel by which the web app writes shared state into the App Group. TS-facing API:
   - `setFavourites(favourites: Favourite[])`
   - `setMachineUrl(url: string)`
   - `setOpenAppOnStart(enabled: boolean)`
   - `reloadWidgets()`
3. **`MeticKit` shared Swift sources** — compiled into the extension (and the app where needed). Single source of truth for:
   - App-Group keys + `schemaVersion` constant.
   - `MachineClient` — direct HTTP to `/api/v1/...`.
   - Codable models (`Favourite`, `MachineSnapshot`, action enums).
4. **Web-app additions** (shared TS):
   - Favourites concept (`useFavourites` hook + storage key + UI).
   - `metic://` deep-link handler (`appUrlOpen` listener).
   - `useWidgetSync()` — mirrors favourites / machine URL / setting into `WidgetBridge` (iOS-gated).

### 4.2 Bounded responsibilities
- **`WidgetBridge`** only *writes* shared state. It never reads or performs machine actions.
- **Widget extension** only *reads* shared state and talks to the machine. It never writes app state.
- **Web app** owns Favourites truth and mirrors it down; it never reads widget internals.

These boundaries mean each unit can be understood and tested independently.

---

## 5. Data Flow & App-Group Contract

### 5.1 Shared state (written by app via `WidgetBridge`, read by widgets)
Stored in `UserDefaults(suiteName: "group.com.metic.app")` unless noted:

- `schemaVersion: Int` — bumped on breaking shape changes.
- `favourites: [Favourite]` (JSON, ordered, capped at 12):
  - `{ id: String, name: String, targetTempC: Double?, targetWeightG: Double?, imageFilename: String? }`
- `machineUrl: String` — mirrored from `resolveMachineUrl()`.
- `openAppOnStart: Bool` — global setting (§8).
- **Profile images:** written as files into the shared container at `favourites/<id>.png`; `imageFilename` references them. Widgets cannot reliably fetch images at render time, so images are cached on favourite add/change.

### 5.2 When the app writes
On app foreground, on favourites change, on `MACHINE_URL_CHANGED`, and on setting change → then `WidgetBridge.reloadWidgets()` (`WidgetCenter.reloadAllTimelines()`).

### 5.3 Reads & machine calls (widget side, direct-LAN)
- **Render:** widget reads `favourites` + `machineUrl` from the App Group. No network needed to draw. Missing image → monogram placeholder.
- **Action intents:** `MachineClient` calls:
  - Start: `GET /api/v1/profile/load/{id}` then `POST /api/v1/action/start` (or open app — see §7).
  - Preheat: `POST /api/v1/action/preheat`.
  - Tare: `POST /api/v1/action/tare`.
  - Stop: `POST /api/v1/action/stop` (contextual — see §6.2).
  - Now (snapshot): one-shot status read → machine state + current/target temp & weight + loaded profile.
  - Reachability pre-flight: `GET /api/v1/settings` with a short timeout.

> **Open item for the implementation plan (spike):** the exact one-shot status endpoint for the Snapshot. Live telemetry in-app arrives over the Socket.IO `status` channel (`sensors.w`, `boiler_temperature`, `state`, `loaded_profile`/`profile`, targets derived from the loaded profile's `final_weight`). The plan must determine whether a single REST endpoint returns an equivalent status object, or whether the widget performs a short-lived socket connection for one status frame. Target temp/weight are derived from the loaded profile (`GET /api/v1/profile/get/{id}`) when not present in the status frame.

---

## 6. Widget Catalog

Both kinds appear separately in the iOS widget gallery under the **"Metic."** brand header. All glyphs are **SF Symbols** (e.g. `play.fill`, `flame`, `scalemass`, `gauge.with.dots.needle.33percent`, `stop.fill`).

### 6.1 Favourite Profiles (`AppIntentConfiguration`)
Configurable via long-press → Edit Widget:
- **Which favourites:** pick from in-app favourites, or "Auto" (top of the ordered list).
- **Small style:** Hero or Grid.
- **Large density:** 2×3 (6) or 2×4 (8).

Families & the five selectable styles:
| Family | Style | Content |
|--------|-------|---------|
| `systemSmall` | **Hero** | 1 profile: large circular image + name + target temp/weight. |
| `systemSmall` | **Grid** | 2×2: four profiles (image + short name). |
| `systemMedium` | (fixed) | 4 profiles (2×2 list: image + name + target temp/weight). |
| `systemLarge` | **2×3** | 6 profiles. |
| `systemLarge` | **2×4** | 8 profiles. |

Tap a profile → `StartProfileIntent` (background, or opens app if `openAppOnStart`).

### 6.2 Control Center (`AppIntentConfiguration`)
- Config: optional machine label.
- Families:
  | Family | Content |
  |--------|---------|
  | `systemSmall` | 2×2 controls: Start, Preheat, Tare, **Now**. |
  | `systemMedium` | 4 controls in a row. |
  | `systemLarge` | 6 favourites (2×3) + control row (Start, Preheat, Tare, Now). |
- **"Now" snapshot:** overlays the entire widget face for ~10s — machine status (Idle / Heating / Ready / Brewing…), loaded profile name, and current→target temp & weight (e.g. `92.4 → 93.0 °C`, `18.2 → 36 g`) when available. A thin depleting accent bar indicates remaining lifetime (no explanatory text). Then reverts to the control face.
- **Stop:** the "Start" control becomes **Stop** only after a Snapshot reveals `state == brewing`. Default idle face shows Start. Stop is never shown speculatively, since no live state is held between snapshots.

---

## 7. Interaction, Deep Links & Safety

### 7.1 App Intents (iOS 17+, run in the widget process)
- `StartProfileIntent(profileId)` — load + start, OR open `metic://start?profileId=…` when `openAppOnStart` is enabled.
- `PreheatIntent` — always silent background. Idempotent/safe.
- `TareIntent` — always silent background. Safe.
- `SnapshotIntent` — one-shot status read; drives the ~10s overlay. Read-only.
- `StopIntent` — only reachable from the contextual Stop control.

### 7.2 Deep-link scheme (new web-app handler)
- `metic://start?profileId=…` — foreground the app and run Start.
- `metic://open` — generic fallback (e.g. from an error state).
- Implemented via `CapacitorApp.addListener('appUrlOpen', …)` that parses the URL and dispatches into the existing machine service. **Net-new:** no `appUrlOpen` handler exists today; the `metic` URL scheme is already registered in `Info.plist`.

### 7.3 Safety
Home-screen Start moves water. Mitigations:
1. Global `openAppOnStart` lets cautious users force a visible, confirmable Start in-app.
2. Direct-LAN only — Start can only fire when the user is home on the same network.
3. Reachability pre-flight (`/api/v1/settings`): if the machine is not reachable, the tap shows an "unreachable / Open Metic" state instead of silently failing.

Preheat, Tare, and Now carry no safety risk.

### 7.4 Feedback within widget constraints
- **Success:** system haptic + brief inline confirmation (checkmark flash).
- **Failure:** inline error glyph + "Open Metic" tap target.
- No stale or optimistic UI.

---

## 8. In-App Changes (shared TS)

### 8.1 Favourites (works in all runtimes)
- `STORAGE_KEYS.FAVOURITES`, persisted via existing `capacitorStorage` (localStorage on web/server, Preferences on native).
- `useFavourites()` hook: ordered list + `toggle(id)` / `reorder(...)`. Cap 12. Each entry: `id, name, targetTempC?, targetWeightG?, imageFilename?`.
- **UI:** star toggle on profile cards in `ProfileCatalogueView`; a "Favourites" section pinned at the top for at-a-glance access and drag-to-reorder. Useful in the app itself, not only for widgets.

### 8.2 Native → widget sync (iOS-only, no-op elsewhere)
- `useWidgetSync()` effect calls `WidgetBridge.setFavourites/setMachineUrl/setOpenAppOnStart` when those change (subscribing to `MACHINE_URL_CHANGED`), then `reloadWidgets()`.
- Guarded by `Capacitor.getPlatform() === 'ios'` — Android has no WidgetKit, so this path (and the plugin calls) are skipped entirely off-iOS.

### 8.3 Settings
- New toggle in `SettingsView`, **shown only on iOS native** (`Capacitor.getPlatform() === 'ios'`): "Open Metic when starting a shot from a widget" (`openAppOnStart`, default **off** = background).

### 8.4 Runtime note
This branch (`version/3.0.0`) has unified the backend into TypeScript (`apps/bun-server`); there is **no Python** anymore. The `WidgetBridge` plugin and widget extension are iOS-native-only and have **no server counterpart**. No backend parity work is required — this is called out so it isn't flagged as a dual-runtime parity gap.

---

## 9. Internationalization
- All new **web** user-facing strings use `t()` and are added to all **6 locales** (`en, sv, de, es, fr, it`) in `apps/web/public/locales/{locale}/translation.json`.
- Native **widget** strings live in SwiftUI `.strings` and ship English-first; widget-string localization is a documented follow-up (§2 Non-Goals).

---

## 10. Error Handling
- **Machine unreachable / off-LAN:** action intents pre-flight `/api/v1/settings` (short timeout). Failure → inline error glyph + "Open Metic" deep link. Never a silent no-op.
- **No favourites yet:** widgets render an empty state ("Add favourites in Metic") linking into the app.
- **Missing cached image:** monogram/initials placeholder.
- **Snapshot timeout:** overlay briefly shows "Couldn't read machine", then reverts to controls.
- **App-Group schema mismatch** (`schemaVersion`): widget degrades to a "please open Metic to update" state rather than crashing.

---

## 11. Testing

### 11.1 TS side (Vitest, runs in all runtimes)
- `useFavourites`: toggle, reorder, cap enforcement — success and edge paths.
- `metic://` deep-link parser/dispatch: valid `start`, missing/invalid `profileId`, unknown host, `open` fallback.
- `useWidgetSync`: asserts bridge calls fire on change on iOS, and are skipped off-iOS.

### 11.2 Swift side (XCTest in the extension)
- `MachineClient`: endpoint construction, timeout and error mapping, reachability pre-flight.
- App-Group codec: encode/decode round-trip, `schemaVersion` fallback behavior.
- SwiftUI previews for each family/style as visual smoke tests.

### 11.3 Manual device matrix (documented checklist)
- Each family/style renders correctly.
- Background Start vs. open-app Start (setting on/off).
- Snapshot lifecycle: tap → overlay → expiry → revert; brewing → Stop appears.
- Off-LAN failure → error state + Open Metic.
- Empty favourites state.

---

## 12. Rollout
- Additive and iOS-only; nothing is removed from existing behavior.
- Ships in the 3.0.0 line.
- `.superpowers/` is already git-ignored.
- **Out of scope for v1 (follow-ups):** proxy-mode widget support, widget-string localization, iOS 16 / lock-screen / iPad `systemExtraLarge` widgets.

---

## 13. Open Items for the Implementation Plan
1. **Snapshot status source (spike):** confirm the one-shot REST status endpoint vs. a short-lived socket read for machine state + current/target temp & weight.
2. **Xcode project wiring:** exact target/entitlement/App-Group configuration for `MeticWidgets`, and how it survives `npx cap sync`.
3. **Image caching format/size:** confirm PNG dimensions and the source of profile images to cache into the App-Group container.
