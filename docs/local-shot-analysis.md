# Metic's shot-analysis algorithm

Metic analyses each shot with a **deterministic, no-LLM algorithm** before any
AI ever sees it. That algorithm decides, per stage, things like the *effective
control mode* (is this really a flow stage, or a pressure stage in disguise?),
whether an exit was *targeted* or a *failsafe*, whether the puck *stalled* or
*channeled*, and how far the shot drifted from the profile's target curve.

This guide shows you where that algorithm lives and how to run its tests.

> **3.0.0 note:** this logic used to be maintained twice — once in a Python
> server and once in a TypeScript mirror for the native app. As of 3.0.0 it lives
> **once** in the shared `@metic/core` package (TypeScript) and is used by both
> the Bun server and the native/on-device app. There is no longer a Python copy
> and no separate mirror to keep in sync.

---

## Where the algorithm lives (edit these to tinker)

Everything is in `packages/core` (`@metic/core`):

| File | Responsibility |
| --- | --- |
| `packages/core/src/logic/shotFacts.ts` | The interesting logic: `effectiveControlMode`, `classifyTrigger`, `detectStall`, `detectChanneling`, curve adherence, and `buildShotFacts`. **Start here.** |
| `packages/core/src/logic/shotAnalysis.ts` | Per-stage execution extraction, dynamics/target resolution, and `computeRichLocalAnalysis` (the orchestrator). |
| `packages/core/src/routes/shots.ts` | The `/api/*` route that invokes the analysis in production (same code path in server and native mode). |

The effective-mode thresholds live at the top of `shotFacts.ts`:

```ts
export const EFFECTIVE_FLOW_TARGET_MIN = 6.0 // flow target ≥ this + pressure limit ⇒ pressure
export const EFFECTIVE_FLOW_LIMIT_MAX = 3.0  // pressure stage w/ flow limit ≤ this ⇒ flow
```

Tune a threshold, run the tests, compare the output — that's the whole loop.

> The web app re-exports this module (`apps/web/src/lib/shotFacts.ts` is just
> `export * from "@metic/core/logic/shotFacts"`), so editing the core file
> updates both runtimes at once.

## Running the tests

From the repository root:

```bash
cd packages/core
bun install        # first time only
bun run test       # runs the full vitest suite (vitest run)
```

The relevant contract tests are:

- `packages/core/test/contract/shotFacts.test.ts` — trigger classification, stall
  and channeling detection, effective control mode (see issue #423).
- `packages/core/test/contract/shotAnalysis.test.ts` — the end-to-end
  `computeRichLocalAnalysis` pipeline.

Run just those two while iterating:

```bash
cd packages/core
bunx vitest run test/contract/shotFacts.test.ts test/contract/shotAnalysis.test.ts
```
