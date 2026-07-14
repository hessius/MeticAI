# Reinvented Heating / Ready Live View — Design

**Date:** 2026-06-22
**Milestone:** 2.6
**Issue:** #494
**Status:** Approved (brainstorming)

## Problem

During the **heating** and **ready** phases (before a shot starts), the live view
mostly reuses the running-shot layout, so the screen is dominated by data that is
meaningless pre-shot: the **time**, **pressure** and **flow** cards read 0, the
shot graph is empty, and weight tares at shot start. The one genuinely useful
thing — how hot the machine is and how long until it's ready — is reduced to a
couple of tiles and a delta value whose ad-hoc color coding looks out of place
versus the rest of the app. See `resources/screenshots/Live View Heating.png`.

## Goal

Turn the heating/ready state into a purpose-built, temperature-focused dashboard
that tells the user **what's about to happen** and **when the machine will be
ready**, using the app's existing visual language.

## Current state (code)

- `apps/web/src/components/LiveShotView.tsx` (~968 lines)
  - Pre-shot empty state block (~lines 394–660) gated by
    `!ms.brewing && chartData.length === 0`.
  - Prominent **HEATING** card (~437–481): big current temp, `/ target`, a
    `temp/target` progress bar, and machine `preheat_countdown`.
  - Prominent **READY** card (~405–434) with the "Lance's standard" easter egg
    when `|temp − target| ≤ TEMP_ON_TARGET_THRESHOLD`.
  - Metric tiles reused from the active shot: Row 1 = Time / Pressure / Flow
    (~505–525), Row 2 = Brew Head / Brew Chamber / Target Δ (~526+).
  - `getTempTileDisplay('delta', …)` (#482) drives the Δ tile color coding.
- Telemetry (`apps/web/src/hooks/useMachineTelemetry.ts`) exposes:
  `brew_head_temperature`, `boiler_temperature` (shown as **Brew Chamber**),
  `target_temperature`, `preheat_countdown`, `state`.
- **Lance-ready cutoff** is derived: `target_temperature − TEMP_ON_TARGET_THRESHOLD`
  (the same threshold that triggers the readiness easter egg).
- `apps/web/src/components/ProfileBreakdown.tsx` (reusable; takes `profile`,
  optional `currentStage`, `headerAction`) — reuse for "what's going to happen".

## Design

A dedicated heating/ready layout, top to bottom (mobile-first; desktop adapts):

1. **Restyled status header** — a slim "Heating" / "Ready" pill (not the heavy
   orange card), profile name, and **Set temp**. De-emphasised vs. today.

2. **Hero "time-to-ready" countdown** — the focal element. A large estimate
   (e.g. `~1:20`) labelled "to lance-ready", **targeting the lance-ready cutoff**
   (`target − threshold`), which also trips the existing readiness easter egg.
   Subtitle communicates that heating slows near target to avoid overshoot.
   - **Estimation model:** heating is rapid initially then asymptotically slows.
     A linear `dT/dt` extrapolation will badly over-promise near target. Use an
     exponential-approach (Newtonian) model:
     `T(t) = T_target − (T_target − T0)·e^(−k·t)`. Fit `k` from a short rolling
     window of recent samples, then solve for the time at which `T` reaches the
     lance-ready cutoff. Smooth/clamp the output; show `~` to signal an estimate
     and hide it until enough samples exist for a stable fit.

3. **Temperature graph** (from option A) — chamber & head curves rising over time
   toward dashed **Set temp** and **Lance-ready** target lines. Visually conveys
   the rapid-then-slow approach. Reuse the app's existing charting where possible.

4. **Numbers + progress-to-target** (from option C) — Brew Chamber and Brew Head
   as readable values with a horizontal bar to target and a **ready-cutoff marker**
   on the track. A refined **Δ-to-target** readout and the lance-ready cutoff,
   styled with the app's tokens (replace the ad-hoc delta color coding).

5. **Profile breakdown** ("What's going to happen") — reuse `ProfileBreakdown`,
   **visible by default**, optionally highlighting the first/next stage.

6. **Profile description** — collapsible disclosure, **hidden by default**.

7. **Start (enabled) + Abort** — both available during heating; placement can
   differ from the running-shot layout (e.g. a bottom action row). Start is
   **enabled during heating** (user may queue/begin at will).

### Hidden during heating/ready
- Time, Pressure, Flow cards.
- The (empty) shot graph.
- Weight (tares at shot start).

These return for the running-shot view as today.

### Temperature visualization
Approved combination: **graph with target lines (A) + numbers & progress (C) +
hero countdown (D)**. The graph and the numbers share the same set/ready targets
and the same color identity per sensor (chamber vs head).

## Other nuggets (considered)
- Machine's own `preheat_countdown` (when present) shown alongside/within the
  hero — reconcile with our estimate (prefer machine countdown when it provides
  one; fall back to our model otherwise).
- Current/next stage highlight in the breakdown.
- Profile image / active group.

## Decisions
- Combine A + C + D visualizations.
- Profile breakdown visible by default; description collapsed by default.
- **Start enabled** during heating; Abort always available.
- Restyle the heating header (lighter weight) and replace ad-hoc Δ color coding
  with app design tokens.

## Out of scope
- Changes to the running-shot (brewing) layout beyond hiding/showing the right
  blocks per phase.
- New telemetry fields (work with existing `brew_head_temperature`,
  `boiler_temperature`, `target_temperature`, `preheat_countdown`).

## Testing
- Unit: time-to-ready estimator (exponential fit) — rapid-then-slow synthetic
  curves reach readiness at a sane estimate; guards before enough samples;
  clamping/smoothing; reconciliation with machine `preheat_countdown`.
- Component: heating/ready layout renders the right blocks per `state`; hides
  time/pressure/flow/shot-graph; Start enabled + Abort present.
- Regression: running-shot view unchanged; readiness easter egg still triggers.
- i18n: all new strings via `t()` across all 6 locales.

## Acceptance criteria
- [ ] Heating/ready view shows: restyled header, hero time-to-ready, temp graph
      with set + ready target lines, numbers + progress with ready marker,
      ProfileBreakdown (visible), collapsible description, Start (enabled) + Abort.
- [ ] Time / pressure / flow / shot-graph are hidden during heating/ready.
- [ ] Time-to-ready uses an asymptotic model targeting the lance-ready cutoff and
      degrades gracefully (no wild estimates, hidden until stable).
- [ ] Δ styling uses app design tokens (no ad-hoc colors).
- [ ] Readiness "Lance's standard" easter egg still fires at the cutoff.
- [ ] Parity respected where applicable; tests added; i18n for all 6 locales.
