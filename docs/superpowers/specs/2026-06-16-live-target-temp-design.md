# Live View: Tap-to-cycle Target Temperature (#482)

**Date:** 2026-06-16
**Issue:** [#482](https://github.com/hessius/MeticAI/issues/482)
**Status:** Design — produced autonomously (user unavailable for live brainstorming;
decisions documented as assumptions for later review).

## Problem

The live view shows the brew-head temperature but never surfaces the **target**
temperature the machine is aiming for. Users can't tell at a glance whether the
group is at, above, or below target during a shot.

## Goal

Surface the target temperature in the live-view temperature display, with a tap
to cycle between the current reading, the target, and the delta — without adding
clutter or a new permanent UI element.

## Decisions (assumptions, pending review)

1. **Which display:** Only the **Brew Head** `MetricTile` becomes interactive.
   `target_temperature` is the brew (group) target, which corresponds to the
   brew head — not the boiler / "Brew Chamber". Brew Chamber stays unchanged.
2. **Cycle order:** `current → target → delta → current` (forward, wraps). Tap
   or keyboard (Enter/Space) advances the mode.
3. **Mode indication:** the tile **label** changes per mode — `Brew Head` →
   `Target` → `Δ Target`. In delta mode the value is **signed** (`+1.3`, `-0.8`)
   and **color-coded**: on-target (|Δ| ≤ 0.5 °C) green, hotter than target
   orange, cooler than target blue.
4. **Scope:** both Brew Head tile instances (pre-shot empty state and active
   brewing) share a single mode state, so the choice is consistent across states.
5. **Edge cases:** when `target_temperature` is `null`, the tile is
   **non-interactive** and shows the current reading only (no dead toggle). When
   `brew_head_temperature` is `null`, the value shows `—` as today.
6. **Persistence:** mode is component-local React state, default `current`. Not
   persisted across navigation/sessions (YAGNI for v1).

## Architecture

Frontend-only change in `apps/web/src/components/LiveShotView.tsx`. No backend or
DirectMode change is required: `target_temperature` is already part of
`MachineState` (`apps/web/src/hooks/useWebSocket.ts`) and streams over the shared
WebSocket in **both** server and native/Capacitor runtimes. Because `LiveShotView`
is a shared React component fed by shared machine status, **dual-runtime parity is
automatic** (Quality Gate #7 satisfied without a second implementation).

### Components / units

- **`TempDisplayMode`** — `type TempDisplayMode = 'current' | 'target' | 'delta'`.
- **`getTempTileDisplay(mode, current, target, t)`** — pure, exported helper that
  returns `{ value: string; unit: string; label: string; valueClassName?: string }`.
  This isolates all formatting/color logic so it is unit-testable without
  rendering the (large) `LiveShotView`. Behavior:
  - `current`: `value = current?.toFixed(1) ?? '—'`, `label = t('controlCenter.metrics.brewTemp')`.
  - `target`: `value = target?.toFixed(1) ?? '—'`, `label = t('controlCenter.metrics.targetTemp')`.
  - `delta`: if both present, `d = current - target`,
    `value = (d >= 0 ? '+' : '') + d.toFixed(1)`,
    `label = t('controlCenter.metrics.tempDelta')`, plus `valueClassName` color by
    sign/threshold; otherwise `value = '—'` and no color.
  - `unit` is `'°C'` in all modes.
- **`MetricTile`** — extended with an optional `valueClassName?: string` prop
  applied to the value element (default styling preserved when absent). This is
  the only change to the existing component, used to color the delta.
- **`LiveShotView`** — holds `const [tempMode, setTempMode] = useState<TempDisplayMode>('current')`
  and `cycleTempMode()` (forward + wrap). Both Brew Head tiles derive
  `value/unit/label/valueClassName` from `getTempTileDisplay(tempMode, …)` and set
  `onClick={target != null ? cycleTempMode : undefined}`.

### Data flow

`useWebSocket → MachineState.{brew_head_temperature, target_temperature}` →
`LiveShotView` reads `ms.*` → `getTempTileDisplay(tempMode, current, target, t)` →
`MetricTile` renders value/label/color. Tap → `cycleTempMode` → re-render.

## Internationalization

Add two keys under `controlCenter.metrics` in **all 6 locales** (`en, sv, de, es,
fr, it`):

| key | en | sv | de | es | fr | it |
|-----|----|----|----|----|----|----|
| `targetTemp` | Target | Mål | Ziel | Objetivo | Cible | Obiettivo |
| `tempDelta` | Δ Target | Δ Mål | Δ Ziel | Δ Objetivo | Δ Cible | Δ Obiettivo |

## Accessibility

`MetricTile` already renders `role="button"`, `tabIndex=0`, and an Enter/Space
handler when `onClick` is set. The cycling tile inherits this. The label text
announces the active mode; delta color is supplementary (not the sole indicator),
keeping it usable without color perception.

## Testing

- **Unit (primary):** `getTempTileDisplay` for every mode — current/target/delta
  values and labels, the signed-and-rounded delta, the three color thresholds, and
  null handling for `current`/`target`. New file
  `apps/web/src/components/LiveShotView.tempDisplay.test.ts(x)` (or colocated),
  exporting the helper.
- **Interaction:** a focused render test that mounts the Brew Head tile path and
  asserts tapping cycles label `Brew Head → Target → Δ Target → Brew Head`, and
  that with `target_temperature === null` the tile is non-interactive.
- **Gate:** `cd apps/web && bun run lint && bun run test:run && bun run build`.

## Out of scope (YAGNI)

- Persisting the chosen mode across sessions.
- Toggling the boiler / Brew Chamber tile.
- Configurable on-target threshold (fixed at ±0.5 °C for v1).
- Animated transitions between modes.

## Acceptance criteria (from #482)

- [x] Target temp available in the live-view temperature display (via toggle).
- [x] Tapping cycles displayed temp / target / delta.
- [x] Clear visual indication of mode (label change + delta coloring).
- [x] Works in the responsive/mobile layout (tiles are used in both layouts).
