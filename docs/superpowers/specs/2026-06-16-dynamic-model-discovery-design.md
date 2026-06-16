# Dynamic Gemini model discovery & fallback (#485)

**Status:** Approved design — ready for implementation planning
**Date:** 2026-06-16
**Issue:** [#485](https://github.com/hessius/MeticAI/issues/485) — AI analysis fails due to model deprecation

## Problem

AI analysis/generation fails for some users in production because a hardcoded /
configured Gemini model name is no longer served (model deprecation). Failures
are silent and confusing.

The app must stop hard-depending on a single, deprecate-able model name:
discover served models dynamically, select a supported one automatically, fall
back gracefully, and surface a clear error when nothing compatible exists.

## Current state (both runtimes)

### Server (`apps/server/services/gemini_service.py`)
Already has partial infrastructure:
- `get_model_name()` — reads `GEMINI_MODEL` env (default `gemini-2.5-flash`).
- `validate_model(name)` — `client.models.get()` existence check.
- `get_available_models()` — **real dynamic discovery** via `client.models.list()`,
  filtered to `generateContent`-capable.
- `get_working_model()` — tries configured model, then a **hardcoded** chain
  `_FALLBACK_MODELS = ["gemini-2.5-flash","gemini-2.5-pro","gemini-2.5-flash-lite"]`.
- `_validated_model_cache` + `get_working_model_sync()` — cache; generation uses
  the cached working model (line ~629).
- Resolved at startup (`main.py` ~line 198).

**Gap:** `get_working_model()` **never** uses `get_available_models()` as the
ultimate fallback. If the entire `gemini-2.5-*` family is deprecated, it still
fails. There is also no reactive recovery if a model dies mid-session.

### Native / Capacitor (`apps/web/src/services/ai/BrowserAIService.ts`)
The live native AI path (DirectMode uses `createBrowserAIService`):
- `getGeminiModel()` returns stored or default `gemini-2.5-flash` and is used
  directly in every `client.models.generateContent({ model })` call.
- **No validation, no fallback, no discovery.** This is the most exposed runtime.
- Has typed `AIErrorCode.MODEL_NOT_FOUND` but does nothing to recover from it.

### Dead code
`apps/web/src/lib/directModeAI.ts` (raw-REST, hardcoded `gemini-2.5-flash`) is
legacy: its `generateProfile` / `analyzeShotWithAI` exports are not imported by
any live code (only doc-comment references remain). It is superseded by
`BrowserAIService`. **It will be removed** as part of this change, along with any
helpers that become unused once it is gone.

## Decisions (from brainstorming)

1. **Selection strategy:** pure dynamic. Try the user's configured model first,
   then pick from the live `models.list()` by heuristic. No curated hardcoded
   fallback chain as the primary mechanism.
2. **Preview/experimental models:** prefer stable; exclude
   preview/experimental/dated-snapshot models when a stable option exists, but
   allow them as a last resort.
3. **Timing:** both proactive **and** reactive — resolve a working model up front
   (server startup / native first AI call) **and**, if a generation still fails
   with model-not-found, transparently re-discover and retry once.
4. **Dead code:** remove `directModeAI.ts` (and anything only it used).

## Architecture

### Resolution flow (mirrored in both runtimes)

```
resolveWorkingModel(forceRefresh = false):
  if cached and not forceRefresh:
      return cached
  # 1. Honor the user's configured/default model when it is still served
  if validate(configured):
      cache = configured; return configured
  # 2. Pure dynamic discovery
  models = list_models()                  # generateContent-capable
  best   = rank_models(models)            # see heuristic below
  if best is not None:
      cache = best; return best
  # 3. Nothing compatible
  raise ModelNotFound                     # clear, user-facing error
```

- **Proactive:**
  - *Server* resolves at startup (existing `get_working_model()` call in
    `main.py`) and caches; generation reads the cached value.
  - *Native* resolves lazily on the first AI call and caches **in memory**
    (session-scoped). We intentionally do **not** persist the resolved model to
    `localStorage`, so that once the configured model recovers it is preferred
    again on the next cold start (no stale pinning).
- **Reactive:** generation paths are wrapped so a model-not-found failure
  triggers `resolveWorkingModel(forceRefresh = true)` (which skips the now-dead
  configured model and goes straight to dynamic discovery) and **retries once**.
  If it still fails, the typed error is surfaced.

### Ranking heuristic (pure, unit-tested in each runtime)

`rank_models(models) -> best | None`:

1. **Capability filter:** keep only models advertising `generateContent`
   (server: `supported_actions`; JS SDK: `supportedActions`).
2. **Family exclusion (by name):** drop non-text families — `embedding`, `aqa`,
   `imagen` / `image`, `tts`.
3. **Stability partition:** a model is **unstable** if its name matches
   `preview`, `exp`, `experimental`, or a date-snapshot pattern (e.g.
   `-09-2025`, `-0925`, trailing `-\d{3,4}` / `-\d{2}-\d{2}`); otherwise
   **stable**.
4. **Ordering (highest wins):**
   - stable before unstable;
   - within a tier, class rank **flash > flash-lite > pro > other**;
   - within a class, highest `gemini-<major>.<minor>` version (parsed from name);
   - deterministic tie-break on name for stability.
5. **Selection:** return the top stable model; if none stable, return the top
   unstable model; if the set is empty, return `None`.

The heuristic is a **pure function** in both runtimes so it can be unit-tested
exhaustively without network calls. The Python and TypeScript implementations
must produce the same ranking for the same inputs (verified by mirrored test
tables).

## Components & files

### Server (`apps/server/`)
- `services/gemini_service.py`
  - Add `rank_models(models: list[dict]) -> str | None` pure helper implementing
    the heuristic above.
  - Rework `get_working_model()`: configured → (if invalid) `rank_models(await
    get_available_models())` → else raise/clear-error. The hardcoded
    `_FALLBACK_MODELS` is removed (or demoted to an offline-only hint used solely
    when the list call itself fails); the dynamic list is the real fallback.
  - Add a reactive helper used by the generate path: on a model-not-found error,
    `await get_working_model()` with cache invalidation, then retry the
    generation once.
  - `parse_gemini_error()` already maps 404/NOT_FOUND model errors to friendly
    text — extend its message to reflect dynamic selection if needed.
- `api/routes/system.py` — `/api/available-models` already exists; ensure it
  reflects the resolved/working model.
- `main.py` — startup resolution stays; ensure failures degrade gracefully.

### Native (`apps/web/src/`)
- `services/ai/BrowserAIService.ts`
  - Add `rankModels(models)` pure helper (mirrors server heuristic).
  - Add `resolveWorkingModel(forceRefresh?)` using SDK `client.models.list()`
    with an in-memory module cache; validate the configured model first.
  - Route all text `generateContent` calls through the resolved model.
  - Wrap generation with reactive re-resolve + single retry on
    `MODEL_NOT_FOUND`.
  - Image generation (`imagen-*`) keeps its existing two-model fallback and is
    **out of scope** for this change.
- `lib/directModeAI.ts` — **delete** (dead code); remove any now-unused helpers
  it referenced, verified by lint/build.

### i18n
- Add a "no compatible AI model available" user-facing message under the
  existing AI-error keys, in **all 6 locales** (`en, sv, de, es, fr, it`).

## Error handling

- **Server:** model-not-found / no-compatible-model → `parse_gemini_error`
  friendly text; reactive retry happens before the error is surfaced.
- **Native:** `AIServiceError('MODEL_NOT_FOUND')`; the UI layer translates via
  i18n. Reactive retry happens before the error reaches the UI.
- The message must clearly tell the user that no compatible model is available
  for their API key / access and suggest checking Gemini access or updating the
  app — not a generic failure.

## Testing

### Server (pytest, `apps/server/test_main.py`)
- `rank_models`: capability filter, family exclusion, stable-over-unstable,
  flash > flash-lite > pro, version ordering, unstable-only-as-last-resort,
  empty → `None`.
- `get_working_model`: configured valid → configured; configured dead → dynamic
  pick; all dead / empty list → error path.
- Reactive: generation fails with model-not-found → re-resolve → retry succeeds;
  retry still fails → clear error.

### Native (vitest, `apps/web/src/services/ai/`)
- `rankModels`: **same test table** as the server (parity).
- `resolveWorkingModel`: configured valid; configured dead → dynamic pick;
  empty → throws `MODEL_NOT_FOUND`; in-memory cache hit; `forceRefresh` bypasses
  cache.
- Reactive retry: first call throws `MODEL_NOT_FOUND` → re-resolve → retry
  succeeds; exhaustion → error surfaced.

## Acceptance criteria (from issue)

- [ ] App no longer hard-depends on a single deprecate-able model name.
- [ ] Available models discovered dynamically; a supported model selected
      automatically.
- [ ] Graceful fallback + clear user-facing error when no model is available.
- [ ] Tests cover model-unavailable and fallback paths (both runtimes).

## Out of scope

- Image-generation model selection (keeps its existing `imagen-*` fallback).
- Persisting the resolved model across app launches (intentionally session-only).
- A user-facing model picker UI (the existing `/api/available-models` endpoint
  and stored `GEMINI_MODEL` remain; no new UI here).

## Dual-runtime parity (Quality Gate #7)

Server and native get the same behavior: identical resolution flow, an
equivalent ranking heuristic verified by mirrored test tables, proactive +
reactive recovery, and the same user-facing error semantics. The change is not
considered complete until both runtimes implement it with passing tests.
