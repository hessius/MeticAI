# iOS Live Activity for Espresso Shots — Design

**Date:** 2026-08-22
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** iOS 17+, native (Capacitor) app only. Hidden entirely in the server/web build.
**Related:** iOS home-screen widgets (`2026-08-09-ios-home-screen-widgets-design.md`), separated live graphs (`2026-08-19-live-view-separated-graphs-design.md`), auto-start on stable temp (#588).

---

## 1. Goal

Show a **Live Activity** (Lock Screen card + Dynamic Island) that mirrors the in-app Live View for the
duration of a shot: the two-stage heating readiness, a **Start shot** button, live extraction data
(pressure / flow / weight graph + metric tiles), and a final summary — updating **live even while the
phone is locked**.

The activity is **initiated by the Metic app** when it is running (foreground or recently backgrounded)
and detects a shot lifecycle beginning. It is **not** possible to start it when the app is fully
terminated (no APNs push server; the machine is LAN-only). This is an accepted product constraint.

---

## 2. Non-goals

- No remote (APNs) ActivityKit push updates. Updates are driven locally.
- No starting the activity from a cold app (fully terminated) or purely from a machine-side shot.
- No Android equivalent in this work (Android has no direct Live Activity analogue; revisit separately).
- No new server/`packages/core` behaviour — this is a native-only feature (one shared web-component
  tweak aside, see §9).

---

## 3. User-facing lifecycle

```
[app open, profile loaded, machine heating]
        │  JS detects heating/ready  →  LiveActivity.start(...)
        ▼
┌─ Heating ───────────────┐   two sensor bars: Brew Chamber + Brew Head,
│  each fills toward set   │   plain progress bars (NO red target marker),
│  temp, turns green when  │   each turns green on reaching the ready band.
│  reached.  Start = OFF   │   Glanceable (compact): Temp (default) or Est. time.
└──────────┬──────────────┘
           ▼  both sensors reached
┌─ Ready ─────────────────┐   Start shot button = solid blue, tappable (App Intent).
│  (skipped if auto-start  │   If auto-start-on-stable-temp (#588) is ON, button is
│   #588 is enabled)       │   omitted and the shot self-starts.
└──────────┬──────────────┘
           ▼  StartShotIntent  (or machine/auto start detected)
┌─ Extracting ────────────┐   3-line sparkline (pressure/flow/weight) + metric tiles.
│  live data streaming     │   Glanceable (compact): Weight 20/36 g (default) or
│                          │   Pressure / Flow / Temp (user-configurable).
└──────────┬──────────────┘
           ▼  extraction stops
┌─ Done (summary) ────────┐   Final weight, time, ratio, avg temp. Lingers ~30 s,
│  then auto-dismiss       │   then dismisses itself. No explicit end affordance
└─────────────────────────┘   (user can still swipe-clear).
```

**Phase mapping** reuses the existing Swift `MachineState` (`MeticKit/Models.swift`) so the Live
Activity, the widgets, and the app all agree (idle/heating/preheating/ready/brewing…, with the
`extracting` flag driving "brewing", exactly as the app derives it).

---

## 4. Architecture — how it stays live when locked

The crux: the WKWebView (JS/telemetry) is **suspended** when the app is backgrounded/locked, so JS
cannot pump `Activity.update()`. Updates must be produced **natively**.

**Chosen approach — native streaming, JS owns lifecycle only:**

```
 Web (WKWebView)                     Native (main app process)                 System
 ───────────────                     ─────────────────────────                 ──────
 shot-lifecycle detection            LiveActivityPlugin (Capacitor)
   │  start({profileName,            │  start() → ShotActivityController
   │        targets, config})   ───► │     • Activity.request(attributes,      ActivityKit
   │                                 │       initial ContentState)         ──► Lock Screen +
   │  stop()                    ───► │     • begins ShotStreamer               Dynamic Island
   │                                 │
   │                                 │  ShotStreamer  (extends
   │                                 │  SocketIOStatusReader → persistent)
   │                                 │     • Socket.IO stream ⇐ machine  ⇐──────  Meticulous
   │                                 │     • map frame → ContentState            (LAN, socket.io)
   │                                 │     • Activity.update(...) each frame ─►  ActivityKit
   │                                 │     • beginBackgroundTask assertion
   │                                 │       keeps stream alive while locked
```

- **JS responsibilities** (foreground only, which is guaranteed at start): decide *when* the lifecycle
  begins/ends and hand over the static context (profile name, target weight/temp, glanceable config).
  The web layer already owns machine status + targets.
- **Native responsibilities**: own the **live** connection and all `Activity.update()` calls. A single
  native Socket.IO stream is the activity's data source, independent of WKWebView suspension.
- **Background survival**: `ShotStreamer` holds a `beginBackgroundTask` assertion for the shot's
  duration (~25–45 s typical), which fits iOS's background window. On foreground the same streamer runs.
- **Degradation**: if iOS reclaims the background task (unusually long shot / pressure), updates pause and
  the activity shows the last value with a subtle "stale" affordance; it resumes on foreground and always
  reaches a terminal summary/dismiss (with a max-duration safety timeout).

**Rejected — pure JS-driven updates:** JS calls `update()` each frame. Simpler and reuses all web
telemetry, but stops the instant the phone locks — defeating the feature's main purpose. Rejected.

---

## 5. Components

### 5.1 Widget extension (SwiftUI, `MeticWidgets`)
- **`ShotActivityAttributes: ActivityAttributes`**
  - Static: `profileName`, `targetWeightG?`, `setTempC?`, `readyCutoffC?`, `shotGlanceable` (enum:
    weight|pressure|flow|temp), `heatingGlanceable` (enum: temp|estimatedTime).
  - `ContentState` (Codable, kept < ~4 KB): `phase` (heating|ready|extracting|done), `chamberTempC?`,
    `headTempC?`, `currentWeightG?`, `pressureBar?`, `flowGs?`, `brewTempC?`, `elapsedSec?`,
    `etaSec?` (heating), `graph` (≤ ~30 downsampled samples × {p, f, w}), and summary fields
    (`finalWeightG?`, `finalTimeSec?`, `ratio?`, `avgTempC?`).
- **Views:**
  - `ShotLockScreenView` — layout C (heating two-bar → ready+Start → extracting graph+tiles → summary).
  - Dynamic Island: `compactLeading` (brand + phase dot), `compactTrailing` (glanceable stat + ring),
    `minimal` (glanceable value), `expanded` (mirrors Lock Screen; Ready region hosts the Start button).
- **`StartShotIntent: AppIntent`** — the Ready-state button; runs in-app, reuses `MachineClient` to POST
  the start; on success advances the activity to `extracting`. Omitted when #588 auto-start is enabled.

### 5.2 Main app (Swift)
- **`ShotStreamer`** — new; generalises `MeticKit/SocketIOStatusReader` from one-shot to a persistent
  stream (`AsyncStream<[String:Any]>`), with reconnect/backoff and a max-duration cap.
- **`ShotActivityController`** — starts/updates/ends the `Activity`, owns the background-task assertion,
  maps `ShotStreamer` frames → `ContentState`, maintains the downsampled graph buffer, derives phase via
  `MachineState`, and builds the summary on the terminal frame.
- **`LiveActivityPlugin` (`CAPPlugin`)** — JS bridge: `isSupported()`, `areActivitiesEnabled()`,
  `start(config)`, `updateConfig(config)`, `stop()`. Writes glanceable config to the App Group so the
  extension/intent can read it.

### 5.3 Web (`apps/web`, native-only)
- **Trigger logic** — a small, unit-testable helper deriving start/stop transitions from machine
  status + selected profile (e.g. `deriveLiveActivityCommand(prev, next)`), wired where the app already
  tracks live status. Guarded by `Capacitor.isNativePlatform()` and iOS-17 support check.
- **Settings (native-only section)** — toggles: *Live Activity* on/off, *Shot glanceable stat*
  (weight|pressure|flow|temp), *Heating glanceable* (temperature|estimated time). Persisted in app
  settings and pushed to native via `LiveActivity.updateConfig`. All strings via `t()` across the
  6 locales (`en, sv, de, es, fr, it`).
- **Plugin TS wrapper** — typed `registerPlugin` surface + a no-op web fallback.

---

## 6. Data mapping (frame → ContentState)

| ContentState field        | Source (socket.io `status` payload)                                  |
|---------------------------|----------------------------------------------------------------------|
| `phase`                   | `MachineState(raw: name, extracting: extracting)` → grouped          |
| `chamberTempC` / `headTempC` | boiler/brew-chamber + brew-head sensors (as in `HeatingNumbers`)   |
| `brewTempC`               | active brew temperature                                              |
| `currentWeightG`          | live scale weight                                                    |
| `pressureBar` / `flowGs`  | live pressure + flow                                                 |
| `elapsedSec`              | since extraction start (native clock)                               |
| `etaSec`                  | `estimateTimeToReady` model (ported/mirrored constants)             |
| `graph`                   | ring buffer, downsampled to ≤ ~30 points × 3 series                  |
| summary fields            | computed on terminal frame (final weight/time, ratio, avg temp)     |

`readyCutoffC` and the two-sensor "reached" logic mirror `HeatingNumbers.tsx` /
`LiveShotView` (`lanceReadyCutoff`) so heating readiness is identical to the app.

---

## 7. Error handling & edge cases

- **Activities disabled / unsupported (iOS < 17 / toggle off):** plugin returns unsupported; JS no-ops.
- **Socket drop mid-shot:** `ShotStreamer` reconnects with backoff; activity keeps last frame; if it
  cannot recover before a max-duration cap, it finalises to a "shot ended" summary and dismisses.
- **App terminated mid-shot:** the Activity persists (system-owned) showing the last pushed frame; the
  background task ends, so it goes stale, then the system dismisses per its staleness/`dismissalPolicy`.
- **Multiple starts / duplicate lifecycle:** controller is idempotent — one active shot activity at a
  time; a new start replaces/updates the existing one.
- **StartShotIntent failure:** surfaces an error state on the button; leaves the activity in Ready.
- **App Group schema:** extend existing `AppGroup.Keys` with glanceable-config keys + schema version bump.

---

## 8. Testing

**Swift (`MeticWidgetsTests`, XCTest):**
- `MachineState`/phase derivation from representative payloads (heating, ready, extracting, done).
- Frame → `ContentState` mapping incl. two-sensor readiness and glanceable formatting (`20/36 g`,
  `89 → 93 °C`, `~40 s`, `8.9 bar`, `2.1 g/s`).
- Graph downsampling stays within the sample cap and the ContentState size budget.
- Summary computation on the terminal frame (weight/time/ratio/avg temp).
- `ShotStreamer` engine.io framing/parse (extends existing `SocketIOStatusReader` tests).

**Web (`apps/web`, vitest):**
- `deriveLiveActivityCommand` transitions (start on heating/ready, stop on done/idle, native-guarded).
- Settings component: renders native-only, persists config, calls `updateConfig`; **i18n keys present in
  all 6 locales**.
- `HeatingNumbers` renders without the target marker (updated test — see §9).

**Manual / device:** lock-screen live updates during a real shot; Dynamic Island compact/expanded/
minimal; Start button from the Lock Screen; auto-start (#588) path; airplane-mode/socket-drop recovery.

---

## 9. Shared-component tweak (both web builds)

Remove the red target marker from the in-app heating readiness bars, per product decision — cleaner as a
plain progress bar:
- `apps/web/src/components/LiveShotView/HeatingNumbers.tsx` — delete the `target-marker` element.
- Update `HeatingNumbers.test.tsx` (remove the `target-marker` assertion; add a "no marker" assertion).

This is a shared React component used by both the server and native web builds, so the single change
covers both runtimes; no server/core parity work is required for the rest of the feature.

---

## 10. Feasibility summary

Buildable with **no cloud backend**, reusing existing infrastructure: `SocketIOStatusReader` (native
socket read), `MachineState`/`MachineSnapshot` (shared mapping), the App Group channel + `WidgetBridge`
patterns, and `estimateTimeToReady`. The only genuinely new native pieces are ActivityKit wiring
(`ShotActivityAttributes` + views), the persistent `ShotStreamer`, the `ShotActivityController`, the
`StartShotIntent`, and the `LiveActivityPlugin` bridge. Live-while-locked is achieved via native
streaming under a background-task assertion for the short duration of a shot.

---

## 11. Open items to confirm during planning

- Exact socket.io field names for pressure/flow/weight/sensors (verify against a live `status` payload).
- ActivityKit `ContentState` size measured against the ~4 KB budget with the graph buffer at ~30×3.
- `estimateTimeToReady` reuse: port constants to Swift vs. compute a coarse ETA natively.
- App Group schema-version bump coordination with the existing widgets reader.
