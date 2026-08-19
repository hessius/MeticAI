# Separated Live View Graphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Combined/Separated graph toggle to the Live View (and the historical single-shot and comparison views) that renders each metric in its own viewport-fitting panel on large screens.

**Architecture:** A pure presentational `MetricPanels` component renders single-metric Recharts panels sharing a time domain; a `useChartLayout` hook owns the persisted preference + breakpoint resolution (`combined | stack | grid`). Three call sites (`LiveShotView`, `ShotCharts.ReplayChart`, `ShotCharts.CompareChart`) swap between the existing combined chart and `MetricPanels`. No backend/adapter/analysis code changes, so both runtimes render identically.

**Tech Stack:** React + TypeScript, Recharts, Tailwind, react-i18next, Vitest (happy-dom).

**Spec:** `docs/superpowers/specs/2026-08-19-live-view-separated-graphs-design.md`

**Conventions:** Web build `VITE_MACHINE_MODE=capacitor bunx vite build`; tests `bunx vitest run` (from `apps/web`); lint `bunx eslint .`; all user-facing strings via `t()` across all 6 locales (`en, sv, de, es, fr, it`), no em-dashes; Conventional Commits with trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

## File Structure

- Create: `apps/web/src/lib/chartLayout.ts` — persisted `combined | separated` preference (get/set + fallback).
- Create: `apps/web/src/lib/chartLayout.test.ts` — helper tests.
- Modify: `apps/web/src/lib/constants.ts` — add `STORAGE_KEYS.CHART_LAYOUT`.
- Create: `apps/web/src/hooks/useChartLayout.ts` — resolves effective layout from preference + matchMedia breakpoints.
- Create: `apps/web/src/hooks/useChartLayout.test.ts` — hook tests.
- Modify: `apps/web/src/components/charts/chartConstants.ts` — add `temperature?` to `ChartDataPoint`; add temperature color.
- Create: `apps/web/src/components/charts/MetricPanels.tsx` — small-multiples renderer.
- Create: `apps/web/src/components/charts/MetricPanels.test.tsx` — render tests.
- Modify: `apps/web/src/components/charts/index.ts` — export `MetricPanels` + types.
- Modify: `apps/web/src/hooks/useMachineTelemetry.ts` — include `temperature` in live shot samples.
- Modify: `apps/web/src/components/LiveShotView.tsx` — toggle + MetricPanels wiring.
- Modify: `apps/web/src/components/ShotCharts.tsx` — toggle + MetricPanels in ReplayChart and CompareChart.
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json` — new strings.

---

## Task 1: Chart-layout persistence helpers

**Files:**
- Modify: `apps/web/src/lib/constants.ts` (add key to `STORAGE_KEYS`)
- Create: `apps/web/src/lib/chartLayout.ts`
- Test: `apps/web/src/lib/chartLayout.test.ts`

- [ ] **Step 1: Add the storage key**

In `apps/web/src/lib/constants.ts`, inside the `STORAGE_KEYS` object (next to `DIAGNOSTICS_ENABLED`), add:

```ts
  CHART_LAYOUT: 'meticai-chart-layout',
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/chartLayout.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getChartLayoutPref, setChartLayoutPref } from './chartLayout'

describe('chartLayout preference', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to combined when unset', () => {
    expect(getChartLayoutPref()).toBe('combined')
  })

  it('round-trips a stored value', () => {
    setChartLayoutPref('separated')
    expect(getChartLayoutPref()).toBe('separated')
  })

  it('falls back to combined for an invalid stored value', () => {
    localStorage.setItem('meticai-chart-layout', 'bogus')
    expect(getChartLayoutPref()).toBe('combined')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/lib/chartLayout.test.ts`
Expected: FAIL (module `./chartLayout` not found).

- [ ] **Step 4: Write minimal implementation**

Create `apps/web/src/lib/chartLayout.ts`:

```ts
import { STORAGE_KEYS } from './constants'

export type ChartLayoutPref = 'combined' | 'separated'

export function getChartLayoutPref(): ChartLayoutPref {
  try {
    return localStorage.getItem(STORAGE_KEYS.CHART_LAYOUT) === 'separated'
      ? 'separated'
      : 'combined'
  } catch {
    return 'combined'
  }
}

export function setChartLayoutPref(pref: ChartLayoutPref): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CHART_LAYOUT, pref)
  } catch {
    /* storage unavailable — non-fatal */
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/lib/chartLayout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/constants.ts apps/web/src/lib/chartLayout.ts apps/web/src/lib/chartLayout.test.ts
git commit -m "feat(charts): persisted chart-layout preference helper (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: `useChartLayout` hook

Resolves the effective layout from the stored preference and the current viewport width. Below `lg` (1024px) it always returns `combined`. When `separated` and `>= xl` (1280px) it returns `grid`, otherwise `stack`.

**Files:**
- Create: `apps/web/src/hooks/useChartLayout.ts`
- Test: `apps/web/src/hooks/useChartLayout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/useChartLayout.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { resolveChartLayout } from './useChartLayout'

describe('resolveChartLayout', () => {
  it('forces combined below lg regardless of preference', () => {
    expect(resolveChartLayout('separated', { lg: false, xl: false })).toBe('combined')
    expect(resolveChartLayout('combined', { lg: false, xl: false })).toBe('combined')
  })

  it('honors combined preference at lg+', () => {
    expect(resolveChartLayout('combined', { lg: true, xl: true })).toBe('combined')
  })

  it('separated -> stack between lg and xl', () => {
    expect(resolveChartLayout('separated', { lg: true, xl: false })).toBe('stack')
  })

  it('separated -> grid at xl+', () => {
    expect(resolveChartLayout('separated', { lg: true, xl: true })).toBe('grid')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/hooks/useChartLayout.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/hooks/useChartLayout.ts`:

```ts
import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  getChartLayoutPref,
  setChartLayoutPref,
  type ChartLayoutPref,
} from '@/lib/chartLayout'

export type EffectiveChartLayout = 'combined' | 'stack' | 'grid'

interface Breakpoints {
  lg: boolean
  xl: boolean
}

/** Pure resolution of the effective layout from preference + breakpoints. */
export function resolveChartLayout(
  pref: ChartLayoutPref,
  bp: Breakpoints,
): EffectiveChartLayout {
  if (!bp.lg || pref === 'combined') return 'combined'
  return bp.xl ? 'grid' : 'stack'
}

function subscribeMedia(query: string, cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(query)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    cb => subscribeMedia(query, cb),
    () =>
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  )
}

export interface UseChartLayoutResult {
  /** Persisted user preference. */
  pref: ChartLayoutPref
  /** True when the viewport is wide enough to offer separation (lg+). */
  canSeparate: boolean
  /** Effective layout after applying breakpoints. */
  layout: EffectiveChartLayout
  /** Persist + apply a new preference. */
  setPref: (pref: ChartLayoutPref) => void
}

export function useChartLayout(): UseChartLayoutResult {
  const [pref, setPrefState] = useState<ChartLayoutPref>(getChartLayoutPref)
  const lg = useMedia('(min-width: 1024px)')
  const xl = useMedia('(min-width: 1280px)')

  const setPref = useCallback((next: ChartLayoutPref) => {
    setChartLayoutPref(next)
    setPrefState(next)
  }, [])

  return {
    pref,
    canSeparate: lg,
    layout: resolveChartLayout(pref, { lg, xl }),
    setPref,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/hooks/useChartLayout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useChartLayout.ts apps/web/src/hooks/useChartLayout.test.ts
git commit -m "feat(charts): useChartLayout hook resolving combined/stack/grid (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Add temperature to the chart data point

**Files:**
- Modify: `apps/web/src/components/charts/chartConstants.ts`
- Modify: `apps/web/src/hooks/useMachineTelemetry.ts` (live shot-sample builder)

- [ ] **Step 1: Add the field + color**

In `apps/web/src/components/charts/chartConstants.ts`, add `temperature?: number` to `ChartDataPoint` (after `weight?`):

```ts
export interface ChartDataPoint {
  time: number
  pressure?: number
  flow?: number
  weight?: number
  temperature?: number
  gravimetricFlow?: number
  power?: number
  powerNorm?: number
  stage?: string
}
```

Add a temperature color to the `CHART_COLORS` object (use the emerald used in the mockup):

```ts
  temperature: '#34d399', // Emerald
```

- [ ] **Step 2: Populate temperature in live shot samples**

In `apps/web/src/hooks/useMachineTelemetry.ts`, find where each shot sample point is pushed (the object containing `pressure`, `flow`, `weight`). Add the brew-head temperature to that point:

```ts
        temperature: clampTemp(prev.brew_head_temperature, undefined),
```

Use the existing `clampTemp` helper already imported in that file (it guards the 0-150 sensor range). If the sample builder does not already have access to `prev.brew_head_temperature`, read it from the same state object used for the other fields. If no reliable head-temp value is available for a point, omit the field (leave it undefined) — the Temperature panel handles absence gracefully (Task 4/5).

- [ ] **Step 3: Verify the app still builds**

Run: `cd apps/web && VITE_MACHINE_MODE=capacitor bunx vite build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/charts/chartConstants.ts apps/web/src/hooks/useMachineTelemetry.ts
git commit -m "feat(charts): thread brew-head temperature into live chart points (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: `MetricPanels` component

Renders one Recharts panel per metric descriptor, sharing a time domain and a `syncId` so hovering shows a synchronized crosshair across panels. Layout (`stack` vs `grid`) and the outer height come from the caller.

**Files:**
- Create: `apps/web/src/components/charts/MetricPanels.tsx`
- Modify: `apps/web/src/components/charts/index.ts`
- Test: `apps/web/src/components/charts/MetricPanels.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/charts/MetricPanels.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MetricPanels, type MetricPanelDef } from './MetricPanels'
import type { ChartDataPoint } from './chartConstants'

const data: ChartDataPoint[] = [
  { time: 0, pressure: 1, flow: 0, weight: 0, temperature: 90 },
  { time: 1, pressure: 8, flow: 2, weight: 5, temperature: 93 },
]

const panels: MetricPanelDef[] = [
  { key: 'pressure', labelKey: 'charts.metric.pressure', color: '#4ade80' },
  { key: 'flow', labelKey: 'charts.metric.flow', color: '#67e8f9' },
  { key: 'weight', labelKey: 'charts.metric.weight', color: '#fbbf24' },
  { key: 'temperature', labelKey: 'charts.metric.temperature', color: '#34d399' },
]

describe('MetricPanels', () => {
  it('renders one panel per descriptor', () => {
    const { container } = render(
      <MetricPanels data={data} panels={panels} layout="stack" heightClass="h-96" />,
    )
    expect(container.querySelectorAll('[data-metric-panel]')).toHaveLength(4)
  })

  it('omits a panel whose series is entirely absent', () => {
    const noTemp = data.map(({ temperature: _t, ...rest }) => rest)
    const { container } = render(
      <MetricPanels data={noTemp} panels={panels} layout="stack" heightClass="h-96" />,
    )
    expect(container.querySelectorAll('[data-metric-panel]')).toHaveLength(3)
  })

  it('applies grid layout class when layout=grid', () => {
    const { container } = render(
      <MetricPanels data={data} panels={panels} layout="grid" heightClass="h-96" />,
    )
    expect(container.firstElementChild?.className).toContain('grid')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/components/charts/MetricPanels.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/charts/MetricPanels.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { useChartTheme } from './chartTheme'
import type { ChartDataPoint, ProfileTargetPoint } from './chartConstants'

export interface MetricPanelDef {
  /** Primary data key on ChartDataPoint. */
  key: 'pressure' | 'flow' | 'weight' | 'temperature'
  /** i18n key for the panel title. */
  labelKey: string
  /** Line color. */
  color: string
  /** Optional dashed overlay series (e.g. gravimetric flow on the Flow panel). */
  overlayKey?: 'gravimetricFlow'
  /** Optional dashed comparison series (shot B) for the comparison view. */
  compareKey?: string
  /** Optional color for the comparison series (defaults to color). */
  compareColor?: string
}

export interface MetricPanelsProps {
  data: ChartDataPoint[]
  panels: MetricPanelDef[]
  layout: 'stack' | 'grid'
  /** Height budget for the whole panel group (e.g. "h-[60vh] max-h-[520px]"). */
  heightClass: string
  /** Shared x-axis max (omit for auto). */
  xMax?: number
  /** Per-metric target curves keyed by metric key. */
  targetCurves?: Partial<Record<MetricPanelDef['key'], ProfileTargetPoint[]>>
  className?: string
}

/** True when at least one point carries a finite value for the key. */
function hasSeries(data: ChartDataPoint[], key: string): boolean {
  return data.some(p => {
    const v = (p as Record<string, unknown>)[key]
    return typeof v === 'number' && Number.isFinite(v)
  })
}

const SYNC_ID = 'metric-panels'

export function MetricPanels({
  data,
  panels,
  layout,
  heightClass,
  xMax,
  targetCurves,
  className,
}: MetricPanelsProps) {
  const { t } = useTranslation()
  const theme = useChartTheme()

  const visible = panels.filter(p => hasSeries(data, p.key))
  const container =
    layout === 'grid'
      ? 'grid grid-cols-2 auto-rows-fr gap-2'
      : 'flex flex-col gap-2'

  return (
    <div className={`${container} ${heightClass} ${className ?? ''}`}>
      {visible.map(panel => (
        <div
          key={panel.key}
          data-metric-panel={panel.key}
          className="min-h-0 flex flex-col rounded-lg border border-border bg-card/40 p-2"
        >
          <span
            className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: panel.color }}
          >
            {t(panel.labelKey)}
          </span>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }} syncId={SYNC_ID}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} opacity={theme.gridOpacity} />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={[0, xMax ?? 'dataMax']}
                  tickFormatter={(v: number) => `${Math.round(v)}s`}
                  stroke={theme.axisStroke}
                  fontSize={10}
                  tickLine={{ stroke: theme.axisLineStroke }}
                  axisLine={{ stroke: theme.axisLineStroke }}
                />
                <YAxis stroke={theme.axisStroke} fontSize={10} width={34} tickLine={{ stroke: theme.axisLineStroke }} axisLine={{ stroke: theme.axisLineStroke }} />
                {targetCurves?.[panel.key] && targetCurves[panel.key]!.length > 0 && (
                  <Line
                    data={targetCurves[panel.key]}
                    type="monotone"
                    dataKey="value"
                    stroke={panel.color}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    opacity={0.5}
                    isAnimationActive={false}
                  />
                )}
                <Line type="monotone" dataKey={panel.key} stroke={panel.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                {panel.overlayKey && hasSeries(data, panel.overlayKey) && (
                  <Line type="monotone" dataKey={panel.overlayKey} stroke={panel.color} strokeWidth={1.5} strokeDasharray="4 2" dot={false} opacity={0.7} isAnimationActive={false} />
                )}
                {panel.compareKey && hasSeries(data, panel.compareKey) && (
                  <Line type="monotone" dataKey={panel.compareKey} stroke={panel.compareColor ?? panel.color} strokeWidth={1.5} strokeDasharray="4 3" dot={false} opacity={0.6} isAnimationActive={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  )
}
```

Note: `useChartTheme` and `ProfileTargetPoint` already exist in `apps/web/src/components/charts/`. If the theme hook has a different name/path, reuse whatever `EspressoChart.tsx`/`ShotCharts.tsx` already import for `theme` (grid/axis colors) — do not introduce a new theming approach.

- [ ] **Step 4: Export it**

In `apps/web/src/components/charts/index.ts`, add:

```ts
export { MetricPanels } from './MetricPanels'
export type { MetricPanelDef, MetricPanelsProps } from './MetricPanels'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/components/charts/MetricPanels.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/charts/MetricPanels.tsx apps/web/src/components/charts/MetricPanels.test.tsx apps/web/src/components/charts/index.ts
git commit -m "feat(charts): MetricPanels small-multiples component (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Wire the toggle + MetricPanels into LiveShotView

**Files:**
- Modify: `apps/web/src/components/LiveShotView.tsx`

- [ ] **Step 1: Add imports + hook + panel definitions**

Near the other imports:

```tsx
import { MetricPanels, type MetricPanelDef } from '@/components/charts'
import { useChartLayout } from '@/hooks/useChartLayout'
import { CHART_COLORS } from '@/components/charts/chartConstants'
```

Inside the component body (after `chartData`/`adjustedTargetCurves` are computed):

```tsx
  const { canSeparate, pref, setPref, layout } = useChartLayout()

  const livePanels: MetricPanelDef[] = [
    { key: 'pressure', labelKey: 'charts.metric.pressure', color: CHART_COLORS.pressure },
    { key: 'flow', labelKey: 'charts.metric.flow', color: CHART_COLORS.flow, overlayKey: 'gravimetricFlow' },
    { key: 'weight', labelKey: 'charts.metric.weight', color: CHART_COLORS.weight },
    { key: 'temperature', labelKey: 'charts.metric.temperature', color: CHART_COLORS.temperature },
  ]
```

- [ ] **Step 2: Replace the live chart card body**

Find the live chart block (the `<Card className="p-4">` wrapping the single live `EspressoChart`). Replace its contents with a header toggle (shown only when `canSeparate`) plus a conditional render:

```tsx
            <Card className="p-4">
              {canSeparate && (
                <div className="mb-2 flex justify-end">
                  <ChartLayoutToggle pref={pref} onChange={setPref} />
                </div>
              )}
              {layout === 'combined' ? (
                <EspressoChart
                  data={chartData}
                  stages={stages}
                  heightClass="h-[40vh] lg:h-[50vh] max-h-[400px]"
                  liveMode
                  showWeight
                  targetCurves={adjustedTargetCurves}
                  xMax={liveXMax}
                />
              ) : (
                <MetricPanels
                  data={chartData}
                  panels={livePanels}
                  layout={layout}
                  heightClass="h-[60vh] max-h-[560px]"
                  xMax={liveXMax}
                />
              )}
            </Card>
```

- [ ] **Step 3: Add the small toggle component**

At the bottom of `LiveShotView.tsx` (with the other local helper components like `SummaryItem`), add a segmented control:

```tsx
function ChartLayoutToggle({
  pref,
  onChange,
}: {
  pref: 'combined' | 'separated'
  onChange: (p: 'combined' | 'separated') => void
}) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label={t('charts.layout.label')}>
      {(['combined', 'separated'] as const).map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded px-2 py-1 ${pref === opt ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          aria-pressed={pref === opt}
        >
          {t(`charts.layout.${opt}`)}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Build + lint**

Run: `cd apps/web && VITE_MACHINE_MODE=capacitor bunx vite build && bunx eslint src/components/LiveShotView.tsx`
Expected: build succeeds; 0 eslint errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/LiveShotView.tsx
git commit -m "feat(live): combined/separated graph toggle in Live View (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Wire ReplayChart (historical single-shot) in ShotCharts

**Files:**
- Modify: `apps/web/src/components/ShotCharts.tsx`

- [ ] **Step 1: Add imports + panels + toggle in ReplayChart**

Add the same imports (`MetricPanels`, `MetricPanelDef`, `useChartLayout`, `CHART_COLORS`) at the top of `ShotCharts.tsx` if not already present.

Inside `ReplayChart`, before the `ResponsiveContainer`/`LineChart` return, add:

```tsx
  const { canSeparate, pref, setPref, layout } = useChartLayout()
  const panels: MetricPanelDef[] = [
    { key: 'pressure', labelKey: 'charts.metric.pressure', color: CHART_COLORS.pressure },
    { key: 'flow', labelKey: 'charts.metric.flow', color: CHART_COLORS.flow, overlayKey: 'gravimetricFlow' },
    { key: 'weight', labelKey: 'charts.metric.weight', color: CHART_COLORS.weight },
    { key: 'temperature', labelKey: 'charts.metric.temperature', color: CHART_COLORS.temperature },
  ]
```

- [ ] **Step 2: Conditionally render MetricPanels**

Wrap the existing combined chart so that when `layout !== 'combined'` the `MetricPanels` render instead, and add the toggle above the chart when `canSeparate`. Reuse the same `ChartLayoutToggle` — extract it into a shared file to avoid duplication:

- Create `apps/web/src/components/charts/ChartLayoutToggle.tsx` containing the toggle component from Task 5 Step 3, exported, and import it in both `LiveShotView.tsx` and `ShotCharts.tsx` (update Task 5's local copy to import from here instead — remove the local duplicate).

Render structure inside ReplayChart:

```tsx
      {canSeparate && (
        <div className="mb-2 flex justify-end">
          <ChartLayoutToggle pref={pref} onChange={setPref} />
        </div>
      )}
      {layout === 'combined' ? (
        /* existing ResponsiveContainer + LineChart unchanged */
      ) : (
        <MetricPanels
          data={displayData}
          panels={panels}
          layout={layout}
          heightClass="h-[60vh] max-h-[560px]"
        />
      )}
```

- [ ] **Step 3: Build + lint**

Run: `cd apps/web && VITE_MACHINE_MODE=capacitor bunx vite build && bunx eslint src/components/ShotCharts.tsx src/components/charts/ChartLayoutToggle.tsx src/components/LiveShotView.tsx`
Expected: build succeeds; 0 eslint errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ShotCharts.tsx apps/web/src/components/charts/ChartLayoutToggle.tsx apps/web/src/components/LiveShotView.tsx
git commit -m "feat(history): separated graph option in single-shot view (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Wire CompareChart (comparison A vs B) in ShotCharts

**Files:**
- Modify: `apps/web/src/components/ShotCharts.tsx`

- [ ] **Step 1: Add panels with compare keys**

Inside `CompareChart`, add the hook and a panel set that maps each metric to its A key and B compare key (the comparison data uses `pressureA/pressureB`, `flowA/flowB`, `weightA/weightB`):

```tsx
  const { canSeparate, pref, setPref, layout } = useChartLayout()
  const panels: MetricPanelDef[] = [
    { key: 'pressureA' as MetricPanelDef['key'], labelKey: 'charts.metric.pressure', color: COMPARISON_COLORS.pressure, compareKey: 'pressureB' },
    { key: 'flowA' as MetricPanelDef['key'], labelKey: 'charts.metric.flow', color: COMPARISON_COLORS.flow, compareKey: 'flowB' },
    { key: 'weightA' as MetricPanelDef['key'], labelKey: 'charts.metric.weight', color: COMPARISON_COLORS.weight, compareKey: 'weightB' },
  ]
```

If TypeScript rejects the widened `key` type, extend `MetricPanelDef['key']` in `MetricPanels.tsx` to `string` (keep the well-known union documented) — the component only uses it as a data key, so `string` is safe.

- [ ] **Step 2: Conditionally render MetricPanels**

As in Task 6, add the toggle (when `canSeparate`) and swap to `MetricPanels` when `layout !== 'combined'`, passing `data={displayData}` and `layout`. Comparison panels show A solid and B dashed (via `compareKey`).

- [ ] **Step 3: Build + lint**

Run: `cd apps/web && VITE_MACHINE_MODE=capacitor bunx vite build && bunx eslint src/components/ShotCharts.tsx`
Expected: build succeeds; 0 eslint errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ShotCharts.tsx apps/web/src/components/charts/MetricPanels.tsx
git commit -m "feat(compare): separated per-metric A/B comparison panels (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Internationalization

**Files:**
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`

- [ ] **Step 1: Add the strings to every locale**

Add a `charts` block (or extend it if present) with these keys. English values shown; translate for each locale (no em-dashes):

```json
"charts": {
  "layout": {
    "label": "Chart layout",
    "combined": "Combined",
    "separated": "Separated"
  },
  "metric": {
    "pressure": "Pressure",
    "flow": "Flow",
    "weight": "Weight",
    "temperature": "Temperature"
  }
}
```

Translations:
- sv: Chart layout="Diagramlayout", Combined="Kombinerat", Separated="Separerat"; Pressure="Tryck", Flow="Flöde", Weight="Vikt", Temperature="Temperatur".
- de: "Diagrammlayout", "Kombiniert", "Getrennt"; "Druck", "Fluss", "Gewicht", "Temperatur".
- es: "Diseño del gráfico", "Combinado", "Separado"; "Presión", "Flujo", "Peso", "Temperatura".
- fr: "Disposition du graphique", "Combiné", "Séparé"; "Pression", "Débit", "Poids", "Température".
- it: "Layout del grafico", "Combinato", "Separato"; "Pressione", "Flusso", "Peso", "Temperatura".

Reuse existing metric keys if the locale already defines them elsewhere rather than duplicating; otherwise add under `charts.metric`.

- [ ] **Step 2: Validate JSON**

Run: `cd apps/web && for l in en sv de es fr it; do node -e "JSON.parse(require('fs').readFileSync('public/locales/$l/translation.json','utf8'))" && echo "$l OK"; done`
Expected: all six print `OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/locales/*/translation.json
git commit -m "i18n(charts): layout toggle + metric labels in all locales (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Full validation

- [ ] **Step 1: Full test suite**

Run: `cd apps/web && bunx vitest run`
Expected: all files pass (previous baseline 1183 passed + the new tests from Tasks 1, 2, 4).

- [ ] **Step 2: Lint the repo**

Run: `cd apps/web && bunx eslint .`
Expected: 0 errors (pre-existing warnings acceptable).

- [ ] **Step 3: Capacitor build**

Run: `cd apps/web && VITE_MACHINE_MODE=capacitor bunx vite build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (document, do not automate)**

On a `lg+` viewport: Live View shows the Combined/Separated toggle; switching to Separated stacks Pressure/Flow/Weight/Temperature panels that fill the height with no scroll; at `xl+` they tile 2x2; the choice persists across reload; below `lg` the toggle is hidden and only the combined chart shows. Repeat for the historical single-shot and comparison views.

- [ ] **Step 5: Final commit (if any residual changes)**

```bash
git add -A
git commit -m "chore(charts): finalize separated-graph feature (#589)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-review notes

- **Spec coverage:** toggle (Tasks 2,5,6,7), viewport-fitting panels (Task 4 `flex-1 min-h-0` / grid `auto-rows-fr`), responsiveness lg/xl (Task 2), persistence (Task 1), metrics incl. temperature (Tasks 3,4,5), other views history + comparison (Tasks 6,7), i18n (Task 8), dual-runtime (no backend touched). Covered.
- **Temperature availability:** history/comparison temperature depends on recorded data; `MetricPanels` omits absent-series panels (Task 4), so no crash when temperature is missing.
- **Toggle DRY:** shared `ChartLayoutToggle` component (introduced in Task 6, referenced back into Task 5) — do not leave two copies.
- **Type widening:** comparison view widens `MetricPanelDef['key']` to `string` (Task 7) — apply once in `MetricPanels.tsx`.
