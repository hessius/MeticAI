# Separate graphs in Live View for large screens (#589)

Date: 2026-08-19
Issue: https://github.com/hessius/MeticAI/issues/589
Branch: version/3.0.0

## Problem

The Live View plots pressure, flow and weight as overlaid lines on a single set
of axes (`EspressoChart`). This is space-efficient on mobile but the lines crowd
each other and share axes at different scales, making them hard to read. On
larger screens (desktops, tablets) there is room to give each metric its own
panel. The historical single-shot and shot-comparison views (`ShotCharts.tsx`)
have the same combined-overlay limitation.

## Goals

- Offer an opt-in **Combined / Separated** toggle in the Live View on large
  screens.
- In the separated view, render each metric in its own panel. The panels must
  **flex-scale their height so they all fit within the viewport at once** — no
  vertical scrolling.
- Be responsive: on extra-wide screens the stacked panels reflow into a grid so
  each stays tall and readable.
- Extend the same separated option to the historical single-shot view and the
  shot-comparison view.

## Non-goals

- No change to mobile: the combined chart remains the only layout below the
  large breakpoint.
- No change to machine control, telemetry acquisition, AI/analysis, or profile
  logic. This is purely a presentation feature.
- No new metrics beyond those already captured. Power stays out of the default
  panel set.

## Chosen approach

Selected in brainstorming (visual companion): **Stacked small-multiples (B) as
the core layout, auto-upgrading to a grid (C) on extra-wide screens**, behind a
persisted Combined/Separated toggle. Mobile keeps the combined chart (A).

### Panels (Live View)

Separate panels for: **Pressure, Flow, Weight, Temperature**.
- The Flow panel overlays **gravimetric flow** (dashed) when that series is
  present, so the two flow signals stay together.
- Power (motor %) is not given its own panel (niche); it remains available only
  in the combined view.

### Responsiveness

| Breakpoint            | Layout                                             |
|-----------------------|----------------------------------------------------|
| `< lg` (< 1024px)     | Combined only; toggle hidden.                      |
| `lg` (>= 1024px)      | Toggle visible. Separated = vertical stack (B).    |
| `xl` (>= 1280px)      | Separated reflows into a 2-column grid (C).        |

- **Fit-to-viewport:** the separated container is height-bounded (Live View uses
  the same viewport-relative envelope as today's chart, e.g. `max-h`/`vh`
  budget). Panels are equal-share flex children (`flex-1 min-h-0`) so N panels
  divide the available height with no scroll. In grid mode the container uses
  `grid-cols-2` with equal `auto-rows`, so 4 panels tile 2x2 within the same
  height budget.

### Toggle and persistence

- A small segmented control (`Combined | Separated`), shown only at `lg+`, placed
  in the chart card header.
- Default: **Combined** (feature is opt-in per the issue).
- The choice is **persisted** across sessions via a new
  `STORAGE_KEYS.CHART_LAYOUT` entry (values `'combined' | 'separated'`), read
  through small `getChartLayout()`/`setChartLayout()` helpers in `lib/`.

## Component architecture

Introduce one shared, well-bounded primitive and have all three call sites use
it. This keeps each chart view focused and avoids duplicating the small-multiples
math.

### New: `MetricPanels` (`apps/web/src/components/charts/MetricPanels.tsx`)

A presentational component that renders a set of single-metric Recharts panels
sharing one time domain.

Props (shape, not final signature):

- `data: ChartDataPoint[]` — the point series (already downsampled by the caller).
- `panels: MetricPanelDef[]` — ordered panel descriptors. Each descriptor:
  - `key` (e.g. `'pressure'`), `labelKey` (i18n), `color`, `yAxis` hint,
    optional `overlayKey` (e.g. gravimetric flow on the Flow panel), optional
    `targetKey`/target-curve accessor, optional `compareKey` (second dashed
    series for the comparison view).
- `xMax?`, `liveMode?`, `syncId` — shared x-domain + Recharts `syncId` so a
  crosshair/tooltip hovers all panels together.
- `layout: 'stack' | 'grid'` and `heightClass` — the caller decides which based
  on breakpoint; `MetricPanels` only lays out the panels.

Responsibilities: render panels, share the x-axis domain, apply the syncId,
place per-panel reference lines / target curves. It does **not** own the toggle,
persistence, or breakpoint detection — those live in the callers/a hook.

### New: `useChartLayout` hook (`apps/web/src/hooks/useChartLayout.ts`)

Encapsulates: the persisted `combined | separated` preference, whether the
current viewport is `lg+` (separation allowed) and `xl+` (grid), and returns the
effective layout (`'combined' | 'stack' | 'grid'`) plus a setter for the toggle.
Uses a matchMedia-based subscription (via `useSyncExternalStore`) so it reacts to
resizes. Below `lg` it always resolves to `'combined'` regardless of the stored
preference.

### Call sites

1. **`LiveShotView.tsx`** — replace the single live `EspressoChart` card with:
   the toggle (from `useChartLayout`), then either the existing `EspressoChart`
   (combined) or `MetricPanels` (stack/grid) with the Pressure/Flow/Weight/
   Temperature panel set and the live target curves per panel.
2. **`ShotCharts.tsx` single-shot view** — same toggle + `MetricPanels` with the
   same panel set (target curves per panel where available).
3. **`ShotCharts.tsx` comparison view** — same toggle + `MetricPanels`, using
   `compareKey` so each panel overlays shot A (solid) and shot B (dashed). This
   directly addresses the comparison chart's crowding.

### Temperature series

`ChartDataPoint` has no `temperature` field today. Add an optional
`temperature?: number`:
- **Live:** populate from `brew_head_temperature` when building live points in
  `LiveShotView`.
- **History/comparison:** populate from the recorded shot's head/basket
  temperature when present.
- **Graceful absence:** if a data set has no temperature samples, the
  Temperature panel is omitted for that view (panels reflow to fill the height).

## Data flow

Telemetry / stored shot data -> caller builds `ChartDataPoint[]` (unchanged,
plus the new optional `temperature`) -> caller picks `combined | stack | grid`
from `useChartLayout` -> renders `EspressoChart` (combined) or `MetricPanels`
(separated). No data travels back up; the toggle only affects rendering.

## Error handling / edge cases

- Empty or single-point data: panels render their empty/near-empty state exactly
  as the combined chart does today.
- Missing a metric series (e.g. no gravimetric flow, no temperature): that
  overlay/panel is skipped; remaining panels still divide the full height.
- Resize across breakpoints mid-shot: `useChartLayout` re-resolves via matchMedia
  and the layout switches without remounting the data.
- Persisted value invalid/absent: default to `'combined'`.

## Dual-runtime parity

Pure client-side React rendering shared by both runtimes. No backend/core,
adapter, DirectMode, or analysis code is touched, so server mode and
native/Capacitor mode render identically by construction. (Guardrail #7 is
satisfied without a second implementation because there is only one.)

## Testing

- `useChartLayout`: unit tests for preference persistence, breakpoint gating
  (below `lg` forces combined), and `stack -> grid` at `xl` (mock matchMedia).
- `MetricPanels`: render tests — correct number of panels for a given panel set,
  temperature panel omitted when the series is absent, gravimetric-flow overlay
  present only when data exists, comparison mode renders A and B series.
- Chart-layout persistence helpers: get/set round-trip + invalid-value fallback.
- Existing `EspressoChart` / `ShotCharts` tests remain green (combined path
  unchanged).

## Internationalization

New user-facing strings across all 6 locales (`en, sv, de, es, fr, it`), no
em-dashes:
- Toggle labels: `charts.layout.combined`, `charts.layout.separated`
  (and an accessible group label, e.g. `charts.layout.label`).
- Panel titles reuse existing metric labels where present; add any missing
  (`charts.metric.temperature`, etc.).

## Rollout

Single PR on `version/3.0.0`. No migration; the new persisted key defaults to
combined so existing users see no change until they opt in on a large screen.

## Open questions / flagged for later

- Exact viewport height budget for the Live separated container (tune during
  implementation so 4 panels stay comfortably readable without scroll).
- Whether the comparison view should also expose Temperature (depends on whether
  both compared shots carry temperature samples) — resolve during implementation
  based on available data.
