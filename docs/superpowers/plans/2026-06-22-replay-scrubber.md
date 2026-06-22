# Replay Scrubber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated draggable scrubber to the shot-replay transport controls (Replay + Compare tabs) so users can seek without their finger occluding the chart curves/legend.

**Architecture:** Introduce a small reusable `ReplayScrubber` presentational component that wraps the existing Radix-based `Slider` UI primitive (which already provides a draggable thumb, click-to-seek, touch, keyboard, and ARIA slider semantics). It is driven entirely by the existing `useReplayAnimation` API (`currentTime` + `setCurrentTime`), with `onScrubStart`/`onScrubEnd` callbacks that pause playback during a drag and resume it afterward if it was playing. The click-only progress-bar `div` in `ShotDetail.tsx` is replaced by `ReplayScrubber` in both the Replay (`mainReplay`) and Compare (`compReplay`) tabs. On-graph tap/drag is left untouched.

**Tech Stack:** React + TypeScript, Radix UI Slider (`@/components/ui/slider`), framer-motion (existing), react-i18next, Vitest + @testing-library/react.

**Issue:** #493 · **Milestone:** 2.6 · **Spec:** `docs/superpowers/specs/2026-06-22-replay-scrubber-design.md`

---

## Conventions (read once before starting)

- **Branch:** Work on `version/2.6.0` (already checked out). Create a feature branch `feat/replay-scrubber` off it if you prefer isolation; otherwise commit directly to `version/2.6.0`.
- **Commits:** Conventional Commits. Every commit message MUST end with the trailer:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
- **i18n:** Every user-facing string goes through `t()` and MUST exist in all 6 locales: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`.
- **Tests:** Run from `apps/web`:
  - Single file: `bun run test -- src/components/ShotHistoryView/ReplayScrubber.test.tsx`
  - Full run: `bun run test:run`
  - Lint: `bun run lint`
- **Existing test pattern** (see `apps/web/src/components/ProfileBreakdown.test.tsx`): mock `framer-motion` and `react-i18next` at the top of the test file; use `render`/`screen` from `@testing-library/react`.

## File structure

- **Create** `apps/web/src/components/ShotHistoryView/ReplayScrubber.tsx` — the reusable scrubber (wraps `Slider`, owns pause/resume-on-drag handling via callbacks). One responsibility: turn `value`/`max` + interaction into `onChange` calls and signal scrub start/end.
- **Create** `apps/web/src/components/ShotHistoryView/ReplayScrubber.test.tsx` — unit tests.
- **Modify** `apps/web/src/components/ShotHistoryView/ShotDetail.tsx` — replace the click-only progress bar in the Replay block (~775–799) and the Compare block (~916–940) with `ReplayScrubber`; wire `onScrubStart`/`onScrubEnd` to pause/resume.
- **Modify** `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json` — add `shotHistory.scrubber` aria-label key.

---

### Task 1: Create the `ReplayScrubber` component

**Files:**
- Create: `apps/web/src/components/ShotHistoryView/ReplayScrubber.tsx`
- Test: `apps/web/src/components/ShotHistoryView/ReplayScrubber.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ShotHistoryView/ReplayScrubber.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReplayScrubber } from './ReplayScrubber'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('ReplayScrubber', () => {
  it('renders an ARIA slider reflecting value and max', () => {
    render(<ReplayScrubber value={5} max={20} onChange={() => {}} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '5')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '20')
  })

  it('shows the elapsed / total time readout', () => {
    render(<ReplayScrubber value={3.2} max={12.5} onChange={() => {}} />)
    expect(screen.getByText('3.2s')).toBeInTheDocument()
    expect(screen.getByText('12.5s')).toBeInTheDocument()
  })

  it('calls onChange with a clamped value when seeking via keyboard', () => {
    const onChange = vi.fn()
    render(<ReplayScrubber value={0} max={10} onChange={onChange} />)
    const slider = screen.getByRole('slider')
    slider.focus()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalled()
    const v = onChange.mock.calls[0][0]
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(10)
  })

  it('fires onScrubStart on pointer down and onScrubEnd on commit', () => {
    const onScrubStart = vi.fn()
    const onScrubEnd = vi.fn()
    render(
      <ReplayScrubber
        value={2}
        max={10}
        onChange={() => {}}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
    )
    const slider = screen.getByRole('slider')
    fireEvent.pointerDown(slider)
    expect(onScrubStart).toHaveBeenCalledTimes(1)
    // Radix commits the value on pointer up
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onScrubEnd).toHaveBeenCalled()
  })

  it('renders nothing meaningful (disabled) when max is 0', () => {
    render(<ReplayScrubber value={0} max={0} onChange={() => {}} />)
    expect(screen.getByRole('slider')).toHaveAttribute('data-disabled')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun run test -- src/components/ShotHistoryView/ReplayScrubber.test.tsx`
Expected: FAIL — `Failed to resolve import './ReplayScrubber'`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/ShotHistoryView/ReplayScrubber.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Slider } from '@/components/ui/slider'

interface ReplayScrubberProps {
  /** Current playback position in seconds. */
  value: number
  /** Maximum playable time in seconds. */
  max: number
  /** Called with the new position (seconds, clamped to [0, max]). */
  onChange: (t: number) => void
  /** Called when the user begins interacting (pointer down / key down). */
  onScrubStart?: () => void
  /** Called when the user finishes interacting (pointer up / value commit). */
  onScrubEnd?: () => void
  disabled?: boolean
}

const STEP = 0.1

export function ReplayScrubber({
  value,
  max,
  onChange,
  onScrubStart,
  onScrubEnd,
  disabled,
}: ReplayScrubberProps) {
  const { t } = useTranslation()
  const clamped = Math.min(Math.max(value, 0), max || 0)

  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
        {clamped.toFixed(1)}s
      </span>
      <Slider
        aria-label={t('shotHistory.scrubber')}
        value={[clamped]}
        min={0}
        max={max || 0}
        step={STEP}
        disabled={disabled || max <= 0}
        className="flex-1"
        onPointerDown={() => onScrubStart?.()}
        onValueChange={(values) => {
          onScrubStart?.()
          onChange(Math.min(Math.max(values[0], 0), max))
        }}
        onValueCommit={() => onScrubEnd?.()}
      />
      <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
        {(max || 0).toFixed(1)}s
      </span>
    </div>
  )
}
```

> Note: Radix `Slider` calls `onValueChange` for both pointer drags and keyboard steps, and `onValueCommit` when the interaction ends (pointer up / blur). Calling `onScrubStart` inside `onValueChange` is idempotent for our use (pausing an already-paused animation is a no-op), so keyboard stepping also pauses-then-resumes correctly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun run test -- src/components/ShotHistoryView/ReplayScrubber.test.tsx`
Expected: PASS (5 tests). If the `data-disabled` assertion fails, confirm the Radix Slider sets `data-disabled` on the thumb when `disabled` — adjust the selector to `screen.getByRole('slider')`'s container if needed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ShotHistoryView/ReplayScrubber.tsx \
        apps/web/src/components/ShotHistoryView/ReplayScrubber.test.tsx
git commit -m "feat(shot-history): add reusable ReplayScrubber component

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Add the `shotHistory.scrubber` i18n key to all 6 locales

**Files:**
- Modify: `apps/web/public/locales/en/translation.json`
- Modify: `apps/web/public/locales/sv/translation.json`
- Modify: `apps/web/public/locales/de/translation.json`
- Modify: `apps/web/public/locales/es/translation.json`
- Modify: `apps/web/public/locales/fr/translation.json`
- Modify: `apps/web/public/locales/it/translation.json`

- [ ] **Step 1: Locate the `shotHistory` block**

Run: `grep -n '"replay"' apps/web/public/locales/en/translation.json`
This shows the existing `shotHistory` object (it already contains `replay`, `compare`, `restart`). Add the new key alongside.

- [ ] **Step 2: Add the key in each locale**

Add a `"scrubber"` member to the existing `"shotHistory"` object in each file. Use these exact translations:

- `en`: `"scrubber": "Playback position",`
- `sv`: `"scrubber": "Uppspelningsläge",`
- `de`: `"scrubber": "Wiedergabeposition",`
- `es`: `"scrubber": "Posición de reproducción",`
- `fr`: `"scrubber": "Position de lecture",`
- `it`: `"scrubber": "Posizione di riproduzione",`

Example (en), inserting after the existing `"replay"` line inside `"shotHistory"`:

```json
    "replay": "Replay",
    "scrubber": "Playback position",
```

- [ ] **Step 3: Verify JSON validity for all 6 files**

Run:
```bash
for l in en sv de es fr it; do \
  node -e "JSON.parse(require('fs').readFileSync('apps/web/public/locales/$l/translation.json','utf8')); console.log('$l ok')"; \
done
```
Expected: `en ok` … `it ok` (no parse errors).

- [ ] **Step 4: Verify the key resolves in each locale**

Run:
```bash
for l in en sv de es fr it; do \
  node -e "const j=require('./apps/web/public/locales/$l/translation.json'); if(!j.shotHistory.scrubber) throw new Error('missing $l'); console.log('$l', j.shotHistory.scrubber)"; \
done
```
Expected: each locale prints its translation.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/locales/*/translation.json
git commit -m "i18n(shot-history): add scrubber aria-label key for all locales

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Replace the Replay-tab progress bar with `ReplayScrubber`

**Files:**
- Modify: `apps/web/src/components/ShotHistoryView/ShotDetail.tsx` (Replay block ~775–799; controls ~801–831)

- [ ] **Step 1: Read the current Replay progress-bar + controls block**

Run: `sed -n '770,835p' apps/web/src/components/ShotHistoryView/ShotDetail.tsx`
Identify the `mainMaxTime > 0` wrapper containing: the click-only progress `div` (with `onClick` → `mainReplay.setCurrentTime`), the `motion.div` fill, the `currentTime`/`maxTime` readout, and the transport controls (Restart · Play/Pause · speed `Select`). Note the exact variable names in scope (`mainReplay`, `mainMaxTime`).

- [ ] **Step 2: Import `ReplayScrubber`**

Near the other local imports (the `import { useReplayAnimation } from './useReplayAnimation'` line ~61), add:

```tsx
import { ReplayScrubber } from './ReplayScrubber'
```

- [ ] **Step 3: Replace the click-only progress `div` with `ReplayScrubber`**

In the Replay block, replace the progress-bar `div` + its `motion.div` fill + the inline time readout (the part that currently handles `onClick` → `mainReplay.setCurrentTime(percent * mainMaxTime)`) with:

```tsx
<ReplayScrubber
  value={mainReplay.currentTime}
  max={mainMaxTime}
  onChange={(t) => mainReplay.setCurrentTime(t)}
  onScrubStart={() => {
    wasPlayingBeforeScrubRef.current = mainReplay.isPlaying
    mainReplay.setIsPlaying(false)
  }}
  onScrubEnd={() => {
    if (wasPlayingBeforeScrubRef.current) mainReplay.setIsPlaying(true)
  }}
/>
```

Keep the existing transport controls (Restart · Play/Pause · speed `Select`) exactly as they are — only the progress bar/readout is replaced (the readout now lives inside `ReplayScrubber`).

- [ ] **Step 4: Add the `wasPlayingBeforeScrubRef` ref**

`useRef` is already imported (line 1). Near the top of the `ShotDetail` component body (alongside the other `useRef`/`useReplayAnimation` declarations), add a ref shared by both tabs:

```tsx
const wasPlayingBeforeScrubRef = useRef(false)
```

> A single ref is safe: only one tab is interactive at a time, and the ref is read synchronously within a single scrub start→end gesture before the other tab can be touched.

- [ ] **Step 5: Verify lint + type check**

Run: `cd apps/web && bun run lint`
Expected: no new errors. Resolve any "unused variable" warnings if the old `percent`/click handler left dangling locals — remove them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ShotHistoryView/ShotDetail.tsx
git commit -m "feat(shot-history): use draggable ReplayScrubber in Replay tab

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Replace the Compare-tab progress bar with `ReplayScrubber`

**Files:**
- Modify: `apps/web/src/components/ShotHistoryView/ShotDetail.tsx` (Compare block ~916–940)

- [ ] **Step 1: Read the Compare progress-bar block**

Run: `sed -n '910,965p' apps/web/src/components/ShotHistoryView/ShotDetail.tsx`
Identify the `comparisonMaxTime > 0` wrapper: click-only `div` (`onClick` → `compReplay.setCurrentTime(percent * comparisonMaxTime)`), `motion.div` fill (`compReplay.currentTime / comparisonMaxTime`), readout, then Play/Pause + speed `Select`.

- [ ] **Step 2: Replace the Compare progress `div` with `ReplayScrubber`**

Replace the Compare progress-bar `div` + fill + readout with:

```tsx
<ReplayScrubber
  value={compReplay.currentTime}
  max={comparisonMaxTime}
  onChange={(t) => compReplay.setCurrentTime(t)}
  onScrubStart={() => {
    wasPlayingBeforeScrubRef.current = compReplay.isPlaying
    compReplay.setIsPlaying(false)
  }}
  onScrubEnd={() => {
    if (wasPlayingBeforeScrubRef.current) compReplay.setIsPlaying(true)
  }}
/>
```

Leave the Compare transport controls (Play/Pause + speed `Select`) untouched.

- [ ] **Step 3: Verify lint**

Run: `cd apps/web && bun run lint`
Expected: no new errors; remove any now-dead click-handler locals in the Compare block.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ShotHistoryView/ShotDetail.tsx
git commit -m "feat(shot-history): use draggable ReplayScrubber in Compare tab

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run the full web test suite**

Run: `cd apps/web && bun run test:run`
Expected: all tests pass, including the new `ReplayScrubber.test.tsx`.

- [ ] **Step 2: Lint the whole web app**

Run: `cd apps/web && bun run lint`
Expected: clean.

- [ ] **Step 3: Type-check / build sanity**

Run: `cd apps/web && bun run build`
Expected: build succeeds (catches any TS prop-shape mismatch between `ReplayScrubber` and its call sites).

- [ ] **Step 4: Manual smoke (if a dev server is available)**

Run the web dev server, open a shot's detail → Replay tab. Verify:
- The scrubber has a visible draggable handle within the transport controls.
- Dragging the handle seeks; playback pauses during the drag and resumes if it was playing.
- Clicking on the track jumps to that position.
- On-graph tap/drag still seeks (unchanged).
- Keyboard: focus the handle, ←/→ steps, Home/End jump.
- Repeat on the Compare tab.

- [ ] **Step 5: Final commit (only if Step 4 required a fix)**

```bash
git add -A
git commit -m "fix(shot-history): polish replay scrubber after manual smoke test

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Acceptance criteria (from spec)

- [ ] A draggable handle scrubber sits within the replay transport controls.
- [ ] Dragging the scrubber seeks without covering the graph curves/legend.
- [ ] Click-to-seek on the track still works; on-graph tap/drag still works.
- [ ] Works in both Replay and Compare tabs.
- [ ] Keyboard + ARIA accessible (provided by Radix Slider + `aria-label`).
- [ ] Tests added; i18n complete for all 6 locales.

## Notes on scope

- No change to `useReplayAnimation.ts` is required — the existing `currentTime`/`setCurrentTime`/`isPlaying`/`setIsPlaying` API is sufficient.
- No new speed control or frame-stepping buttons (out of scope; arrow-key stepping covers the keyboard case).
- Dual-runtime parity (Quality Gate #7) does **not** apply — this is web-only replay UI with no `apps/server` counterpart.
