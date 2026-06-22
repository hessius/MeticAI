# Replay Scrubber — Design

**Date:** 2026-06-22
**Milestone:** 2.6
**Status:** Approved (brainstorming)

## Problem

In the shot history detail Replay tab, playback position can be changed by
tapping/dragging directly on the replay graph. While scrubbing on the graph the
user's finger covers the curves and legend, hiding exactly the data they are
trying to inspect. There is already a progress bar below the chart, but it is
**click-only** — there is no draggable handle, so users fall back to scrubbing on
the graph itself.

## Goal

Provide a dedicated, draggable scrubber **outside the graph area**, integrated
into the existing playback controls, so users can seek without occluding the
chart. On-graph tap/drag is retained as a secondary affordance.

## Current state (code)

- `apps/web/src/components/ShotHistoryView/ShotDetail.tsx`
  - Progress bar (`mainMaxTime > 0` block, ~lines 775–799): a `div` track with an
    `onClick` that maps click-x → `mainReplay.setCurrentTime(percent * mainMaxTime)`.
    A `motion.div` renders the fill. **No drag, no handle.**
  - Playback controls (~lines 801–831): Restart, Play/Pause, and a speed `Select`.
- `apps/web/src/components/ShotHistoryView/useReplayAnimation.ts`
  - Returns `isPlaying`, `currentTime`, `playbackSpeed`, `setCurrentTime`,
    `setIsPlaying`, `setPlaybackSpeed`, `handlePlayPause`, `handleRestart`.
  - The animation loop advances `currentTime` toward `maxTime` while playing.
- The same controls exist for the **Compare** tab via a second `useReplayAnimation`
  (`compReplay`) and `comparisonMaxTime`.

## Design

Replace the click-only progress bar with a reusable **`ReplayScrubber`** control:

- A slider track with a **visible draggable handle (thumb)**.
- Pointer drag support (mouse + touch) using pointer events so dragging works on
  the slider without touching the graph. While dragging, playback pauses (resumes
  prior state on release if it was playing — or stays paused; see Decisions).
- Click/tap anywhere on the track still jumps to that position (preserves current
  behaviour).
- Keeps the existing elapsed / total time readout (`currentTime` / `maxTime`).
- Lives **with the other transport controls** (Restart · Play/Pause · Scrubber ·
  Speed) so the playback UI is a single cohesive cluster.
- Driven entirely by the existing `useReplayAnimation` API
  (`currentTime` + `setCurrentTime`); no new state model required.
- **On-graph tap/drag is kept** as-is (secondary affordance).

### Component shape (proposed)

`ReplayScrubber` props:
- `value: number` (currentTime)
- `max: number` (maxTime)
- `onChange: (t: number) => void`
- `onScrubStart?` / `onScrubEnd?` (to pause/resume playback)
- `disabled?: boolean`

Used by both `mainReplay` and `compReplay`, so the Compare tab benefits too.

### Accessibility

- Render as an ARIA slider (`role="slider"`, `aria-valuemin/max/now`,
  `aria-label`), keyboard-navigable (←/→ to step, Home/End to jump). Matches the
  app's recent a11y pass.

## Decisions

- **Keep on-graph scrubbing AND add the external scrubber** (both affordances).
- **Integrate the slider into the existing controls** (not a separate floating bar).
- While dragging the scrubber, **pause** the animation; on release, **resume** if
  it was playing before the drag (feels natural for frame inspection).

## Out of scope

- Speed control changes (already exists).
- Frame-by-frame stepping buttons (could be a follow-up; arrow-key stepping covers
  the keyboard case).

## Testing

- Unit: `ReplayScrubber` maps pointer/keyboard interactions to correct `onChange`
  values (clamped to `[0, max]`); pause-on-drag / resume-on-release logic.
- Regression: existing click-to-seek behaviour preserved; Compare tab scrubber
  works with `compReplay`.
- i18n: any new labels/titles use `t()` across all 6 locales.

## Acceptance criteria

- [ ] A draggable handle scrubber sits within the replay transport controls.
- [ ] Dragging the scrubber seeks without covering the graph curves/legend.
- [ ] Click-to-seek on the track still works; on-graph tap/drag still works.
- [ ] Works in both Replay and Compare tabs.
- [ ] Keyboard + ARIA accessible.
- [ ] Tests added; i18n complete for all 6 locales.
