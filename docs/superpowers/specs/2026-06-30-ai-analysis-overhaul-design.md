# AI Shot Analysis Overhaul — Design

**Date:** 2026-06-30
**Issue:** #423 (Profile Logic: Targets vs. Limits vs. Exit Triggers) + AI analysis quality overhaul
**Branch context:** created from the active milestone branch (not `main`)
**Status:** Approved design — ready for implementation planning

## Problem

AI shot analysis performs acceptably on large models but is **intermittently spotty and
often wrong on smaller models** (e.g. Apple Intelligence, Gemma, smaller hosted models).
Root causes identified during exploration:

1. **Raw-JSON reasoning burden.** Both runtimes hand the model a verbose
   `JSON.stringify(local_analysis)` + profile-stages JSON + raw graph samples and ask it to
   derive *all* interpretation (channeling, stall, extraction quality). Small models choke on
   nested JSON and hallucinate.
2. **No diagnostic knowledge base for analysis.** Profile generation injects a rich
   `PROFILING_KNOWLEDGE` guide; shot analysis does not get an analysis-specific equivalent.
   Worse, the profiling guide is injected **server-side only** — the native DirectMode prompt
   omits it (a dual-runtime parity gap).
3. **Validation only catches degeneracy, not correctness.** `analysisLint.ts` detects
   repetition/low-diversity/empty output, but nothing checks that the analysis follows the
   section schema, that recommendations parse and stay within bounds, or that claims do not
   contradict the measured data. The native DirectMode path returns raw, unlinted text.
4. **#423 unimplemented.** `_determine_exit_trigger_hit` detects *which* trigger fired but
   never classifies a stage ending as **Targeted** vs **Failsafe**, so a stage that timed out
   from stalling is presented as a success.
5. **Espresso Compass underused.** A 2D taste pad (X sour↔bitter, Y weak↔strong, +
   descriptors) already feeds the server AI, but: it is not offered as a step in the analysis
   flow, the native DirectMode prompt omits its `taste_context`, and its domain knowledge is
   never applied deterministically.

## Goal

Give the analysis **better tools** so quality is **consistent across model sizes**, by:
moving interpretation into a deterministic fact layer (which also upgrades the non-AI static
analysis), giving the AI a diagnostic knowledge base + digested facts + few-shot example +
semantic validation, and integrating the Espresso Compass as an optional pre-analysis step
that feeds both the AI and deterministic rules.

## Anchoring decisions (from brainstorming)

- **Philosophy:** Both — deterministic fact layer **and** upgraded AI prompting/validation.
- **Compass flow:** Optional, skippable step **before** analysis; result feeds **both** the AI
  and deterministic rule-based adjustments.
- **Signal visibility:** Enrich the existing static/local-analysis view (`ShotDetail.tsx`)
  with the new classifications/flags (moderate UI + 6-locale i18n).
- **Scoping:** One spec, phased implementation.

## Dual-runtime contract (release-blocking)

Every behavior below MUST be implemented in **both** runtimes with tests on both sides:

- **Server mode:** Python FastAPI — `apps/server/services/analysis_service.py`,
  `apps/server/api/routes/shots.py`.
- **Native/Capacitor mode:** TypeScript — `apps/web/src/lib/profileAnalysis.ts`,
  `apps/web/src/services/interceptor/DirectModeInterceptor.ts`,
  `apps/web/src/services/ai/` (prompts, providers), `apps/web/src/lib/analysisLint.ts`.

Mismatched behavior between runtimes is a release-blocking bug.

---

## Architecture

Introduce a single deterministic fact layer per runtime that both the static view and the AI
consume. Pure, independently testable functions.

```
telemetry + profile ──▶ buildShotFacts() ──▶ ShotFacts (typed)
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                  static view render    buildFactSheet()    (unchanged raw
                  (ShotDetail.tsx)      → prose for prompt   JSON, optional/
                  D1–D6 badges/flags    (K2)                 large-model only)

taste (X,Y,descriptors) ─▶ compassAdjustments() ─▶ deterministic recs (D6)
                                                  └─▶ taste_context for AI (K5)

AI output ─▶ validateAnalysis() (K4) ─▶ retry → repair → fallback
            (schema + bounds + anti-hallucination vs ShotFacts)
```

New/changed units:

- **`ShotFacts` builder** — `apps/server/services/analysis_service.py` (`build_shot_facts()`)
  and TS `apps/web/src/lib/shotFacts.ts`. Input: telemetry + profile + existing local
  analysis. Output: typed `ShotFacts` (D1–D5). No I/O, no LLM.
- **Compass rules** — pure `compassAdjustments(tasteX, tasteY, descriptors)` in each runtime
  (D6). Returns a list of `{ axis, direction, adjustments[] }`.
- **Knowledge base** — `ANALYSIS_KNOWLEDGE` constant mirrored per runtime, sibling to
  `PROFILING_KNOWLEDGE` (K1).
- **Fact sheet builder** — `buildFactSheet(facts)` → compact labeled prose for the prompt (K2).
- **Validator** — extend `analysisLint.ts` + new server parity validator sharing one schema
  definition (K4).

---

## Phase 1 — Deterministic fact layer + static view (#423)

Computed once in `buildShotFacts()`; rendered in the static view and fed to the AI.

- **D1 — Trigger classification (#423).** For each stage ending, classify **Targeted** vs
  **Failsafe** using control-mode + trigger-type + trigger-count:
  - weight trigger → `Targeted (yield reached)`
  - time trigger, only trigger on stage → `Targeted (planned duration)`;
    time trigger with other triggers present → `Failsafe (timeout — likely stalled)`
  - flow-control stage + pressure trigger → `Targeted (puck resistance achieved)`
  - pressure-control stage + flow trigger → only trigger `Targeted (planned flow transition)`,
    else `Failsafe (channeling/choking caught)`
  - pressure-control stage + pressure trigger → `Targeted (threshold reached)`
  - fallback → `Unknown`
  Resolves the #423 "stalled-but-shown-as-success" ambiguity.
- **D2 — Stall detection.** Flag a stage as stalled when it exits on a time **Failsafe** AND
  the weight gain in its final window is below a threshold (intended yield not reached).
  Distinguishes a planned timed rest from a flow-death timeout.
- **D3 — Channeling indicators.** Deterministic flags from telemetry: pressure-drop-with-
  flow-rise, flow before adequate pressure build, and flow variance beyond a stable band.
  Replaces asking the model to guess channeling with no computed signal.
- **D4 — Extraction-phase breakdown.** Segment the shot into pre-infusion / ramp / peak /
  decline phases from the measured curve (independent of profile stage names), with per-phase
  pressure/flow/weight summaries.
- **D5 — Target-curve adherence.** Diff measured pressure/flow against the profile's target
  dynamics points per stage → deviation deltas (e.g. "ran 1.1 bar under target in stage 2").
- **D6 — Compass deterministic rules.** `compassAdjustments()` maps taste to rule-based
  recommendations (sour→under-extraction fixes, bitter→over, weak/strong→ratio), shown
  alongside the AI output, model-independent.

**Static-view impact:** `ShotDetail.tsx` gains Targeted/Failsafe badges per stage, stall &
channeling flags, the phase breakdown, and curve-adherence deltas. New i18n keys across all
6 locales (`en`, `sv`, `de`, `es`, `fr`, `it`).

---

## Phase 2 — AI analysis layer

- **K1 — `ANALYSIS_KNOWLEDGE`.** New diagnostic knowledge block (sibling to
  `PROFILING_KNOWLEDGE`): under/over-extraction curve signatures, reading Targeted vs Failsafe
  endings, channeling signatures, ratio/yield reasoning, and the compass mapping. Injected in
  **both** runtimes (also closes the existing server-only profiling-knowledge parity gap for
  analysis).
- **K2 — Digested fact sheet.** Replace the raw `JSON.stringify(local_analysis)` +
  graph-sample dump with `buildFactSheet(facts)` — compact labeled prose derived from D1–D5
  (e.g. "Stage 2 'Infusion': ended on TIME as a FAILSAFE — stalled, +3g in last 4s; 1.1 bar
  under target; channeling: none"). Raw JSON retained only optionally for large models / behind
  a flag.
- **K3 — Few-shot worked example.** One compact example shot → ideal analysis embedded in the
  prompt to lock format and reasoning depth. Single example to bound token cost.
- **K4 — Semantic validation + repair (both runtimes).** Extend `analysisLint.ts` and add a
  server parity validator sharing one schema (the linter's format coverage and test matrix are
  formalized in Phase 4). Checks: all required sections/subsections
  present; `Assessment` is one of the allowed enum values; `RECOMMENDATIONS_JSON` parses and
  values stay within profile variable bounds; and **anti-hallucination cross-checks** — reject
  or repair claims that contradict `ShotFacts` (e.g. AI claims "reached target yield" when D1
  says Failsafe stall). On failure: one retry → repair → graceful fallback. Wire into
  DirectMode, which currently returns raw, unlinted text.
- **K5 — Compass context parity.** Inject the compass `taste_context` in native DirectMode
  (the server already does) so taste feedback reaches the model in both runtimes.

---

## Phase 3 — Compass UX

- **U1 — Optional pre-analysis step.** Before running AI shot analysis, present an optional
  "How did it taste?" step reusing the existing 2D taste pad + descriptors. Skippable in one
  tap; skipping runs analysis without taste. Server + native parity.
- **U2 — Dual feed.** On submit, taste feeds both the AI (K5) and the deterministic compass
  rules (D6). The static view shows the rule-based adjustment; the AI weaves it into its
  recommendations.
- **U3 — Persist taste with shot.** Store the taste input with the shot so re-analysis / cache
  reuse does not re-ask.

---

## Phase 4 — Linter format coverage & comprehensive test coverage

The recently introduced AI-analysis linter (`analysisLint.ts`, degeneracy-only) must be
expanded to fully cover the **new** output format produced by Phases 1–3, and validation must
be wired across every analysis entry point in both runtimes. K4 introduces the semantic
validator; Phase 4 makes the linter a first-class, explicitly-tested deliverable and closes
any gaps so the linter cannot drift out of sync with the output schema.

- **L1 — Format-aware linting.** Extend the linter (and its server parity validator) to assert
  the full new section schema: required headers/subsections, the `Assessment` enum, the
  bullet-point structure, the `RECOMMENDATIONS_JSON` block (parse + bounds), and the
  Taste-Based Recommendations section when compass data is present. Keep the existing
  degeneracy checks (repetition/diversity/empty).
- **L2 — Single source of truth for the schema.** The expected-section schema lives in one
  shared definition per runtime, consumed by both the prompt builder and the linter, so the
  prompt and the validator cannot diverge. Numerically/structurally identical across runtimes.
- **L3 — Universal wiring.** Every analysis path runs the linter → retry → repair → fallback,
  including native DirectMode (currently returns raw, unlinted text) and the server LLM route.
  No entry point may return unvalidated analysis text.
- **L4 — Anti-hallucination tie-in.** The linter consumes `ShotFacts` so contradiction checks
  (D1 Failsafe vs an AI "yield reached" claim) are part of the standard lint pass, not a
  separate ad-hoc step.
- **L5 — Comprehensive test coverage (release gate).** A coverage matrix proving the linter
  catches and repairs each failure mode, on **both** runtimes (see Testing). New code lands
  with tests for success **and** failure/edge-case paths, per project conventions.

---

## Testing (dual-runtime, parity is release-blocking)

- Table-driven unit tests for every D1 trigger combination → expected classification, including
  the #423 worked examples, on **both** runtimes.
- D2/D3/D4/D5 unit tests with synthetic telemetry fixtures (stalled stage, channeling spike,
  clean shot, under-target curve).
- D6 compass rule tests: each quadrant + descriptors → expected adjustments.
- K4 validator tests: schema gaps, out-of-bounds recommendations, and anti-hallucination
  (fact says Failsafe → AI claim of "yield reached" is rejected/repaired).
- **Phase 4 linter coverage matrix (release gate), both runtimes:** for each failure mode —
  missing/extra section, invalid `Assessment` value, malformed/missing bullet structure,
  unparseable or out-of-bounds `RECOMMENDATIONS_JSON`, missing Taste-Based Recommendations
  when compass data is present, runaway repetition/low-diversity, and a fact contradiction —
  assert the linter (a) flags it and (b) repair or retry yields valid output. Plus a
  schema-drift guard test asserting the prompt builder and linter consume the same shared
  schema definition (L2).
- Golden small-model regression: feed a known-bad shot, assert the output passes the new
  validator (and that repair fires when needed).
- Each new function (`buildShotFacts`/`build_shot_facts`, `compassAdjustments`,
  `buildFactSheet`, validator) ships with success **and** failure/edge-case tests per project
  conventions; no analysis entry point returns unvalidated text (L3).
- i18n parity: all new keys present in all 6 locales (existing parity test covers this).
- Server suite in `test_main.py` / `test_ai_providers.py`; web suite via
  `bun run test:run -- --reporter=dot <paths>`.

## Out of scope

- New cloud provider image generation (tracked separately).
- Re-architecting profile generation (only its knowledge-base pattern is mirrored, not changed).
- Unrelated refactors of the static analysis beyond what D1–D6 require.

## Open implementation notes

- `buildShotFacts()` should reuse existing helpers (`_extract_shot_stage_data`,
  `_compute_stage_stats`, `_determine_exit_trigger_hit`) rather than re-deriving telemetry
  grouping; D1 wraps/extends `_determine_exit_trigger_hit` with the classification layer.
- Keep `ShotFacts` serializable so it can be cached with the shot alongside the taste input.
- Thresholds (stall window, channeling variance band, curve-adherence tolerance) defined as
  named constants in one place per runtime, kept numerically identical across runtimes.
