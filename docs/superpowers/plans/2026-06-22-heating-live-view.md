# Reinvented Heating / Ready Live View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the meaningless running-shot layout shown during the heating/ready phases with a purpose-built temperature dashboard: a restyled header, a hero "time-to-ready" countdown, a temperature graph with set + lance-ready target lines, numbers-with-progress and a ready marker, the profile breakdown (visible), a collapsible description, and Start (enabled) + Abort.

**Architecture:** The pre-shot block currently lives inline in `LiveShotView.tsx` (~lines 394–660, gated by `!ms.brewing && chartData.length === 0`). Extract it into a focused `HeatingDashboard` component that receives telemetry + the active profile + action callbacks, and renders the new layout. The time-to-ready estimate is a **pure function** (`estimateTimeToReady`) using an exponential-approach (Newtonian) model fit from a rolling sample window — isolated and unit-tested in `useMachineTelemetry`-independent fashion. A tiny `useHeatingSamples` hook accumulates `(timestamp, temperature)` samples while heating so the estimator has data to fit. Time/pressure/flow tiles and the shot graph are simply not rendered in this path; the running-shot view is unchanged.

**Tech Stack:** React + TypeScript, framer-motion, react-i18next, the app's `EspressoChart`/charts layer (`@/components/charts`), `ProfileBreakdown`, Vitest + @testing-library/react.

**Issue:** #494 · **Milestone:** 2.6 · **Spec:** `docs/superpowers/specs/2026-06-22-heating-live-view-design.md`

---

## Conventions (read once before starting)

- **Branch:** Work on `version/2.6.0`. Optionally create `feat/heating-live-view` off it.
- **Commits:** Conventional Commits, ending every message with:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
- **i18n:** All user-facing strings via `t()`, present in all 6 locales under `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`. LiveShotView strings live under the `controlCenter.*` namespace; add new ones under `controlCenter.heating.*`.
- **Tests (run from `apps/web`):**
  - Estimator: `bun run test -- src/components/LiveShotView/estimateTimeToReady.test.ts`
  - Full run: `bun run test:run`
  - Lint: `bun run lint`
- **Test pattern:** mock `framer-motion` and `react-i18next` at the top of component tests (see `apps/web/src/components/ProfileBreakdown.test.tsx`). Pure-function tests need no mocks.
- **Telemetry fields** (`apps/web/src/hooks/useMachineTelemetry.ts`): `brew_head_temperature`, `boiler_temperature` (displayed as **Brew Chamber**), `target_temperature`, `preheat_countdown`, `state`.
- **Lance-ready cutoff** is derived: `target_temperature − TEMP_ON_TARGET_THRESHOLD` (same threshold as the "Lance's standard" readiness easter egg). Locate the existing constant before writing code:
  Run `grep -rn "TEMP_ON_TARGET_THRESHOLD" apps/web/src` and import it; do **not** redefine it.

## File structure

- **Create** `apps/web/src/components/LiveShotView/estimateTimeToReady.ts` — pure estimator (exponential fit → seconds-to-cutoff). One responsibility, fully testable.
- **Create** `apps/web/src/components/LiveShotView/estimateTimeToReady.test.ts` — unit tests for the estimator.
- **Create** `apps/web/src/components/LiveShotView/useHeatingSamples.ts` — hook accumulating `(t, temp)` samples while heating; resets when not heating.
- **Create** `apps/web/src/components/LiveShotView/HeatingDashboard.tsx` — the new heating/ready layout component.
- **Create** `apps/web/src/components/LiveShotView/HeatingDashboard.test.tsx` — component render tests.
- **Modify** `apps/web/src/components/LiveShotView.tsx` — replace the inline pre-shot block with `<HeatingDashboard … />`; remove time/pressure/flow tiles + shot graph from this path.
- **Modify** `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json` — add `controlCenter.heating.*` keys.

> Note: if `apps/web/src/components/LiveShotView/` does not exist yet, create the directory. Keep `LiveShotView.tsx` where it is (importing from the new subfolder) to avoid touching every import site.

---

### Task 1: Implement the `estimateTimeToReady` pure function

The estimator fits Newton's law of cooling/heating `T(t) = T_target − (T_target − T0)·e^(−k·t)` to a rolling window of recent samples and solves for the time at which `T` reaches the lance-ready cutoff. Linear extrapolation over-promises near the target (heating slows asymptotically), so an exponential fit is required.

**Files:**
- Create: `apps/web/src/components/LiveShotView/estimateTimeToReady.ts`
- Test: `apps/web/src/components/LiveShotView/estimateTimeToReady.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/LiveShotView/estimateTimeToReady.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estimateTimeToReady, type TempSample } from './estimateTimeToReady'

// Build a synthetic Newtonian heating curve sampled every `dt` seconds.
function syntheticCurve(opts: {
  T0: number
  target: number
  k: number
  dt: number
  count: number
}): TempSample[] {
  const { T0, target, k, dt, count } = opts
  const out: TempSample[] = []
  for (let i = 0; i < count; i++) {
    const t = i * dt
    const temp = target - (target - T0) * Math.exp(-k * t)
    out.push({ t, temp })
  }
  return out
}

describe('estimateTimeToReady', () => {
  it('returns null when there are too few samples', () => {
    const samples: TempSample[] = [
      { t: 0, temp: 20 },
      { t: 1, temp: 30 },
    ]
    expect(
      estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    ).toBeNull()
  })

  it('estimates a sane time-to-cutoff for a rapid-then-slow curve', () => {
    // Target 93, cutoff 92, k=0.05/s. Cutoff reached at:
    // t = -ln((target-cutoff)/(target-T0)) / k = -ln(1/73)/0.05 ≈ 85.8s
    const samples = syntheticCurve({ T0: 20, target: 93, k: 0.05, dt: 2, count: 8 })
    // current time = last sample time = 14s; remaining ≈ 85.8 - 14 ≈ 71.8s
    const eta = estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    expect(eta).not.toBeNull()
    expect(eta!).toBeGreaterThan(50)
    expect(eta!).toBeLessThan(95)
  })

  it('returns 0 when the current temperature is already at/above the cutoff', () => {
    const samples = syntheticCurve({ T0: 90, target: 93, k: 0.05, dt: 2, count: 8 })
    // Force last sample above cutoff
    samples[samples.length - 1] = { t: 14, temp: 92.5 }
    const eta = estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    expect(eta).toBe(0)
  })

  it('clamps absurd estimates to the max cap', () => {
    // Nearly flat curve (k tiny) → huge ETA → clamped to maxSeconds
    const samples = syntheticCurve({ T0: 20, target: 93, k: 0.0005, dt: 2, count: 8 })
    const eta = estimateTimeToReady({
      samples, target: 93, cutoff: 92, minSamples: 5, maxSeconds: 600,
    })
    expect(eta).toBe(600)
  })

  it('returns null when the fit is degenerate (no temperature rise)', () => {
    const samples: TempSample[] = Array.from({ length: 8 }, (_, i) => ({
      t: i * 2,
      temp: 50, // flat — no rise, cannot fit k
    }))
    expect(
      estimateTimeToReady({ samples, target: 93, cutoff: 92, minSamples: 5 })
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/estimateTimeToReady.test.ts`
Expected: FAIL — cannot resolve `./estimateTimeToReady`.

- [ ] **Step 3: Implement the estimator**

Create `apps/web/src/components/LiveShotView/estimateTimeToReady.ts`:

```ts
export interface TempSample {
  /** Seconds since heating started (monotonic). */
  t: number
  /** Temperature reading in °C. */
  temp: number
}

export interface EstimateOptions {
  samples: TempSample[]
  /** Set/target temperature (°C). */
  target: number
  /** Lance-ready cutoff (°C) = target − threshold. */
  cutoff: number
  /** Minimum samples required before producing an estimate. Default 5. */
  minSamples?: number
  /** Upper clamp for the returned ETA (seconds). Default 900. */
  maxSeconds?: number
}

/**
 * Estimate seconds remaining until temperature reaches `cutoff`, using a
 * Newtonian (exponential-approach) model fit to recent samples:
 *
 *   T(t) = target − (target − T0) · e^(−k·t)
 *
 * Linearizing: ln(target − T) = ln(target − T0) − k·t, i.e. y = a + b·t with
 * y = ln(target − T), b = −k. We fit (a, b) by least squares over the window,
 * then solve for the time at which T = cutoff and subtract the latest sample
 * time to return the *remaining* seconds.
 *
 * Returns null when there is insufficient/degenerate data (caller hides the
 * estimate), 0 when already at/above cutoff, and a value clamped to maxSeconds.
 */
export function estimateTimeToReady(opts: EstimateOptions): number | null {
  const { samples, target, cutoff } = opts
  const minSamples = opts.minSamples ?? 5
  const maxSeconds = opts.maxSeconds ?? 900

  if (samples.length < minSamples) return null

  const latest = samples[samples.length - 1]
  if (latest.temp >= cutoff) return 0

  // Build linearized points y = ln(target − T). Drop any sample at/above target
  // (would make the log undefined / negative-argument).
  const pts: Array<{ t: number; y: number }> = []
  for (const s of samples) {
    const gap = target - s.temp
    if (gap <= 0) continue
    pts.push({ t: s.t, y: Math.log(gap) })
  }
  if (pts.length < minSamples) return null

  // Least-squares fit y = a + b·t.
  const n = pts.length
  let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0
  for (const p of pts) {
    sumT += p.t
    sumY += p.y
    sumTT += p.t * p.t
    sumTY += p.t * p.y
  }
  const denom = n * sumTT - sumT * sumT
  if (denom === 0) return null

  const b = (n * sumTY - sumT * sumY) / denom
  const a = (sumY - b * sumT) / n
  const k = -b

  // Heating must be approaching the target: k > 0. Otherwise degenerate.
  if (!Number.isFinite(k) || k <= 0) return null

  // Solve target − (target − T0)·e^(−k·t_cutoff) = cutoff.
  // With our fit, ln(target − T) = a + b·t → target − T = e^(a + b·t).
  // Set target − T = target − cutoff:
  //   e^(a − k·t) = target − cutoff
  //   t_cutoff = (a − ln(target − cutoff)) / k
  const gapAtCutoff = target - cutoff
  if (gapAtCutoff <= 0) return 0
  const tCutoff = (a - Math.log(gapAtCutoff)) / k

  const remaining = tCutoff - latest.t
  if (!Number.isFinite(remaining)) return null
  if (remaining <= 0) return 0
  return Math.min(remaining, maxSeconds)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/estimateTimeToReady.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/LiveShotView/estimateTimeToReady.ts \
        apps/web/src/components/LiveShotView/estimateTimeToReady.test.ts
git commit -m "feat(live-view): add exponential time-to-ready estimator

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Implement the `useHeatingSamples` rolling-window hook

Accumulates `(t, temp)` samples while the machine is heating so the estimator has data to fit; resets when not heating. Uses the boiler/brew-chamber temperature (the one the cutoff is judged against — confirm which sensor the readiness easter egg uses in `LiveShotView.tsx` and feed the same one).

**Files:**
- Create: `apps/web/src/components/LiveShotView/useHeatingSamples.ts`
- Test: `apps/web/src/components/LiveShotView/useHeatingSamples.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/LiveShotView/useHeatingSamples.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHeatingSamples } from './useHeatingSamples'

describe('useHeatingSamples', () => {
  it('accumulates samples while active and exposes elapsed-time points', () => {
    let now = 1000
    const nowFn = () => now
    const { result, rerender } = renderHook(
      ({ temp, active }) => useHeatingSamples({ temp, active, maxWindow: 10, nowFn }),
      { initialProps: { temp: 20, active: true } }
    )
    expect(result.current.length).toBe(1)
    act(() => { now = 3000 })
    rerender({ temp: 30, active: true })
    expect(result.current.length).toBe(2)
    // second sample is 2s after the first
    expect(result.current[1].t).toBeCloseTo(2, 1)
    expect(result.current[1].temp).toBe(30)
  })

  it('clears samples when inactive', () => {
    const { result, rerender } = renderHook(
      ({ temp, active }) => useHeatingSamples({ temp, active }),
      { initialProps: { temp: 20, active: true } }
    )
    expect(result.current.length).toBe(1)
    rerender({ temp: 20, active: false })
    expect(result.current.length).toBe(0)
  })

  it('drops samples older than the window', () => {
    let now = 0
    const nowFn = () => now
    const { result, rerender } = renderHook(
      ({ temp }) => useHeatingSamples({ temp, active: true, maxWindow: 5, nowFn }),
      { initialProps: { temp: 20 } }
    )
    for (let i = 1; i <= 8; i++) {
      act(() => { now = i * 1000 })
      rerender({ temp: 20 + i })
    }
    // window is 5s → at most ~6 samples retained
    expect(result.current.length).toBeLessThanOrEqual(6)
    expect(result.current[result.current.length - 1].temp).toBe(28)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/useHeatingSamples.test.ts`
Expected: FAIL — cannot resolve `./useHeatingSamples`.

- [ ] **Step 3: Implement the hook**

Create `apps/web/src/components/LiveShotView/useHeatingSamples.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import type { TempSample } from './estimateTimeToReady'

interface UseHeatingSamplesOptions {
  /** Current temperature reading (°C) the estimate is based on. */
  temp: number
  /** True while the machine is heating (not yet ready / not brewing). */
  active: boolean
  /** Rolling window length in seconds. Default 45. */
  maxWindow?: number
  /** Injectable clock for tests (ms). Default Date.now. */
  nowFn?: () => number
}

/**
 * Accumulates (elapsed-seconds, temperature) samples while `active`, retaining a
 * trailing window of `maxWindow` seconds. Resets to empty when inactive so each
 * heating cycle starts fresh.
 */
export function useHeatingSamples({
  temp,
  active,
  maxWindow = 45,
  nowFn = Date.now,
}: UseHeatingSamplesOptions): TempSample[] {
  const [samples, setSamples] = useState<TempSample[]>([])
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      startRef.current = null
      setSamples((prev) => (prev.length ? [] : prev))
      return
    }
    const now = nowFn()
    if (startRef.current === null) startRef.current = now
    const t = (now - startRef.current) / 1000
    setSamples((prev) => {
      const next = [...prev, { t, temp }]
      const cutoff = t - maxWindow
      return next.filter((s) => s.t >= cutoff)
    })
    // Re-run on each new temperature reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temp, active])

  return samples
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/useHeatingSamples.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/LiveShotView/useHeatingSamples.ts \
        apps/web/src/components/LiveShotView/useHeatingSamples.test.ts
git commit -m "feat(live-view): add rolling heating-sample window hook

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Add `controlCenter.heating.*` i18n keys to all 6 locales

**Files:**
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`

- [ ] **Step 1: Locate the `controlCenter` block**

Run: `grep -n '"controlCenter"' apps/web/public/locales/en/translation.json`
Add a new `"heating"` object inside `controlCenter`.

- [ ] **Step 2: Add the `heating` object in each locale**

Insert this object into `controlCenter` in **en** (translate the values for the other locales):

```json
    "heating": {
      "statusHeating": "Heating",
      "statusReady": "Ready",
      "setTemp": "Set temp",
      "timeToReady": "to lance-ready",
      "estimatePrefix": "~",
      "slowsNearTarget": "Heating slows near the target to avoid overshoot",
      "estimating": "Estimating…",
      "tempGraphTitle": "Temperature",
      "lanceReady": "Lance-ready",
      "brewChamber": "Brew Chamber",
      "brewHead": "Brew Head",
      "toTarget": "to target",
      "whatsHappening": "What's going to happen",
      "showDescription": "Profile description",
      "hideDescription": "Hide description"
    },
```

Translations to use (same keys, localized values):

- **sv**: `statusHeating`="Värmer upp", `statusReady`="Redo", `setTemp`="Måltemp", `timeToReady`="till lansen är redo", `estimatePrefix`="~", `slowsNearTarget`="Uppvärmningen saktar in nära målet för att undvika övervärme", `estimating`="Beräknar…", `tempGraphTitle`="Temperatur", `lanceReady`="Lans redo", `brewChamber`="Bryggkammare", `brewHead`="Brygghuvud", `toTarget`="till mål", `whatsHappening`="Vad som kommer att hända", `showDescription`="Profilbeskrivning", `hideDescription`="Dölj beskrivning"
- **de**: `statusHeating`="Aufheizen", `statusReady`="Bereit", `setTemp`="Solltemp.", `timeToReady`="bis Lanze bereit", `estimatePrefix`="~", `slowsNearTarget`="Das Aufheizen verlangsamt sich nahe dem Ziel, um Überhitzen zu vermeiden", `estimating`="Schätzung…", `tempGraphTitle`="Temperatur", `lanceReady`="Lanze bereit", `brewChamber`="Brühkammer", `brewHead`="Brühkopf", `toTarget`="bis Ziel", `whatsHappening`="Was als Nächstes passiert", `showDescription`="Profilbeschreibung", `hideDescription`="Beschreibung ausblenden"
- **es**: `statusHeating`="Calentando", `statusReady`="Listo", `setTemp`="Temp. objetivo", `timeToReady`="hasta lanza lista", `estimatePrefix`="~", `slowsNearTarget`="El calentamiento se ralentiza cerca del objetivo para evitar sobrecalentar", `estimating`="Estimando…", `tempGraphTitle`="Temperatura", `lanceReady`="Lanza lista", `brewChamber`="Cámara de preparación", `brewHead`="Cabezal", `toTarget`="al objetivo", `whatsHappening`="Lo que va a pasar", `showDescription`="Descripción del perfil", `hideDescription`="Ocultar descripción"
- **fr**: `statusHeating`="Chauffe", `statusReady`="Prêt", `setTemp`="Temp. cible", `timeToReady`="avant lance prête", `estimatePrefix`="~", `slowsNearTarget`="La chauffe ralentit près de la cible pour éviter le dépassement", `estimating`="Estimation…", `tempGraphTitle`="Température", `lanceReady`="Lance prête", `brewChamber`="Chambre d'infusion", `brewHead`="Tête d'infusion", `toTarget`="vers la cible", `whatsHappening`="Ce qui va se passer", `showDescription`="Description du profil", `hideDescription`="Masquer la description"
- **it**: `statusHeating`="Riscaldamento", `statusReady`="Pronto", `setTemp`="Temp. obiettivo", `timeToReady`="alla lancia pronta", `estimatePrefix`="~", `slowsNearTarget`="Il riscaldamento rallenta vicino all'obiettivo per evitare il superamento", `estimating`="Stima…", `tempGraphTitle`="Temperatura", `lanceReady`="Lancia pronta", `brewChamber`="Camera di infusione", `brewHead`="Testa di infusione", `toTarget`="all'obiettivo", `whatsHappening`="Cosa sta per succedere", `showDescription`="Descrizione del profilo", `hideDescription`="Nascondi descrizione"

- [ ] **Step 3: Validate JSON + key presence for all 6 locales**

Run:
```bash
for l in en sv de es fr it; do \
  node -e "const j=require('./apps/web/public/locales/$l/translation.json'); const h=j.controlCenter.heating; ['statusHeating','statusReady','setTemp','timeToReady','slowsNearTarget','estimating','tempGraphTitle','lanceReady','brewChamber','brewHead','toTarget','whatsHappening','showDescription','hideDescription'].forEach(k=>{if(!h||!h[k])throw new Error('$l missing '+k)}); console.log('$l ok')"; \
done
```
Expected: `en ok` … `it ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/locales/*/translation.json
git commit -m "i18n(live-view): add heating dashboard strings for all locales

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Build `HeatingDashboard` — header + hero countdown

Build the component incrementally. This task delivers the restyled header and the hero time-to-ready countdown; later tasks add the graph, numbers, and profile sections.

**Files:**
- Create: `apps/web/src/components/LiveShotView/HeatingDashboard.tsx`
- Test: `apps/web/src/components/LiveShotView/HeatingDashboard.test.tsx`

- [ ] **Step 1: Read the current pre-shot block to capture exact props/values**

Run: `sed -n '394,660p' apps/web/src/components/LiveShotView.tsx`
Note the variable names in scope for: current chamber/head temps, `target_temperature`, `preheat_countdown`, the `state`/`isReady` derivation, the readiness-easter-egg condition, and the Start/Abort handlers. These become `HeatingDashboard` props.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/LiveShotView/HeatingDashboard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatingDashboard } from './HeatingDashboard'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }: React.PropsWithChildren) => <div {...p}>{children}</div> }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// ProfileBreakdown is exercised in its own tests; stub it here.
vi.mock('@/components/ProfileBreakdown', () => ({
  ProfileBreakdown: () => <div data-testid="profile-breakdown" />,
}))

// Charts are canvas-heavy; stub the temperature chart.
vi.mock('./HeatingTempChart', () => ({
  HeatingTempChart: () => <div data-testid="heating-temp-chart" />,
}))

const baseProps = {
  isReady: false,
  profileName: 'Slow-Mo Blossom',
  setTemp: 93,
  chamberTemp: 70,
  headTemp: 68,
  lanceReadyCutoff: 92,
  preheatCountdown: null as number | null,
  samples: [] as { t: number; temp: number }[],
  profile: { id: 'p1' } as never,
  description: 'A gentle blooming profile.',
  startDisabled: false,
  onStart: vi.fn(),
  onAbort: vi.fn(),
}

describe('HeatingDashboard', () => {
  it('renders the heating status header with the set temp', () => {
    render(<HeatingDashboard {...baseProps} />)
    expect(screen.getByText('controlCenter.heating.statusHeating')).toBeInTheDocument()
    expect(screen.getByText(/93/)).toBeInTheDocument()
  })

  it('enables the Start button during heating', () => {
    render(<HeatingDashboard {...baseProps} />)
    const start = screen.getByRole('button', { name: /start/i })
    expect(start).toBeEnabled()
  })

  it('always shows an Abort control', () => {
    render(<HeatingDashboard {...baseProps} />)
    expect(screen.getByRole('button', { name: /abort/i })).toBeInTheDocument()
  })

  it('renders the profile breakdown by default', () => {
    render(<HeatingDashboard {...baseProps} />)
    expect(screen.getByTestId('profile-breakdown')).toBeInTheDocument()
  })

  it('shows "ready" status when isReady', () => {
    render(<HeatingDashboard {...baseProps} isReady />)
    expect(screen.getByText('controlCenter.heating.statusReady')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/HeatingDashboard.test.tsx`
Expected: FAIL — cannot resolve `./HeatingDashboard`.

- [ ] **Step 4: Implement the component (header + hero + actions + breakdown + collapsible description)**

Create `apps/web/src/components/LiveShotView/HeatingDashboard.tsx`. Use the app's existing `Button`/`Badge`/`Card` primitives and design tokens (no ad-hoc colors). Import `ProfileBreakdown` and the chart stub created in Task 5 (`HeatingTempChart`) and the numbers block from Task 6 (`HeatingNumbers`) — for this task you may temporarily render placeholders for those two and replace them in Tasks 5–6, **or** implement Tasks 5–6 first. To keep tests green now, render the breakdown and a placeholder for chart/numbers:

```tsx
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ProfileBreakdown } from '@/components/ProfileBreakdown'
import type { ProfileData } from '@/components/ProfileBreakdown'
import type { TempSample } from './estimateTimeToReady'
import { estimateTimeToReady } from './estimateTimeToReady'
import { HeatingTempChart } from './HeatingTempChart'
import { HeatingNumbers } from './HeatingNumbers'

export interface HeatingDashboardProps {
  isReady: boolean
  profileName: string
  setTemp: number
  chamberTemp: number
  headTemp: number
  lanceReadyCutoff: number
  /** Machine's own countdown (seconds) when provided; preferred over our model. */
  preheatCountdown: number | null
  samples: TempSample[]
  profile: ProfileData
  description?: string
  startDisabled: boolean
  onStart: () => void
  onAbort: () => void
}

function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function HeatingDashboard(props: HeatingDashboardProps) {
  const { t } = useTranslation()
  const [descOpen, setDescOpen] = useState(false)

  const modelEta = estimateTimeToReady({
    samples: props.samples,
    target: props.setTemp,
    cutoff: props.lanceReadyCutoff,
  })
  // Prefer the machine's own countdown when present; else our model.
  const etaSeconds =
    props.preheatCountdown != null && props.preheatCountdown > 0
      ? props.preheatCountdown
      : modelEta

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Restyled status header — slim pill, not the heavy orange card */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={props.isReady ? 'default' : 'secondary'}>
            {props.isReady
              ? t('controlCenter.heating.statusReady')
              : t('controlCenter.heating.statusHeating')}
          </Badge>
          <span className="text-sm font-medium text-foreground">{props.profileName}</span>
        </div>
        <span className="text-sm text-muted-foreground">
          {t('controlCenter.heating.setTemp')}: {props.setTemp}°C
        </span>
      </div>

      {/* 2. Hero time-to-ready countdown */}
      <div className="flex flex-col items-center py-4">
        <AnimatePresence mode="wait">
          {etaSeconds == null ? (
            <motion.span
              key="estimating"
              className="text-2xl font-semibold text-muted-foreground tabular-nums"
            >
              {t('controlCenter.heating.estimating')}
            </motion.span>
          ) : (
            <motion.span
              key="eta"
              className="text-5xl font-bold text-foreground tabular-nums"
            >
              {t('controlCenter.heating.estimatePrefix')}
              {formatMmSs(etaSeconds)}
            </motion.span>
          )}
        </AnimatePresence>
        <span className="text-sm text-muted-foreground mt-1">
          {t('controlCenter.heating.timeToReady')}
        </span>
        <span className="text-xs text-muted-foreground mt-1 text-center max-w-xs">
          {t('controlCenter.heating.slowsNearTarget')}
        </span>
      </div>

      {/* 3. Temperature graph with set + lance-ready target lines */}
      <HeatingTempChart
        samples={props.samples}
        setTemp={props.setTemp}
        lanceReadyCutoff={props.lanceReadyCutoff}
      />

      {/* 4. Numbers + progress-to-target with ready marker */}
      <HeatingNumbers
        chamberTemp={props.chamberTemp}
        headTemp={props.headTemp}
        setTemp={props.setTemp}
        lanceReadyCutoff={props.lanceReadyCutoff}
      />

      {/* 5. Profile breakdown — visible by default */}
      <div>
        <h3 className="text-sm font-medium mb-2 text-foreground">
          {t('controlCenter.heating.whatsHappening')}
        </h3>
        <ProfileBreakdown profile={props.profile} />
      </div>

      {/* 6. Collapsible profile description — hidden by default */}
      {props.description && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDescOpen((o) => !o)}
            aria-expanded={descOpen}
          >
            {descOpen
              ? t('controlCenter.heating.hideDescription')
              : t('controlCenter.heating.showDescription')}
          </Button>
          <AnimatePresence>
            {descOpen && (
              <motion.p className="text-sm text-muted-foreground mt-2">
                {props.description}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 7. Start (enabled) + Abort action row */}
      <div className="flex gap-3 pt-2">
        <Button className="flex-1" onClick={props.onStart} disabled={props.startDisabled}>
          {t('controlCenter.actions.start')}
        </Button>
        <Button variant="destructive" onClick={props.onAbort}>
          {t('controlCenter.actions.abort')}
        </Button>
      </div>
    </div>
  )
}
```

> The test stubs `./HeatingTempChart`, `./HeatingNumbers`, and `@/components/ProfileBreakdown`, so this task's tests pass before Tasks 5–6 exist. Confirm the real `ProfileData` type name exported by `apps/web/src/components/ProfileBreakdown.tsx` (the test mocked `profile` as `never`); adjust the import/type if it differs.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/HeatingDashboard.test.tsx`
Expected: PASS (5 tests). If `start`/`abort` accessible names don't match, confirm the `controlCenter.actions.start`/`abort` translations contain "Start"/"Abort" or relax the test regex.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/LiveShotView/HeatingDashboard.tsx \
        apps/web/src/components/LiveShotView/HeatingDashboard.test.tsx
git commit -m "feat(live-view): heating dashboard header, hero countdown, actions

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Build `HeatingTempChart` (temperature graph with target lines)

**Files:**
- Create: `apps/web/src/components/LiveShotView/HeatingTempChart.tsx`
- Test: `apps/web/src/components/LiveShotView/HeatingTempChart.test.tsx`

- [ ] **Step 1: Inspect the existing chart API**

Run: `sed -n '1,60p' apps/web/src/components/charts/chartConstants.ts` and `grep -rn "export" apps/web/src/components/charts/index.ts`
Identify how `EspressoChart` (imported in `LiveShotView.tsx`) accepts series and horizontal reference/target lines (`ProfileTargetPoint`). Reuse it rather than introducing a new chart library.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/LiveShotView/HeatingTempChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatingTempChart } from './HeatingTempChart'

// Stub the underlying chart so we test data mapping, not canvas rendering.
vi.mock('@/components/charts', () => ({
  EspressoChart: (props: Record<string, unknown>) => (
    <div data-testid="chart" data-series-count={String((props.series as unknown[])?.length ?? 0)} />
  ),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

describe('HeatingTempChart', () => {
  it('passes two temperature series (chamber + head) to the chart', () => {
    render(
      <HeatingTempChart
        samples={[{ t: 0, temp: 20 }, { t: 2, temp: 30 }]}
        setTemp={93}
        lanceReadyCutoff={92}
      />
    )
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-count', '2')
  })
})
```

> If the existing `EspressoChart` prop shape differs (e.g. it takes a single `data` array of points with named keys rather than a `series` array), adapt both the mock and the assertion to that real API discovered in Step 1. The test must assert the real mapping you implement.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/HeatingTempChart.test.tsx`
Expected: FAIL — cannot resolve `./HeatingTempChart`.

- [ ] **Step 4: Implement the chart wrapper**

Create `apps/web/src/components/LiveShotView/HeatingTempChart.tsx`. Map `samples` (the rolling window) into the chart's series for chamber and head, and render dashed horizontal target lines at `setTemp` and `lanceReadyCutoff`. Use the per-sensor color identity shared with the numbers block (define the two colors once in a small shared module, e.g. `heatingColors.ts`, and import in both). Use the real `EspressoChart` API discovered in Step 1. Example skeleton (adapt prop names to the real API):

```tsx
import { useTranslation } from 'react-i18next'
import { EspressoChart } from '@/components/charts'
import type { TempSample } from './estimateTimeToReady'
import { CHAMBER_COLOR, HEAD_COLOR } from './heatingColors'

interface HeatingTempChartProps {
  samples: TempSample[]
  setTemp: number
  lanceReadyCutoff: number
}

export function HeatingTempChart({ samples, setTemp, lanceReadyCutoff }: HeatingTempChartProps) {
  const { t } = useTranslation()

  const chamberSeries = samples.map((s) => ({ x: s.t, y: s.temp }))
  // Head series uses the head sensor; until per-sensor samples are wired, this
  // component receives a single `samples` window for the cutoff sensor. To plot
  // both, change `samples` into `{ chamber, head }` and split here.
  const series = [
    { name: t('controlCenter.heating.brewChamber'), color: CHAMBER_COLOR, data: chamberSeries },
    { name: t('controlCenter.heating.brewHead'), color: HEAD_COLOR, data: [] as { x: number; y: number }[] },
  ]

  return (
    <EspressoChart
      series={series}
      targetLines={[
        { value: setTemp, label: t('controlCenter.heating.setTemp'), dashed: true },
        { value: lanceReadyCutoff, label: t('controlCenter.heating.lanceReady'), dashed: true },
      ]}
    />
  )
}
```

> **Decision to resolve during Step 1:** the `useHeatingSamples` hook currently tracks one sensor. To draw both chamber and head curves, either (a) extend `useHeatingSamples` to accept and store both temps per sample (`{ t, chamber, head }`), updating `estimateTimeToReady` to read `chamber`/the cutoff sensor; or (b) run two `useHeatingSamples` instances. Prefer (a): change `TempSample` consumers minimally by keeping `temp` as the cutoff sensor and adding an optional `head` field. Update the chart, hook, and their tests accordingly so the two-series assertion reflects real data. Keep the estimator keyed on the cutoff sensor only.

- [ ] **Step 5: Create the shared color module**

Create `apps/web/src/components/LiveShotView/heatingColors.ts`:

```ts
// Per-sensor color identity shared by the heating graph and numbers blocks.
// Use existing app chart palette values rather than new ad-hoc hex where possible.
export const CHAMBER_COLOR = 'var(--chart-1, #e8794a)'
export const HEAD_COLOR = 'var(--chart-2, #4a90e8)'
```

> Replace the fallbacks with the project's actual chart token names discovered in Step 1 (`chartConstants.ts` / CSS variables). Do not invent colors if tokens exist.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/HeatingTempChart.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/LiveShotView/HeatingTempChart.tsx \
        apps/web/src/components/LiveShotView/HeatingTempChart.test.tsx \
        apps/web/src/components/LiveShotView/heatingColors.ts
git commit -m "feat(live-view): heating temperature chart with target lines

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Build `HeatingNumbers` (values + progress-to-target with ready marker)

**Files:**
- Create: `apps/web/src/components/LiveShotView/HeatingNumbers.tsx`
- Test: `apps/web/src/components/LiveShotView/HeatingNumbers.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/LiveShotView/HeatingNumbers.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatingNumbers } from './HeatingNumbers'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }: React.PropsWithChildren) => <div {...p}>{children}</div> }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

describe('HeatingNumbers', () => {
  it('shows chamber and head temperatures', () => {
    render(
      <HeatingNumbers chamberTemp={70} headTemp={68} setTemp={93} lanceReadyCutoff={92} />
    )
    expect(screen.getByText(/70/)).toBeInTheDocument()
    expect(screen.getByText(/68/)).toBeInTheDocument()
  })

  it('renders a progress bar with a ready-cutoff marker', () => {
    render(
      <HeatingNumbers chamberTemp={70} headTemp={68} setTemp={93} lanceReadyCutoff={92} />
    )
    expect(screen.getByTestId('ready-marker')).toBeInTheDocument()
  })

  it('shows the delta-to-target using design tokens (no inline color hex)', () => {
    const { container } = render(
      <HeatingNumbers chamberTemp={70} headTemp={68} setTemp={93} lanceReadyCutoff={92} />
    )
    // Δ readout present
    expect(screen.getByTestId('delta-readout')).toBeInTheDocument()
    // No ad-hoc hex colors in inline styles
    expect(container.innerHTML).not.toMatch(/style="[^"]*#[0-9a-fA-F]{6}/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/HeatingNumbers.test.tsx`
Expected: FAIL — cannot resolve `./HeatingNumbers`.

- [ ] **Step 3: Implement the numbers block**

Create `apps/web/src/components/LiveShotView/HeatingNumbers.tsx`. Render chamber + head values, a progress bar from a sensible baseline to `setTemp`, a marker at the `lanceReadyCutoff` position, and a Δ-to-target readout styled with Tailwind/design tokens (e.g. `text-muted-foreground`, `text-primary`) — **no inline hex colors**:

```tsx
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { CHAMBER_COLOR, HEAD_COLOR } from './heatingColors'

interface HeatingNumbersProps {
  chamberTemp: number
  headTemp: number
  setTemp: number
  lanceReadyCutoff: number
}

const BASELINE = 20 // ambient start for progress scaling

function pct(value: number, setTemp: number): number {
  const span = setTemp - BASELINE
  if (span <= 0) return 0
  return Math.min(100, Math.max(0, ((value - BASELINE) / span) * 100))
}

export function HeatingNumbers({ chamberTemp, headTemp, setTemp, lanceReadyCutoff }: HeatingNumbersProps) {
  const { t } = useTranslation()
  const readyMarkerPct = pct(lanceReadyCutoff, setTemp)
  const delta = setTemp - chamberTemp

  return (
    <div className="flex flex-col gap-3">
      {([
        { label: t('controlCenter.heating.brewChamber'), value: chamberTemp, color: CHAMBER_COLOR },
        { label: t('controlCenter.heating.brewHead'), value: headTemp, color: HEAD_COLOR },
      ]).map((row) => (
        <div key={row.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">{row.label}</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {row.value.toFixed(1)}°C
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${pct(row.value, setTemp)}%`, backgroundColor: row.color }}
            />
            <div
              data-testid="ready-marker"
              className="absolute inset-y-0 w-0.5 bg-foreground/60"
              style={{ left: `${readyMarkerPct}%` }}
            />
          </div>
        </div>
      ))}
      <div data-testid="delta-readout" className="text-sm text-muted-foreground">
        Δ {delta.toFixed(1)}°C {t('controlCenter.heating.toTarget')}
      </div>
    </div>
  )
}
```

> The `ready-marker` and progress fill use `backgroundColor` from the shared color tokens (CSS vars), not inline hex; the delta test forbids inline 6-digit hex. The color module fallbacks may contain hex — keep them as CSS-var-first (`var(--chart-1, …)`) so the rendered inline style is the CSS-var reference, not a bare hex. If the test's hex regex still trips on the fallback, move the colors entirely into Tailwind utility classes / CSS variables and drop inline `style` colors.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun run test -- src/components/LiveShotView/HeatingNumbers.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/LiveShotView/HeatingNumbers.tsx \
        apps/web/src/components/LiveShotView/HeatingNumbers.test.tsx
git commit -m "feat(live-view): heating numbers with progress and ready marker

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Wire `HeatingDashboard` into `LiveShotView` and hide pre-shot noise

**Files:**
- Modify: `apps/web/src/components/LiveShotView.tsx` (pre-shot block ~394–660; metric rows ~505–530)

- [ ] **Step 1: Re-read the gating + surrounding code**

Run: `sed -n '380,665p' apps/web/src/components/LiveShotView.tsx`
Confirm: the gate `!ms.brewing && chartData.length === 0`, the readiness derivation (`isReady`), the easter-egg condition, the Start/Abort handlers (`useMachineActions`), how the active profile object + name + description are obtained, and where the Time/Pressure/Flow tiles + shot graph render.

- [ ] **Step 2: Add the sample hook + imports**

Near the top of `LiveShotView` imports, add:

```tsx
import { HeatingDashboard } from './LiveShotView/HeatingDashboard'
import { useHeatingSamples } from './LiveShotView/useHeatingSamples'
```

Inside the component body, derive heating state and accumulate samples (use the same sensor the readiness easter egg compares — typically the boiler/brew-chamber temp):

```tsx
const isHeatingPhase = !ms.brewing && chartData.length === 0
const heatingSamples = useHeatingSamples({
  temp: /* the cutoff sensor, e.g. */ boilerTemp,
  active: isHeatingPhase && !isReady,
})
const lanceReadyCutoff = targetTemp - TEMP_ON_TARGET_THRESHOLD
```

Use the actual local variable names found in Step 1 for `boilerTemp`, `targetTemp`, `isReady`, and import `TEMP_ON_TARGET_THRESHOLD` from its existing module (do not redefine).

- [ ] **Step 3: Replace the inline pre-shot block with `HeatingDashboard`**

Replace the entire pre-shot block (the HEATING card + READY card + the reused Time/Pressure/Flow tiles + shot graph that render under the `isHeatingPhase` gate) with:

```tsx
{isHeatingPhase ? (
  <HeatingDashboard
    isReady={isReady}
    profileName={profileName}
    setTemp={targetTemp}
    chamberTemp={boilerTemp}
    headTemp={brewHeadTemp}
    lanceReadyCutoff={lanceReadyCutoff}
    preheatCountdown={preheatCountdown ?? null}
    samples={heatingSamples}
    profile={activeProfile}
    description={profileDescription}
    startDisabled={false}
    onStart={handleStart}
    onAbort={handleAbort}
  />
) : (
  /* existing running-shot layout — unchanged */
)}
```

Map each prop to the real variable discovered in Step 1 (`profileName`, `brewHeadTemp`, `preheatCountdown`, `activeProfile`, `profileDescription`, `handleStart`, `handleAbort`). **Do not** render the Time/Pressure/Flow tiles or shot graph inside the `isHeatingPhase` branch — they belong only to the running-shot branch.

- [ ] **Step 4: Preserve the readiness easter egg**

Confirm the "Lance's standard" easter egg still fires at the cutoff. If its trigger lived in the old READY card you removed, move the trigger logic so it still evaluates when `chamberTemp`/cutoff cross (either inside `HeatingDashboard` via the `isReady` prop, or kept in `LiveShotView`). Verify by reading the easter-egg code found in Step 1 and ensuring the same condition path remains reachable.

- [ ] **Step 5: Lint + type-check**

Run: `cd apps/web && bun run lint`
Expected: no new errors. Remove any now-unused imports/locals from the deleted inline block (e.g. unused tile components, `getTempTileDisplay` if no longer referenced anywhere).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/LiveShotView.tsx
git commit -m "feat(live-view): render HeatingDashboard during heating/ready phase

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Update/verify the existing LiveShotView tests

**Files:**
- Modify (if needed): `apps/web/src/components/LiveShotView.tempTile.test.ts`

- [ ] **Step 1: Run the existing temp-tile test**

Run: `cd apps/web && bun run test -- src/components/LiveShotView.tempTile.test.ts`
Expected: It tests `getTempTileDisplay` (#482). If that helper still exists and is used by the running-shot view, the test should still pass. If you removed `getTempTileDisplay` because the heating Δ tile no longer uses it (replaced by `HeatingNumbers`), but it is still used elsewhere, keep it. Only delete the test if the function is genuinely removed.

- [ ] **Step 2: Reconcile**

If the helper was removed: delete `LiveShotView.tempTile.test.ts` and the helper together in the same commit; otherwise leave both. Confirm with:
Run: `grep -rn "getTempTileDisplay" apps/web/src`

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add -A
git commit -m "test(live-view): reconcile temp-tile test after heating dashboard

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the full web test suite**

Run: `cd apps/web && bun run test:run`
Expected: all pass, including the new estimator, hook, and component tests.

- [ ] **Step 2: Lint**

Run: `cd apps/web && bun run lint`
Expected: clean.

- [ ] **Step 3: Build**

Run: `cd apps/web && bun run build`
Expected: success (validates all new component prop shapes + the real `EspressoChart`/`ProfileBreakdown`/telemetry types).

- [ ] **Step 4: Manual smoke (with a machine or mock telemetry)**

In the heating phase, verify:
- Restyled slim header (pill + profile name + set temp), not the heavy orange card.
- Hero time-to-ready shows `~m:ss`, hidden/"Estimating…" until enough samples, never wildly large.
- Temp graph shows chamber/head rising toward dashed set + lance-ready lines.
- Numbers + progress bars with a ready-cutoff marker; Δ uses app tokens (no ad-hoc colors).
- ProfileBreakdown visible; description collapsed by default, toggles open.
- Start is **enabled**; Abort present.
- Time / pressure / flow / shot-graph are **not** shown during heating.
- When the cutoff is crossed, status flips to "Ready" and the "Lance's standard" easter egg still fires.
- Start a shot → running-shot layout is unchanged.

- [ ] **Step 5: Final commit (only if Step 4 required fixes)**

```bash
git add -A
git commit -m "fix(live-view): polish heating dashboard after manual smoke test

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Acceptance criteria (from spec)

- [ ] Heating/ready view shows: restyled header, hero time-to-ready, temp graph with set + ready target lines, numbers + progress with ready marker, ProfileBreakdown (visible), collapsible description, Start (enabled) + Abort.
- [ ] Time / pressure / flow / shot-graph are hidden during heating/ready.
- [ ] Time-to-ready uses an asymptotic (Newtonian) model targeting the lance-ready cutoff and degrades gracefully (no wild estimates, hidden until stable; prefers machine `preheat_countdown` when present).
- [ ] Δ styling uses app design tokens (no ad-hoc colors).
- [ ] Readiness "Lance's standard" easter egg still fires at the cutoff.
- [ ] Tests added; i18n complete for all 6 locales.

## Notes on scope & parity

- **Dual-runtime parity (Quality Gate #7):** not applicable — this is presentation logic in `apps/web` with no `apps/server` service counterpart. The estimator is UI-only.
- **Out of scope:** any change to the running-shot (brewing) layout beyond hiding/showing the right blocks per phase; new telemetry fields.
- **Open implementation decision (resolve in Task 5 Step 4):** whether `useHeatingSamples` stores one sensor or both (`{ t, temp, head }`). Recommended: store both, keep the estimator keyed on the cutoff sensor, so the graph can draw both curves with real data.
