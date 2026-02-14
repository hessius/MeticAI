# Phase 3 — Control Center Design Specification

> **Branch:** `feat/control-center`
> **Issue:** [#169](https://github.com/hessius/MeticAI/issues/169)
> **Depends on:** Phase 1 (MQTT infrastructure) + Phase 2 (WebSocket telemetry, settings toggle)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Layer](#2-data-layer)
3. [Component Architecture](#3-component-architecture)
4. [Control Center Widget](#4-control-center-widget)
5. [Live Shot View](#5-live-shot-view)
6. [Last-Shot Prompt](#6-last-shot-prompt)
7. [MQTT Command API](#7-mqtt-command-api)
8. [Layout Changes](#8-layout-changes)
9. [Chart Reuse Strategy](#9-chart-reuse-strategy)
10. [State Management](#10-state-management)
11. [Open Questions](#11-open-questions)
12. [Implementation Plan](#12-implementation-plan)

---

## 1. Overview

Phase 3 adds three user-facing features, all powered by the WebSocket telemetry pipe built in Phase 2:

| Feature | Where | Summary |
|---------|-------|---------|
| **Control Center Widget** | Desktop right column / Mobile above menu on StartView | Quick-glance machine state + actionable buttons |
| **Live Shot View** | Full view (replaces/augments current loading during a shot) | Real-time chart with stage goals, gauges, and overlay capability |
| **Last-Shot Prompt** | StartView banner | "Analyze your last shot?" suggestion based on recency |

### Guiding Principles

- **Reuse** existing chart code from `ShotHistoryView` — extract into shared components rather than duplicate
- **Progressive disclosure** — compact widget by default, "Show all" expands to full control panel
- **Non-intrusive** — live shot prompt is dismissable, not a modal
- **Hidden when off** — if `mqttEnabled` is `false`, no Control Center UI renders at all (per Phase 2 decision)
- **Graceful degradation** — if WebSocket disconnects, show stale indicator, don't crash

---

## 2. Data Layer

### 2.1 `useWebSocket` Hook

New hook: `apps/web/src/hooks/useWebSocket.ts`

```typescript
interface MachineState {
  // Connection
  connected: boolean
  availability: 'online' | 'offline' | null

  // Temperature
  boiler_temperature: number | null
  brew_head_temperature: number | null
  target_temperature: number | null

  // Brewing
  brewing: boolean
  state: string | null    // 'idle' | 'brewing' | 'heating' | 'preheating' | 'steaming' | 'descaling'
  pressure: number | null
  flow_rate: number | null
  shot_weight: number | null
  shot_timer: number | null
  target_weight: number | null
  preheat_countdown: number | null

  // Profile
  active_profile: string | null

  // Device
  total_shots: number | null
  brightness: number | null
  sounds_enabled: boolean | null
  voltage: number | null

  // Meta
  _ts: number | null       // server timestamp
  _stale: boolean          // true if no update for >5s
  _wsConnected: boolean    // WebSocket connection state
}

function useWebSocket(enabled: boolean): MachineState
```

**Behavior:**
- Connects to `ws://{host}/api/ws/live` only when `enabled === true`
- Reconnects with exponential backoff (1s → 2s → 4s → 8s → 15s cap)
- Sets `_stale: true` if no message received for 5 seconds (heartbeat covers this)
- Sets `_wsConnected: false` on close/error
- Returns a stable ref-object updated via `useRef` + `useState` trigger to avoid unnecessary re-renders
- Disconnects cleanly on unmount or when `enabled` flips to `false`

### 2.2 `useLastShot` Hook

New hook: `apps/web/src/hooks/useLastShot.ts`

```typescript
interface LastShotInfo {
  profile_name: string
  timestamp: string      // ISO 8601
  minutesAgo: number
  date: string           // YYYY-MM-DD
  filename: string
}

function useLastShot(): {
  lastShot: LastShotInfo | null
  loading: boolean
  dismissed: boolean
  dismiss: () => void
}
```

**Behavior:**
- On mount, fetches `/api/shot-dates` → takes the latest date → fetches `/api/shots/{date}` → takes the latest filename → extracts timestamp
- Alternatively (preferred): **new backend endpoint** `GET /api/last-shot` that returns the most recent shot metadata directly (avoids 3-hop chain)
- Calculates `minutesAgo` from timestamp
- `dismissed` persisted in `sessionStorage` (resets each browser session)
- Re-fetches when `total_shots` changes in WebSocket data (new shot pulled)

### 2.3 MQTT Command Dispatch

New file: `apps/web/src/lib/mqttCommands.ts`

```typescript
type MachineCommand =
  | 'start_shot'
  | 'stop_shot'
  | 'continue_shot'
  | 'abort_shot'
  | 'preheat'
  | 'tare_scale'
  | 'home_plunger'
  | 'purge'

async function sendMachineCommand(command: MachineCommand): Promise<void>
async function loadProfile(profileName: string): Promise<void>
async function setBrightness(value: number): Promise<void>
async function enableSounds(enabled: boolean): Promise<void>
```

These call **new REST endpoints** on the backend (see [Section 7](#7-mqtt-command-api)) which publish to the MQTT broker. The frontend never connects directly to MQTT — the server is the single gateway.

---

## 3. Component Architecture

### New Components

```
apps/web/src/
├── hooks/
│   ├── useWebSocket.ts          ← NEW
│   └── useLastShot.ts           ← NEW
├── lib/
│   └── mqttCommands.ts          ← NEW
├── components/
│   ├── ControlCenter.tsx        ← NEW (widget)
│   ├── ControlCenterExpanded.tsx ← NEW (full control panel)
│   ├── LiveShotView.tsx         ← NEW (full live chart view)
│   ├── LastShotBanner.tsx       ← NEW (prompt banner)
│   ├── SensorGauge.tsx          ← NEW (radial gauge)
│   └── charts/
│       ├── EspressoChart.tsx    ← NEW (extracted from ShotHistoryView)
│       ├── ChartOverlay.tsx     ← NEW (profile target overlay, extracted)
│       └── chartConstants.ts    ← NEW (colors, stage colors, shared config)
└── views/
    └── StartView.tsx            ← MODIFIED (layout, banner, widget)
```

### Extraction from `ShotHistoryView`

The 3040-line `ShotHistoryView` contains inline Recharts rendering that should be extracted into reusable components:

| Extract | Source Location | Reused By |
|---------|----------------|-----------|
| `EspressoChart` | Replay/Compare chart rendering | LiveShotView, ShotHistoryView |
| `ChartOverlay` | `ProfileTargetOverlay` customized layer | LiveShotView (profile goals) |
| `chartConstants.ts` | `CHART_COLORS`, `STAGE_COLORS`, axis config | All chart consumers |

The extraction is a refactor within `ShotHistoryView` — it continues to work identically but delegates to the shared chart component.

---

## 4. Control Center Widget

### 4.1 Layout & Placement

**Desktop (≥768px):**
```
┌──────────────────────────────────────────────────────────┐
│                        HEADER                            │
├──────────────────────────────────────┬───────────────────┤
│                                      │ ┌───────────────┐ │
│                                      │ │ CONTROL       │ │
│                                      │ │ CENTER        │ │
│         MAIN CONTENT                 │ │ WIDGET        │ │
│         (current view)               │ │               │ │
│                                      │ └───────────────┘ │
│                                      │                   │
│                                      │ (empty / future)  │
│                                      │                   │
├──────────────────────────────────────┴───────────────────┤
```

- Two-column grid: `lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)] lg:gap-6`
- Right column is `sticky top-4` so the widget stays visible while scrolling
- Widget is **only visible on StartView, RunShotView, and LiveShotView** — other views (form, loading, results, settings, history) use full-width single column
- The two-column wrapper lives in `App.tsx` around the view renderer

**Mobile (<768px):**
```
┌──────────────────────┐
│       HEADER         │
├──────────────────────┤
│ ┌──────────────────┐ │
│ │ CONTROL CENTER   │ │  ← compact card, above the main card
│ │ (collapsed)      │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │                  │ │
│ │ MAIN CONTENT     │ │
│ │                  │ │
│ └──────────────────┘ │
```

- Renders above the main view card, same `max-w-md` width
- Only on StartView (on RunShotView/LiveShotView, the live chart takes priority)
- Collapsible — tap to expand/collapse

### 4.2 Compact State (Default)

```
┌─────────────────────────────────────┐
│  ☕ Meticulous          ● Online    │
│                                     │
│  93.2°C          idle               │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄                     │
│  Berry Blast Bloom   1,247 shots    │
│                                     │
│  [▶ Start] [♨ Preheat] [⚖ Tare]   │
└─────────────────────────────────────┘
```

**Elements:**
- **Header row:** Machine name + connection status dot (green = online, red = offline, gray = unknown/stale)
- **Temperature:** `brew_head_temperature` (large, bold) — this is what baristas care about. Shows `target_temperature` as a subtle secondary value if available
- **State badge:** `state` value as a colored badge (`idle` = green, `brewing` = blue animated, `preheating` = orange, etc.)
- **Profile + stats:** `active_profile` name + `total_shots` count
- **Quick action buttons:** Three most common actions as compact icon+label buttons
  - **Start** → `start_shot` (disabled unless state = `idle`)
  - **Preheat** → `preheat` (disabled if already preheating)
  - **Tare** → `tare_scale` (always available when connected)
- **"Show all" link:** Expands to full control panel (see 4.3)

**During a shot (`brewing: true`):**
```
┌─────────────────────────────────────┐
│  ☕ Meticulous       ● Brewing 🔵   │
│                                     │
│  🕐 12.3s    ⚖ 18.2g / 36.0g      │
│  📊 9.1 bar  💧 2.3 ml/s           │
│  🌡 93.2°C                          │
│                                     │
│  [⏹ Stop]  [✖ Abort]  [📺 Live →] │
└─────────────────────────────────────┘
```

- Temperature row replaced by live shot metrics: timer, weight (current / target), pressure, flow rate
- Action buttons change to **Stop**, **Abort**, and **Open Live View**
- Numbers are large and bold, updating in real-time
- Subtle pulse animation on the Brewing badge

### 4.3 Expanded State ("Show All")

Opens below the compact widget (desktop) or as a sheet/drawer (mobile):

```
┌─────────────────────────────────────┐
│  ☕ Meticulous          ● Online    │
│  ─────────────────────────────────  │
│                                     │
│  🌡 Temperatures                    │
│  Brew Head    93.2°C                │
│  Boiler       94.1°C                │
│  Target       93.0°C                │
│                                     │
│  📊 Machine Info                    │
│  Active Profile  Berry Blast Bloom  │
│  Total Shots     1,247              │
│  Firmware         v1.2.3            │
│  Voltage          230V              │
│                                     │
│  ⚙ Machine Settings                │
│  Brightness    [━━━━━━━━○━━] 75     │
│  Sounds        [  ON ━━━]           │
│                                     │
│  🎯 Actions                         │
│  [▶ Start] [⏹ Stop] [✖ Abort]     │
│  [♨ Preheat] [⚖ Tare]             │
│  [🏠 Home Plunger] [🚿 Purge]      │
│                                     │
│  [Collapse ▲]                       │
└─────────────────────────────────────┘
```

**All 8 command buttons exposed:**
| Button | Command | Enabled When |
|--------|---------|-------------|
| Start | `start_shot` | `state === 'idle'` and connected |
| Stop | `stop_shot` | `brewing === true` |
| Abort | `abort_shot` | `brewing === true` |
| Preheat | `preheat` | `state === 'idle'` and connected |
| Tare Scale | `tare_scale` | connected |
| Home Plunger | `home_plunger` | `state === 'idle'` |
| Purge | `purge` | `state === 'idle'` |
| Continue | `continue_shot` | shot is paused (if detectable) |

**Machine settings controls:**
- **Brightness slider** (0–100) → `set_brightness` command
- **Sounds toggle** → `enable_sounds` command
- These reflect current sensor values (`brightness`, `sounds_enabled`) from WebSocket data

**Confirmation dialogs:** Destructive actions (Stop, Abort, Purge) show a confirmation dialog before executing.

### 4.4 Disconnected / MQTT Off States

| Condition | Behavior |
|-----------|----------|
| `mqttEnabled === false` | Widget not rendered at all (hidden) |
| `_wsConnected === false` | Widget shell renders with "Connecting..." skeleton |
| `availability === 'offline'` | Widget renders with red "Offline" badge, all action buttons disabled |
| `_stale === true` | Subtle amber "Stale data" indicator, values shown grayed |

---

## 5. Live Shot View

### 5.1 Trigger Conditions

The Live Shot View activates in two scenarios:

**A) User-initiated shot from MeticAI:**
- User clicks "Start" or "Run Now" (from RunShotView or Control Center)
- App transitions to `viewState: 'live-shot'` automatically

**B) Shot detected on machine (external trigger):**
- WebSocket reports `brewing: true` while user is in the app
- A **non-blocking banner** slides in at the top:
  ```
  ┌──────────────────────────────────────────────┐
  │ ☕ A shot is running!    [Watch Live →]  [✕] │
  └──────────────────────────────────────────────┘
  ```
- Banner uses `framer-motion` `AnimatePresence` — slides down from top, dismissable
- Tapping "Watch Live" navigates to `viewState: 'live-shot'`
- Dismissing hides the banner for the current shot (until `brewing` flips to `false` again)
- Banner appears on **all views** (overlaid), not just StartView

### 5.2 Layout

**Desktop:**
```
┌──────────────────────────────────────┬───────────────────┐
│                                      │ ┌───────────────┐ │
│  ┌────────────────────────────────┐  │ │  LIVE STATS   │ │
│  │                                │  │ │               │ │
│  │        LIVE CHART              │  │ │  🕐  28.3s    │ │
│  │     (Recharts, h-[60vh])       │  │ │  📊  9.1 bar  │ │
│  │                                │  │ │  💧  2.3 ml/s │ │
│  │  ████████████░░░░░░░░░░░░░░░░  │  │ │  ⚖  18.2g    │ │
│  │  Stage: Pre-infusion           │  │ │  🌡  93.2°C   │ │
│  │                                │  │ │               │ │
│  └────────────────────────────────┘  │ │  ── Stage ──  │ │
│                                      │ │  Pre-infusion │ │
│  ┌────────────────────────────────┐  │ │  Goal: 4 bar  │ │
│  │   STAGE INFO + GOALS           │  │ │  Limit: 3ml/s │ │
│  │   Exit: weight > 5g            │  │ │  Exit: >5g    │ │
│  └────────────────────────────────┘  │ │               │ │
│                                      │ │ [⏹ Stop]      │ │
│                                      │ │ [✖ Abort]     │ │
│                                      │ └───────────────┘ │
└──────────────────────────────────────┴───────────────────┘
```

**Mobile:**
```
┌──────────────────────┐
│      HEADER          │
├──────────────────────┤
│  🕐 28.3s  ⚖ 18.2g  │  ← sticky top bar with key metrics
│  📊 9.1bar 💧 2.3ml  │
├──────────────────────┤
│ ┌──────────────────┐ │
│ │   LIVE CHART     │ │  ← h-[45vh], scrollable below
│ │   (compact)      │ │
│ └──────────────────┘ │
│                      │
│  Stage: Pre-infusion │
│  Goal: 4 bar         │
│  Exit: weight > 5g   │
│                      │
│ [⏹ Stop]  [✖ Abort] │
└──────────────────────┘
```

### 5.3 Chart Features

The live chart uses the **extracted `EspressoChart` component** (same Recharts setup as shot history) with these additions:

**Data accumulation:**
- WebSocket frames at 10 FPS are accumulated into a `chartData: ChartDataPoint[]` array
- Each frame appends `{ time: shot_timer, pressure, flow: flow_rate, weight: shot_weight }`
- Chart X-axis auto-scales to `[0, max(shot_timer, estimated_total_time)]`
- Dual Y-axes: left = pressure + flow, right = weight (same as existing charts)

**Stage indication:**
- If a profile is loaded (via `active_profile`), fetch profile stages from `/api/profiles`
- Render `ReferenceArea` backgrounds for each stage's time range (same colors as shot history)
- Current stage highlighted with a brighter tint + label above the chart

**Profile goals overlay (the "green/red indicator" concept):**
- **Target curves** rendered as dashed lines (reuse `ChartOverlay` / `ProfileTargetOverlay`)
  - Green dashed = target pressure/flow for the current stage
  - The live line color intensifies toward green when tracking the target, shifts amber/red when diverging
- **Limit indicators**: Rendered as horizontal `ReferenceLine` in red (e.g., flow limit at 3 ml/s)
- **Exit criteria**: Shown as text below the chart + a vertical `ReferenceLine` at the projected exit point

**Gauges (sidebar / mobile top bar):**
- **Pressure gauge**: 0–15 bar range, green marker at stage target, red marker at limit
- **Flow gauge**: 0–8 ml/s range, same green/red markers
- **Temperature**: Not a gauge (relatively stable) — shown as a number
- **Weight**: Shown as `current / target` with a thin progress bar
- **Timer**: Large digital-clock style display

**Gauge implementation:**
- Custom SVG arc component (`SensorGauge.tsx`)
- Props: `value`, `min`, `max`, `goal?`, `limit?`, `unit`, `label`
- Arc fills from min to max, with:
  - Green tick mark at `goal` position
  - Red tick mark at `limit` position
  - Pointer/needle at current `value`
  - Color of filled arc: green when near goal, amber when drifting, red when past limit

### 5.4 Overlay Modes

The live chart supports two overlay modes (toggled via buttons below the chart):

| Mode | Description |
|------|-------------|
| **Profile Overlay** | Shows target pressure/flow curves from the loaded profile (dashed green/cyan lines). Default ON during a live shot. |
| **Shot Overlay** | Pick a previous shot of the same profile to overlay as reference (solid muted lines). Same comparison UI as ShotHistoryView's Compare tab but rendered live. |

### 5.5 Shot Complete Transition

When `brewing` flips from `true` to `false`:

1. Chart freezes (stops appending data points)
2. Final stats card animates in: total time, final weight, avg pressure, avg flow
3. Two CTAs:
   - **"Analyze This Shot"** → navigates to shot history detail with the analysis tab
   - **"Back to Home"** → returns to StartView
4. The live data is NOT persisted client-side — the machine saves the shot file, and subsequent analysis fetches it from the machine via the existing shot API

---

## 6. Last-Shot Prompt

### 6.1 Placement

**On StartView only**, rendered as a banner between the greeting and the action buttons:

```
┌────────────────────────────────────┐
│  ☕ Good morning, Jesper!          │
│  You have 12 profiles              │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ ☕ Shot pulled 23 min ago    │  │
│  │ Berry Blast Bloom            │  │
│  │                              │  │
│  │ [Analyze Shot →]     [✕]    │  │
│  └──────────────────────────────┘  │
│                                    │
│  [➕ Generate New Profile]         │
│  [☕ Profile Catalogue]            │
│  [▶ Run & Schedule]               │
│  [⚙ Settings]                     │
└────────────────────────────────────┘
```

### 6.2 Visibility Rules

| Condition | Behavior |
|-----------|----------|
| Last shot < 60 min ago | **Active prompt**: Prominent card with amber/gold accent border, "Analyze Shot" CTA button |
| Last shot 1–24 hours ago | **Subtle prompt**: Smaller, muted card: "Your last shot was 3 hours ago · [Analyze →]" |
| Last shot > 24 hours ago OR no shots | **No prompt**: Nothing shown |
| User clicks "Analyze" | Navigate to shot detail → Analyze tab |
| User dismisses (✕) | Banner hidden for this session (`sessionStorage`) |
| User completes analysis | Banner hidden (already analyzed) |
| New shot detected (via `total_shots` change) | Banner refreshes with new shot data |

### 6.3 Backend Support

**New endpoint:** `GET /api/last-shot`

```json
{
  "profile_name": "Berry Blast Bloom",
  "date": "2026-02-14",
  "filename": "07:30:00.shot.json.zst",
  "timestamp": "2026-02-14T07:30:00Z",
  "final_weight": 36.5,
  "total_time": 42.3
}
```

Returns the most recent shot file metadata without loading the full telemetry data. Returns `404` if no shots exist.

---

## 7. MQTT Command API

### 7.1 New Backend Endpoints

All commands are REST endpoints that publish to MQTT topics via the local Mosquitto broker.

**Base path:** `/api/machine/command`

| Endpoint | Method | MQTT Topic | Payload | Notes |
|----------|--------|------------|---------|-------|
| `/api/machine/command/start` | POST | `meticulous_espresso/command/start_shot` | — | Requires connected + idle |
| `/api/machine/command/stop` | POST | `meticulous_espresso/command/stop_shot` | — | Requires brewing |
| `/api/machine/command/abort` | POST | `meticulous_espresso/command/abort_shot` | — | Requires brewing |
| `/api/machine/command/continue` | POST | `meticulous_espresso/command/continue_shot` | — | |
| `/api/machine/command/preheat` | POST | `meticulous_espresso/command/preheat` | — | |
| `/api/machine/command/tare` | POST | `meticulous_espresso/command/tare_scale` | — | |
| `/api/machine/command/home-plunger` | POST | `meticulous_espresso/command/home_plunger` | — | |
| `/api/machine/command/purge` | POST | `meticulous_espresso/command/purge` | — | |
| `/api/machine/command/load-profile` | POST | `meticulous_espresso/command/load_profile` | `{"name": "..."}` | |
| `/api/machine/command/brightness` | POST | `meticulous_espresso/command/set_brightness` | `{"value": 75}` | 0–100 |
| `/api/machine/command/sounds` | POST | `meticulous_espresso/command/enable_sounds` | `{"enabled": true}` | |

### 7.2 Implementation

New route file: `apps/server/api/routes/commands.py`

```python
# Publishes to MQTT via paho-mqtt's publish.single()
# Uses the same broker config as MQTTSubscriber (127.0.0.1:1883)
# Each endpoint validates preconditions where possible
# Returns 200 on publish success, 503 if MQTT broker unreachable
# Returns 409 if precondition not met (e.g., start when brewing)
```

The command endpoints use **paho-mqtt's `publish.single()`** (fire-and-forget) — they don't maintain a persistent connection. This is intentional: the subscriber connection is long-lived but command publishing is infrequent.

### 7.3 Precondition Validation

The command endpoints can optionally check the current MQTT snapshot to validate preconditions:

```python
mqtt_sub = get_mqtt_subscriber()
snapshot = mqtt_sub.snapshot

if command == 'start_shot' and snapshot.get('brewing'):
    raise HTTPException(409, "Cannot start: a shot is already running")
```

This is a **soft guard** — the machine itself also validates commands.

---

## 8. Layout Changes

### 8.1 App.tsx Modifications

The outer layout wrapper in `App.tsx` needs a conditional two-column grid:

```tsx
// Pseudo-code for the layout change
const showControlCenter = mqttEnabled && wsConnected
const showRightColumn = showControlCenter && ['start', 'run-shot', 'live-shot'].includes(viewState)

<div className={cn(
  "w-full max-w-md lg:max-w-5xl relative",
  showRightColumn && "lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)] lg:gap-6"
)}>
  {/* Main content column */}
  <div>
    <AnimatePresence mode="wait">
      {/* current view */}
    </AnimatePresence>
  </div>

  {/* Right column — desktop only, specific views only */}
  {showRightColumn && (
    <aside className="hidden lg:block sticky top-4">
      <ControlCenter machineState={machineState} />
    </aside>
  )}
</div>
```

**Mobile placement:** When `showControlCenter` is true and `viewState === 'start'`, render a compact `<ControlCenter>` card above the StartView card (not inside it — separate element in the flex column).

### 8.2 New ViewState

Add `'live-shot'` to the `ViewState` union:

```typescript
type ViewState = 'start' | 'form' | 'loading' | 'results' | 'error'
              | 'history' | 'history-detail' | 'settings' | 'run-shot'
              | 'live-shot'  // ← NEW
```

### 8.3 Brewing Detection Banner

A global `<ShotDetectionBanner>` component renders outside the view `AnimatePresence`, positioned fixed at the top. It watches `machineState.brewing` and shows the "A shot is running!" prompt when:

1. `brewing` transitions from `false` → `true`
2. Current `viewState` is NOT `'live-shot'` (already watching)
3. User hasn't dismissed it for this shot

---

## 9. Chart Reuse Strategy

### 9.1 Extraction Plan

From `ShotHistoryView.tsx` (3040 lines), extract:

**`chartConstants.ts`:**
- `CHART_COLORS` object
- `STAGE_COLORS` array
- `STAGE_BORDER_COLORS` array
- `STAGE_TEXT_COLORS_LIGHT` / `STAGE_TEXT_COLORS_DARK` arrays
- Axis styling helpers

**`EspressoChart.tsx`:**
```typescript
interface EspressoChartProps {
  data: ChartDataPoint[]
  stages?: StageInfo[]           // for ReferenceArea backgrounds
  height?: string                // CSS height, default "h-[45vh]"
  showWeight?: boolean           // right Y-axis, default true
  showGravimetricFlow?: boolean  // default false
  overlay?: {                    // shot comparison overlay
    data: ChartDataPoint[]
    label: string
  }
  profileTargets?: ProfileTargetPoint[]  // dashed target curves
  replayTime?: number            // for replay playhead line
  liveMode?: boolean             // disables X-axis fixed domain, auto-scrolls
  referenceLines?: {             // for limits
    y: number
    axis: 'left' | 'right'
    color: string
    label: string
  }[]
  className?: string
}
```

**`ChartOverlay.tsx`:**
- Extracted from the `ProfileTargetOverlay` customized Recharts layer
- Reusable for both shot history and live view

**`ShotHistoryView` refactor:**
- Replace inline Recharts code with `<EspressoChart>` component calls
- This is a **pure refactor** — no visual changes to existing functionality

### 9.2 Live Chart Data Pipeline

```
WebSocket frame (10 FPS)
  → useWebSocket hook (MachineState)
  → LiveShotView component
  → Append to chartData ref when brewing
  → Pass to <EspressoChart data={chartData} liveMode={true} ... />
```

The `liveMode` prop on `EspressoChart`:
- Sets X-axis domain to `[0, 'auto']` (grows with data)
- Enables smooth CSS transitions on the chart lines
- Optionally auto-scrolls if total time exceeds viewport

---

## 10. State Management

### 10.1 WebSocket Lifecycle in App.tsx

```tsx
function App() {
  const [mqttEnabled, setMqttEnabled] = useState(true)

  // Fetch mqttEnabled from settings on mount
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => {
      setMqttEnabled(d.mqttEnabled !== false)
    })
  }, [])

  // Connect to WebSocket only when MQTT is enabled
  const machineState = useWebSocket(mqttEnabled)

  // ... pass machineState down to ControlCenter, LiveShotView, etc.
}
```

The `useWebSocket` hook owns the WebSocket lifecycle. It's called once in `App.tsx` and the result is passed as props. This avoids multiple WebSocket connections.

### 10.2 Live Shot Data

`LiveShotView` maintains its own `useRef<ChartDataPoint[]>` for accumulating chart points. This is local state — not lifted to App — because:

1. It's only relevant during the live view
2. It can be large (thousands of points at 10 FPS)
3. It's discarded when the view unmounts (the machine persists the shot data)

### 10.3 Shot Detection State

The "shot running" banner needs state at the App level:

```tsx
const [shotBannerDismissed, setShotBannerDismissed] = useState(false)

// Reset dismissed state when brewing flips to false
useEffect(() => {
  if (!machineState.brewing) {
    setShotBannerDismissed(false)
  }
}, [machineState.brewing])
```

---

## 11. Open Questions

These are items where the design makes a reasonable assumption but may need your input:

| # | Question | Current Assumption |
|---|----------|--------------------|
| 1 | **Gauge library**: Build custom SVG gauges or use a library like `react-gauge-chart`? | Build custom — small, matches our design system, no new dep |
| 2 | **Live chart performance**: At 10 FPS with Recharts, a 45-second shot = 450 data points. Recharts can handle this, but should we downsample for longer shots? | Yes — downsample to max ~300 visible points, keep full resolution in memory |
| 3 | **Shot overlay during live**: Should we allow overlaying a previous shot on the live chart? This requires fetching shot data mid-extraction. | Yes — it's a powerful feature for comparing against your best shot. Fetch happens once on selection. |
| 4 | **Profile stages during live**: The active profile's stages need to be fetched to render stage backgrounds and goals. Should this use the REST API or MQTT? | REST — fetch from `/api/profiles` when `active_profile` changes. MQTT doesn't carry full profile stage data. |
| 5 | **"Continue" button visibility**: The Meticulous machine has a "pause" state but it's unclear if this is exposed as a distinct `state` value via MQTT. | Show "Continue" button only if `state === 'paused'` is ever observed; otherwise hide it. |
| 6 | **Command feedback**: After sending a command (e.g., "Start"), should we show a toast, or just rely on the WebSocket state update? | Both — show an immediate optimistic toast ("Starting shot..."), then the WebSocket state change confirms it. Toast via Sonner (already available). |
| 7 | **Brightness/sounds controls**: Should these be in the expanded Control Center only, or also exposed in Settings? | Expanded Control Center only — they're machine-level controls, not MeticAI settings. |
| 8 | **Last-shot "analyze" flow**: Should the "Analyze Shot" button from the banner go to the existing ShotHistoryView detail → Analyze tab, or a new streamlined flow? | Existing flow — navigate to `history-detail` with the shot pre-selected. No new flow needed. |

---

## 12. Implementation Plan

### Sub-phase 3A: Foundation (Backend + Hooks + Chart Extraction)

| # | Task | Files |
|---|------|-------|
| 1 | Add `GET /api/last-shot` endpoint | `api/routes/shots.py` |
| 2 | Add `POST /api/machine/command/*` endpoints | `api/routes/commands.py`, `main.py` |
| 3 | Tests for new endpoints | `test_main.py` |
| 4 | Extract `EspressoChart`, `ChartOverlay`, `chartConstants` from `ShotHistoryView` | `components/charts/*` |
| 5 | Refactor `ShotHistoryView` to use extracted components | `ShotHistoryView.tsx` |
| 6 | Create `useWebSocket` hook | `hooks/useWebSocket.ts` |
| 7 | Create `useLastShot` hook | `hooks/useLastShot.ts` |
| 8 | Create `mqttCommands.ts` API helpers | `lib/mqttCommands.ts` |

### Sub-phase 3B: Control Center Widget

| # | Task | Files |
|---|------|-------|
| 9 | Build `ControlCenter` compact widget | `components/ControlCenter.tsx` |
| 10 | Build `ControlCenterExpanded` full panel | `components/ControlCenterExpanded.tsx` |
| 11 | Build `SensorGauge` SVG component | `components/SensorGauge.tsx` |
| 12 | Modify `App.tsx` layout for two-column + mobile placement | `App.tsx` |
| 13 | Wire `useWebSocket` in App, pass `machineState` to widget | `App.tsx` |
| 14 | i18n translations for all Control Center strings | `locales/*/translation.json` |

### Sub-phase 3C: Live Shot View

| # | Task | Files |
|---|------|-------|
| 15 | Build `LiveShotView` component with real-time chart | `components/LiveShotView.tsx` or `views/LiveShotView.tsx` |
| 16 | Add `'live-shot'` ViewState and transitions | `App.tsx` |
| 17 | Build shot-running detection banner | `components/ShotDetectionBanner.tsx` |
| 18 | Stage goals / limits display during live shot | Inside `LiveShotView` |
| 19 | Overlay modes (profile overlay, shot overlay) | Inside `LiveShotView` |

### Sub-phase 3D: Last-Shot Prompt

| # | Task | Files |
|---|------|-------|
| 20 | Build `LastShotBanner` component | `components/LastShotBanner.tsx` |
| 21 | Wire into StartView with visibility rules | `StartView.tsx` |
| 22 | Connect to `useLastShot` hook | `StartView.tsx` |

### Sub-phase 3E: Polish & Testing

| # | Task | Files |
|---|------|-------|
| 23 | Confirmation dialogs for destructive commands | `ControlCenter*.tsx` |
| 24 | Disconnection / stale data handling in all new components | All new components |
| 25 | Mobile testing & responsive polish | All new components |
| 26 | Accessibility (ARIA labels, keyboard navigation) | All new components |
| 27 | Full test suite green + new component tests | `test_main.py` |
