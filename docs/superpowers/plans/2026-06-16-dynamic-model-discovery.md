# Dynamic Gemini Model Discovery & Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI analysis resilient to Gemini model deprecation by discovering served models dynamically, selecting the best supported one, recovering reactively, and surfacing a clear error when none is available — in both the server and native runtimes.

**Architecture:** A `resolveWorkingModel()` flow in each runtime: try the user's configured model, else rank the live `models.list()` result with a shared heuristic, else raise a typed error. Resolution is proactive (startup / first call, cached) and reactive (re-resolve + retry once on a mid-session model-not-found). The ranking heuristic is a pure, exhaustively-tested function mirrored in Python and TypeScript.

**Tech Stack:** Python 3.13 / FastAPI / `google-genai` SDK (server); React + TypeScript / `@google/genai` SDK / vitest (native). Spec: `docs/superpowers/specs/2026-06-16-dynamic-model-discovery-design.md`.

---

## File Structure

**Server (`apps/server/`)**
- `services/gemini_service.py` — add `rank_models()` pure helper; rework `get_working_model()` to use dynamic discovery as the real fallback; add reactive re-resolve+retry used by the generate path. (MODIFY)
- `test_main.py` — unit tests for `rank_models`, `get_working_model` dynamic fallback, reactive retry; plus one **opt-in live integration test** for `get_available_models()`. (MODIFY)

**Native (`apps/web/src/`)**
- `services/ai/modelResolver.ts` — NEW: pure `rankModels()` + `resolveWorkingModel()` with in-memory cache (keeps `BrowserAIService` focused).
- `services/ai/modelResolver.test.ts` — NEW: unit tests (mirror server ranking table) + resolver fallback/cache/error tests.
- `services/ai/modelResolver.integration.test.ts` — NEW: **opt-in live integration test** for SDK `models.list()`.
- `services/ai/BrowserAIService.ts` — MODIFY: route text `generateContent` calls through `resolveWorkingModel()`; reactive retry on `MODEL_NOT_FOUND`.
- `lib/directModeAI.ts` — DELETE (dead code).

**Cross-cutting**
- `public/locales/{en,sv,de,es,fr,it}/translation.json` — add "no compatible model" AI-error message. (MODIFY)

---

## Conventions for every task
- Use `bun` (never npm) for frontend: `cd apps/web && bun run <script>`.
- Frontend gate: `bun run lint && bun run test:run && bun run build`.
- Backend tests: `cd apps/server && python -m pytest test_main.py -q` (use the repo's existing venv/runner).
- Commit messages: Conventional Commits + trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

## Task 1: Server `rank_models()` pure helper

**Files:**
- Modify: `apps/server/services/gemini_service.py` (add helper near `get_available_models`, ~line 72)
- Test: `apps/server/test_main.py` (new `TestRankModels` class)

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/test_main.py`:

```python
class TestRankModels:
    """Tests for the dynamic model ranking heuristic."""

    def _m(self, name):
        return {"id": name, "display_name": name, "description": ""}

    def test_prefers_flash_over_pro(self):
        from services.gemini_service import rank_models
        models = [self._m("gemini-2.5-pro"), self._m("gemini-2.5-flash")]
        assert rank_models(models) == "gemini-2.5-flash"

    def test_prefers_higher_version(self):
        from services.gemini_service import rank_models
        models = [self._m("gemini-2.0-flash"), self._m("gemini-2.5-flash")]
        assert rank_models(models) == "gemini-2.5-flash"

    def test_flash_beats_flash_lite(self):
        from services.gemini_service import rank_models
        models = [self._m("gemini-2.5-flash-lite"), self._m("gemini-2.5-flash")]
        assert rank_models(models) == "gemini-2.5-flash"

    def test_flash_lite_beats_pro(self):
        from services.gemini_service import rank_models
        models = [self._m("gemini-2.5-pro"), self._m("gemini-2.5-flash-lite")]
        assert rank_models(models) == "gemini-2.5-flash-lite"

    def test_prefers_stable_over_preview(self):
        from services.gemini_service import rank_models
        models = [self._m("gemini-3.0-flash-preview-09-2025"), self._m("gemini-2.5-flash")]
        assert rank_models(models) == "gemini-2.5-flash"

    def test_allows_preview_as_last_resort(self):
        from services.gemini_service import rank_models
        models = [self._m("gemini-3.0-flash-exp")]
        assert rank_models(models) == "gemini-3.0-flash-exp"

    def test_excludes_non_text_families(self):
        from services.gemini_service import rank_models
        models = [self._m("imagen-4.0-generate-001"), self._m("text-embedding-004")]
        assert rank_models(models) is None

    def test_strips_models_prefix(self):
        from services.gemini_service import rank_models
        models = [self._m("models/gemini-2.5-flash")]
        assert rank_models(models) == "gemini-2.5-flash"

    def test_empty_returns_none(self):
        from services.gemini_service import rank_models
        assert rank_models([]) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && python -m pytest test_main.py::TestRankModels -q`
Expected: FAIL with `ImportError: cannot import name 'rank_models'`.

- [ ] **Step 3: Implement `rank_models`**

Add to `apps/server/services/gemini_service.py` (after `get_available_models`, before `get_working_model`). Ensure `import re` is present at the top of the file:

```python
# Name fragments that identify non-text model families to skip.
_NON_TEXT_FRAGMENTS = ("embedding", "aqa", "imagen", "image", "tts")
# Patterns that mark a model as preview/experimental/dated-snapshot (unstable).
_UNSTABLE_RE = re.compile(r"(preview|experimental|-exp\b|exp$|-\d{2}-\d{2}|-\d{3,4}$)")


def _model_short_name(name: str) -> str:
    """Strip a leading 'models/' prefix and lowercase."""
    return name.split("/")[-1].strip().lower()


def rank_models(models: list[dict]) -> Optional[str]:
    """Pick the best generateContent-capable model from a discovered list.

    Heuristic: prefer stable over preview/experimental; within a tier prefer
    flash > flash-lite > pro > other; within a class prefer the highest
    gemini-<major>.<minor> version. Returns the model id (without the
    'models/' prefix) or None if nothing compatible remains.
    """
    candidates = []
    for m in models:
        raw = m.get("id") or ""
        short = _model_short_name(raw)
        if not short or any(f in short for f in _NON_TEXT_FRAGMENTS):
            continue
        candidates.append(short)
    if not candidates:
        return None

    def score(short: str):
        unstable = 1 if _UNSTABLE_RE.search(short) else 0
        if "flash-lite" in short:
            cls = 1
        elif "flash" in short:
            cls = 0
        elif "pro" in short:
            cls = 2
        else:
            cls = 3
        vm = re.search(r"gemini-(\d+)\.(\d+)", short)
        major, minor = (int(vm.group(1)), int(vm.group(2))) if vm else (0, 0)
        # Lower tuple sorts first: stable, then class, then highest version, then name.
        return (unstable, cls, -major, -minor, short)

    return min(candidates, key=score)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && python -m pytest test_main.py::TestRankModels -q`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/server/services/gemini_service.py apps/server/test_main.py
git commit -m "feat(server): add rank_models heuristic for dynamic model selection (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Server `get_working_model()` uses dynamic discovery as the real fallback

**Files:**
- Modify: `apps/server/services/gemini_service.py:74-89` (`get_working_model`)
- Test: `apps/server/test_main.py` (`TestModelValidation` / new cases)

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/test_main.py` (inside `class TestModelValidation`):

```python
    @patch.dict(os.environ, {"GEMINI_API_KEY": "k"})
    @patch("services.gemini_service.get_available_models")
    @patch("services.gemini_service.validate_model")
    def test_working_model_uses_dynamic_when_configured_dead(self, mock_validate, mock_list):
        import asyncio
        from services.gemini_service import get_working_model, _validated_model_cache
        _validated_model_cache.clear()
        # configured model invalid; everything else "valid" only via the list
        async def _validate(name):
            return False
        mock_validate.side_effect = _validate
        async def _list():
            return [{"id": "gemini-2.5-pro"}, {"id": "gemini-2.5-flash"}]
        mock_list.side_effect = _list
        result = asyncio.run(get_working_model())
        assert result == "gemini-2.5-flash"

    @patch.dict(os.environ, {"GEMINI_API_KEY": "k"})
    @patch("services.gemini_service.get_available_models")
    @patch("services.gemini_service.validate_model")
    def test_working_model_raises_when_nothing_available(self, mock_validate, mock_list):
        import asyncio
        from services.gemini_service import get_working_model, ModelUnavailableError, _validated_model_cache
        _validated_model_cache.clear()
        async def _validate(name):
            return False
        mock_validate.side_effect = _validate
        async def _list():
            return []
        mock_list.side_effect = _list
        with pytest.raises(ModelUnavailableError):
            asyncio.run(get_working_model())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && python -m pytest test_main.py::TestModelValidation -q`
Expected: FAIL (`ImportError: ModelUnavailableError` and/or dynamic-fallback assertion).

- [ ] **Step 3: Implement the rework**

In `apps/server/services/gemini_service.py`, add the exception near the top (after imports):

```python
class ModelUnavailableError(RuntimeError):
    """Raised when no compatible Gemini model can be found."""
```

Replace `get_working_model()` (lines ~74-89) with:

```python
async def get_working_model() -> str:
    """Return a working model id, validating the configured model first and
    falling back to dynamic discovery via the live models list.

    Raises ModelUnavailableError when no compatible model can be found.
    """
    configured = get_model_name()
    if await validate_model(configured):
        _validated_model_cache["model"] = configured
        return configured

    logger.warning("Configured model '%s' unavailable, discovering alternatives…", configured)
    best = rank_models(await get_available_models())
    if best:
        logger.info("Selected fallback model via discovery: %s", best)
        _validated_model_cache["model"] = best
        return best

    logger.error("No compatible Gemini model found via discovery!")
    raise ModelUnavailableError("No compatible Gemini model is available for this API key.")
```

Delete the now-unused `_FALLBACK_MODELS` constant (line ~31).

Update the startup caller in `apps/server/main.py:194-201` to tolerate the new exception (it already wraps in try/except and logs, so confirm `ModelUnavailableError` is caught by the broad `except Exception`). No code change needed there beyond confirming.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && python -m pytest test_main.py::TestModelValidation -q`
Expected: PASS. Also run the existing available-models tests: `python -m pytest test_main.py -k "available_models or ModelValidation" -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/services/gemini_service.py apps/server/test_main.py
git commit -m "feat(server): use dynamic discovery as model fallback, drop hardcoded chain (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Server reactive re-resolve + retry on model-not-found

**Files:**
- Modify: `apps/server/services/gemini_service.py` (the `GeminiVisionModel.generate_content` path, ~line 623-631)
- Test: `apps/server/test_main.py` (new `TestReactiveRetry`)

- [ ] **Step 1: Write the failing test**

Add to `apps/server/test_main.py`:

```python
class TestReactiveRetry:
    @patch.dict(os.environ, {"GEMINI_API_KEY": "k"})
    def test_generate_reresolves_and_retries_on_model_not_found(self):
        from services.gemini_service import GeminiVisionModel, _validated_model_cache
        _validated_model_cache["model"] = "gemini-2.5-flash"

        calls = {"n": 0}
        class FakeResp:
            text = "ok"
        class FakeModels:
            def generate_content(self, model, contents):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise Exception("404 NOT_FOUND: model gemini-2.5-flash is not found")
                return FakeResp()
        class FakeClient:
            models = FakeModels()

        vm = GeminiVisionModel(FakeClient())
        with patch("services.gemini_service.get_working_model_force", return_value="gemini-2.5-pro"):
            resp = vm.generate_content("hi")
        assert resp.text == "ok"
        assert calls["n"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && python -m pytest test_main.py::TestReactiveRetry -q`
Expected: FAIL (`get_working_model_force` undefined and/or no retry).

- [ ] **Step 3: Implement reactive retry**

In `apps/server/services/gemini_service.py`, add a synchronous force-refresh helper near the cache:

```python
def get_working_model_force() -> str:
    """Synchronously re-resolve a working model, bypassing the cache.

    Runs the async resolver in a fresh event loop (safe because the SDK call
    is already off the asyncio loop in a thread executor).
    """
    _validated_model_cache.pop("model", None)
    return asyncio.run(get_working_model())
```

Replace `GeminiVisionModel.generate_content` (~line 623) with:

```python
    def generate_content(self, contents):
        """Call generate_content; on a model-not-found error, re-resolve the
        working model once and retry."""
        try:
            return self._client.models.generate_content(
                model=get_working_model_sync(),
                contents=contents,
            )
        except Exception as e:
            text = str(e).lower()
            is_model_gone = ("not_found" in text and "model" in text) or (
                "404" in text and "model" in text
            )
            if not is_model_gone:
                raise
            logger.warning("Model not found during generation; re-resolving…")
            new_model = get_working_model_force()
            return self._client.models.generate_content(
                model=new_model, contents=contents,
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && python -m pytest test_main.py::TestReactiveRetry -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/services/gemini_service.py apps/server/test_main.py
git commit -m "feat(server): re-resolve model and retry once on model-not-found (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Server opt-in LIVE integration test — prove `models.list()` works

> This is the test that confirms the real model-listing method works against the
> live Gemini API. It is skipped unless `GEMINI_API_KEY` is set, so CI stays
> hermetic but a developer can run it on demand.

**Files:**
- Test: `apps/server/test_main.py` (new `TestLiveModelListing`)

- [ ] **Step 1: Write the integration test**

Add to `apps/server/test_main.py`:

```python
@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY"),
    reason="requires a real GEMINI_API_KEY (opt-in live integration test)",
)
class TestLiveModelListing:
    """Opt-in: hits the real Gemini API to prove discovery works end-to-end."""

    def test_get_available_models_returns_real_models(self):
        import asyncio
        # Reset any cached client so the env key is used.
        import services.gemini_service as gs
        gs._gemini_client = None
        models = asyncio.run(gs.get_available_models())
        assert isinstance(models, list)
        assert len(models) > 0, "Expected at least one generateContent model"
        assert all("id" in m for m in models)

    def test_rank_models_picks_a_real_model(self):
        import asyncio
        import services.gemini_service as gs
        gs._gemini_client = None
        best = gs.rank_models(asyncio.run(gs.get_available_models()))
        assert best, "rank_models should select a model from the live list"
        # The selected model must actually validate against the API.
        assert asyncio.run(gs.validate_model(best)) is True
```

- [ ] **Step 2: Verify it skips without a key**

Run: `cd apps/server && python -m pytest test_main.py::TestLiveModelListing -q`
Expected: `2 skipped` (no `GEMINI_API_KEY` in env).

- [ ] **Step 3: Verify it passes with a key (manual / optional)**

Run: `cd apps/server && GEMINI_API_KEY=<real-key> python -m pytest test_main.py::TestLiveModelListing -q`
Expected: `2 passed` — confirms the live listing + ranking + validation chain works.

- [ ] **Step 4: Commit**

```bash
git add apps/server/test_main.py
git commit -m "test(server): add opt-in live integration test for model listing (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Native `rankModels()` pure helper (mirrors server)

**Files:**
- Create: `apps/web/src/services/ai/modelResolver.ts`
- Test: `apps/web/src/services/ai/modelResolver.test.ts`

- [ ] **Step 1: Write the failing tests** (mirror the server ranking table)

Create `apps/web/src/services/ai/modelResolver.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { rankModels } from './modelResolver'

const m = (name: string) => ({ name, supportedActions: ['generateContent'] })

describe('rankModels', () => {
  it('prefers flash over pro', () => {
    expect(rankModels([m('gemini-2.5-pro'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('prefers higher version', () => {
    expect(rankModels([m('gemini-2.0-flash'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('flash beats flash-lite', () => {
    expect(rankModels([m('gemini-2.5-flash-lite'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('flash-lite beats pro', () => {
    expect(rankModels([m('gemini-2.5-pro'), m('gemini-2.5-flash-lite')])).toBe('gemini-2.5-flash-lite')
  })
  it('prefers stable over preview', () => {
    expect(rankModels([m('gemini-3.0-flash-preview-09-2025'), m('gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('allows preview as last resort', () => {
    expect(rankModels([m('gemini-3.0-flash-exp')])).toBe('gemini-3.0-flash-exp')
  })
  it('excludes non-text families', () => {
    expect(rankModels([m('imagen-4.0-generate-001'), m('text-embedding-004')])).toBeNull()
  })
  it('strips models/ prefix', () => {
    expect(rankModels([m('models/gemini-2.5-flash')])).toBe('gemini-2.5-flash')
  })
  it('filters models without generateContent', () => {
    expect(rankModels([{ name: 'gemini-2.5-flash', supportedActions: ['embedContent'] }])).toBeNull()
  })
  it('returns null for empty input', () => {
    expect(rankModels([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && bun run test:run modelResolver.test`
Expected: FAIL (`rankModels` not exported / module missing).

- [ ] **Step 3: Implement `rankModels`**

Create `apps/web/src/services/ai/modelResolver.ts`:

```ts
/**
 * Dynamic Gemini model discovery & ranking for the native/browser runtime.
 * Mirrors the server-side heuristic in services/gemini_service.py (#485).
 */

export interface DiscoveredModel {
  name: string
  supportedActions?: string[]
}

const NON_TEXT_FRAGMENTS = ['embedding', 'aqa', 'imagen', 'image', 'tts']
const UNSTABLE_RE = /(preview|experimental|-exp\b|exp$|-\d{2}-\d{2}|-\d{3,4}$)/

function shortName(name: string): string {
  return (name.split('/').pop() ?? '').trim().toLowerCase()
}

/**
 * Pick the best generateContent-capable model from a discovered list.
 * Returns the model id (without the 'models/' prefix) or null.
 */
export function rankModels(models: DiscoveredModel[]): string | null {
  const candidates = models
    .filter(m => (m.supportedActions ?? ['generateContent']).includes('generateContent'))
    .map(m => shortName(m.name))
    .filter(s => s && !NON_TEXT_FRAGMENTS.some(f => s.includes(f)))

  if (candidates.length === 0) return null

  const score = (s: string): [number, number, number, number, string] => {
    const unstable = UNSTABLE_RE.test(s) ? 1 : 0
    const cls = s.includes('flash-lite') ? 1 : s.includes('flash') ? 0 : s.includes('pro') ? 2 : 3
    const vm = s.match(/gemini-(\d+)\.(\d+)/)
    const major = vm ? parseInt(vm[1], 10) : 0
    const minor = vm ? parseInt(vm[2], 10) : 0
    return [unstable, cls, -major, -minor, s]
  }

  return candidates.slice().sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    for (let i = 0; i < 4; i++) {
      if ((sa[i] as number) !== (sb[i] as number)) return (sa[i] as number) - (sb[i] as number)
    }
    return (sa[4] as string).localeCompare(sb[4] as string)
  })[0]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && bun run test:run modelResolver.test`
Expected: PASS (9 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/ai/modelResolver.ts apps/web/src/services/ai/modelResolver.test.ts
git commit -m "feat(native): add rankModels heuristic mirroring server (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Native `resolveWorkingModel()` with in-memory cache

**Files:**
- Modify: `apps/web/src/services/ai/modelResolver.ts` (add resolver + cache)
- Test: `apps/web/src/services/ai/modelResolver.test.ts` (add resolver tests)

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/services/ai/modelResolver.test.ts`:

```ts
import { resolveWorkingModel, __resetModelCache } from './modelResolver'

interface FakeClient {
  models: {
    get: (args: { model: string }) => Promise<unknown>
    list: () => Promise<{ name: string; supportedActions: string[] }[]>
  }
}

const makeClient = (opts: { validConfigured: boolean; list: string[] }): FakeClient => ({
  models: {
    get: async ({ model }) => {
      if (opts.validConfigured && model === 'gemini-2.5-flash') return {}
      throw new Error('404 NOT_FOUND')
    },
    list: async () => opts.list.map(n => ({ name: n, supportedActions: ['generateContent'] })),
  },
})

describe('resolveWorkingModel', () => {
  beforeEach(() => __resetModelCache())

  it('returns the configured model when it validates', async () => {
    const c = makeClient({ validConfigured: true, list: ['gemini-2.5-pro'] })
    expect(await resolveWorkingModel(c as never, 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('falls back to a discovered model when configured is dead', async () => {
    const c = makeClient({ validConfigured: false, list: ['gemini-2.5-pro', 'gemini-2.5-flash'] })
    expect(await resolveWorkingModel(c as never, 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('throws MODEL_NOT_FOUND when nothing is available', async () => {
    const c = makeClient({ validConfigured: false, list: [] })
    await expect(resolveWorkingModel(c as never, 'gemini-2.5-flash')).rejects.toThrow('MODEL_NOT_FOUND')
  })

  it('caches the resolved model (no second validation)', async () => {
    const c = makeClient({ validConfigured: true, list: [] })
    let getCalls = 0
    const orig = c.models.get
    c.models.get = async (a) => { getCalls++; return orig(a) }
    await resolveWorkingModel(c as never, 'gemini-2.5-flash')
    await resolveWorkingModel(c as never, 'gemini-2.5-flash')
    expect(getCalls).toBe(1)
  })

  it('forceRefresh bypasses the cache', async () => {
    const c = makeClient({ validConfigured: true, list: [] })
    let getCalls = 0
    const orig = c.models.get
    c.models.get = async (a) => { getCalls++; return orig(a) }
    await resolveWorkingModel(c as never, 'gemini-2.5-flash')
    await resolveWorkingModel(c as never, 'gemini-2.5-flash', true)
    expect(getCalls).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && bun run test:run modelResolver.test`
Expected: FAIL (`resolveWorkingModel` / `__resetModelCache` not exported).

- [ ] **Step 3: Implement the resolver**

Append to `apps/web/src/services/ai/modelResolver.ts`:

```ts
import { AIServiceError } from './BrowserAIService'

/** Minimal shape of the @google/genai client we depend on. */
export interface ModelClient {
  models: {
    get: (args: { model: string }) => Promise<unknown>
    list: () => Promise<Iterable<DiscoveredModel> | AsyncIterable<DiscoveredModel>>
  }
}

let _cachedModel: string | null = null

/** Test-only: clear the in-memory resolved-model cache. */
export function __resetModelCache(): void {
  _cachedModel = null
}

async function validateModel(client: ModelClient, model: string): Promise<boolean> {
  try {
    await client.models.get({ model })
    return true
  } catch {
    return false
  }
}

async function listModels(client: ModelClient): Promise<DiscoveredModel[]> {
  const out: DiscoveredModel[] = []
  const res = await client.models.list()
  // The SDK may return a sync iterable or an async pager.
  for await (const m of res as AsyncIterable<DiscoveredModel>) out.push(m)
  return out
}

/**
 * Resolve a working, served model id. Tries the configured model first, then
 * dynamic discovery. Caches the result in memory (session-scoped). Throws
 * AIServiceError('MODEL_NOT_FOUND') when nothing compatible is available.
 */
export async function resolveWorkingModel(
  client: ModelClient,
  configured: string,
  forceRefresh = false,
): Promise<string> {
  if (_cachedModel && !forceRefresh) return _cachedModel

  // On a forced refresh, skip the (likely dead) configured model and go
  // straight to discovery. Otherwise honor the configured model when served.
  if (!forceRefresh && await validateModel(client, configured)) {
    _cachedModel = configured
    return configured
  }

  const best = rankModels(await listModels(client))
  if (best) {
    _cachedModel = best
    return best
  }
  throw new AIServiceError('MODEL_NOT_FOUND')
}
```

> Note: `listModels` uses `for await` so it works whether `models.list()` returns
> a plain array (as in the fakes) or the SDK's async pager. Verify against the
> installed `@google/genai` version during implementation; if `list()` returns a
> `Pager`, `for await` is supported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && bun run test:run modelResolver.test`
Expected: PASS (14 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/ai/modelResolver.ts apps/web/src/services/ai/modelResolver.test.ts
git commit -m "feat(native): add resolveWorkingModel with in-memory cache (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Wire `BrowserAIService` text generation through the resolver + reactive retry

**Files:**
- Modify: `apps/web/src/services/ai/BrowserAIService.ts` (model selection + retry)
- Test: `apps/web/src/services/ai/BrowserAIService.modelRetry.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/services/ai/BrowserAIService.modelRetry.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { __resetModelCache } from './modelResolver'
import { generateTextWithRetry } from './BrowserAIService'

describe('BrowserAIService reactive model retry', () => {
  beforeEach(() => __resetModelCache())

  it('re-resolves and retries once on MODEL_NOT_FOUND', async () => {
    const generateContent = vi.fn()
      .mockRejectedValueOnce(new Error('404 NOT_FOUND: model gemini-2.5-flash'))
      .mockResolvedValueOnce({ text: 'ok' })
    const fakeClient = {
      models: {
        generateContent,
        get: vi.fn().mockResolvedValue({}),
        list: vi.fn().mockResolvedValue([{ name: 'gemini-2.5-pro', supportedActions: ['generateContent'] }]),
      },
    }
    const res = await generateTextWithRetry(fakeClient as never, 'gemini-2.5-flash', { contents: 'hi' })
    expect((res as { text: string }).text).toBe('ok')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run test:run BrowserAIService.modelRetry`
Expected: FAIL (`generateTextWithRetry` not exported).

- [ ] **Step 3: Implement the wiring**

In `apps/web/src/services/ai/BrowserAIService.ts`:

1. Import the resolver at the top:

```ts
import { resolveWorkingModel, type ModelClient } from './modelResolver'
```

2. Add an exported helper that all text generation goes through:

```ts
/**
 * Run a text generateContent call through dynamic model resolution with a
 * single reactive retry: if the call fails with a model-not-found error, the
 * working model is re-resolved (bypassing cache) and the call is retried once.
 */
export async function generateTextWithRetry(
  client: ModelClient & { models: { generateContent: (args: { model: string; contents: unknown; config?: unknown }) => Promise<unknown> } },
  configured: string,
  req: { contents: unknown; config?: unknown },
): Promise<unknown> {
  const model = await resolveWorkingModel(client, configured)
  try {
    return await client.models.generateContent({ model, ...req })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!(msg.includes('404') || msg.includes('NOT_FOUND'))) throw err
    const retryModel = await resolveWorkingModel(client, configured, true)
    return client.models.generateContent({ model: retryModel, ...req })
  }
}
```

3. Replace each **text** `client.models.generateContent({ model: getGeminiModel(), ... })` call (lines ~140, ~154, ~191, ~260, ~305) with a call through `generateTextWithRetry(client, getGeminiModel(), { contents, config })`. Keep the existing `retryWithBackoff` wrapper for transient/network errors; `generateTextWithRetry` handles only model-not-found. Leave the **image** `generateImages` calls (lines ~213/223) unchanged.

> Implementation note: preserve each call site's existing `contents`/`config`
> payload exactly; only the model selection and the model-not-found retry change.
> `ModelClient` from Task 6 only types `get`/`list`; the intersection type in the
> helper signature adds `generateContent`, so no change to `modelResolver.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bun run test:run BrowserAIService`
Expected: PASS. Then run the full AI test group: `bun run test:run ai` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/ai/BrowserAIService.ts apps/web/src/services/ai/BrowserAIService.modelRetry.test.ts
git commit -m "feat(native): route text generation through dynamic model resolver with retry (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Native opt-in LIVE integration test — prove SDK `models.list()` works

> Native counterpart of Task 4. Skipped unless a real key is provided via
> `GEMINI_API_KEY` (read through `process.env` in the vitest/node environment).

**Files:**
- Create: `apps/web/src/services/ai/modelResolver.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `apps/web/src/services/ai/modelResolver.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GoogleGenAI } from '@google/genai'
import { rankModels, type DiscoveredModel } from './modelResolver'

const KEY = process.env.GEMINI_API_KEY
const maybe = KEY ? describe : describe.skip

maybe('LIVE: Gemini models.list() (opt-in)', () => {
  it('lists real models and ranks one that validates', async () => {
    const client = new GoogleGenAI({ apiKey: KEY! })
    const models: DiscoveredModel[] = []
    for await (const m of await client.models.list()) {
      models.push(m as unknown as DiscoveredModel)
    }
    expect(models.length).toBeGreaterThan(0)

    const best = rankModels(models)
    expect(best).toBeTruthy()

    // The chosen model must exist on the API.
    await expect(client.models.get({ model: best! })).resolves.toBeTruthy()
  }, 30_000)
})
```

- [ ] **Step 2: Verify it skips without a key**

Run: `cd apps/web && bun run test:run modelResolver.integration`
Expected: the suite is skipped (0 tests run / suite skipped).

- [ ] **Step 3: Verify it passes with a key (manual / optional)**

Run: `cd apps/web && GEMINI_API_KEY=<real-key> bun run test:run modelResolver.integration`
Expected: PASS — confirms the live SDK listing + ranking + validation chain works in the native runtime.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/services/ai/modelResolver.integration.test.ts
git commit -m "test(native): add opt-in live integration test for SDK model listing (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Delete dead `directModeAI.ts`

**Files:**
- Delete: `apps/web/src/lib/directModeAI.ts`
- Verify: no remaining imports

- [ ] **Step 1: Confirm it is unused**

Run: `cd apps/web && grep -rn "directModeAI" src --include=*.ts --include=*.tsx | grep -v "lib/directModeAI.ts:"`
Expected: only doc-comment references (in `profileValidator.ts`, `profilePromptFull.ts`), no `import ... from '.../directModeAI'`. If any real import exists, STOP and reassess.

- [ ] **Step 2: Delete the file and any test for it**

```bash
cd apps/web && git rm src/lib/directModeAI.ts
# remove its test if one exists:
git rm src/lib/directModeAI.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Update stale doc comments**

Edit `apps/web/src/lib/profileValidator.ts` and `apps/web/src/services/ai/profilePromptFull.ts` to drop the "Used by directModeAI.ts" references (replace with "Used by BrowserAIService.ts").

- [ ] **Step 4: Verify build/lint/tests are clean**

Run: `cd apps/web && bun run lint && bun run test:run && bun run build`
Expected: 0 lint errors, all tests pass, build succeeds. If anything referenced `directModeAI`, fix it now.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(native): remove dead directModeAI.ts (superseded by BrowserAIService) (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 10: User-facing "no compatible model" error + i18n (all 6 locales)

**Files:**
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`
- Verify: the error path surfaces this message (server `parse_gemini_error` already returns friendly text; confirm native UI maps `MODEL_NOT_FOUND`)

- [ ] **Step 1: Locate the AI error namespace**

Run: `cd apps/web && grep -rn "MODEL_NOT_FOUND\|aiError\|API_KEY_MISSING" src --include=*.tsx | head`
Identify where `AIServiceError.code` is translated for the user (the catch site that renders a toast/message). If codes are surfaced raw, add a small mapping `t(\`aiErrors.${code}\`)` at that site.

- [ ] **Step 2: Add the i18n keys (English)**

In `apps/web/public/locales/en/translation.json`, under the appropriate errors object (create an `aiErrors` group if none exists), add:

```json
"aiErrors": {
  "MODEL_NOT_FOUND": "No compatible AI model is available for your API key. Please check your Gemini access or update Metic to the latest version."
}
```

- [ ] **Step 3: Add translations to the other 5 locales**

Add the same `aiErrors.MODEL_NOT_FOUND` key with translated values to `sv, de, es, fr, it`:

- `sv`: "Ingen kompatibel AI-modell är tillgänglig för din API-nyckel. Kontrollera din Gemini-åtkomst eller uppdatera Metic till senaste versionen."
- `de`: "Für deinen API-Schlüssel ist kein kompatibles KI-Modell verfügbar. Bitte prüfe deinen Gemini-Zugang oder aktualisiere Metic auf die neueste Version."
- `es`: "No hay ningún modelo de IA compatible disponible para tu clave de API. Comprueba tu acceso a Gemini o actualiza Metic a la última versión."
- `fr`: "Aucun modèle d'IA compatible n'est disponible pour votre clé API. Vérifiez votre accès à Gemini ou mettez à jour Metic vers la dernière version."
- `it`: "Nessun modello IA compatibile è disponibile per la tua chiave API. Controlla il tuo accesso a Gemini o aggiorna Metic all'ultima versione."

- [ ] **Step 4: Verify**

Run: `cd apps/web && bun run lint && bun run test:run && bun run build`
Expected: green. Confirm the i18n key parity check (if the repo has one) passes for all 6 locales.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/locales
git commit -m "feat(i18n): add no-compatible-model AI error message in all locales (#485)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 11: Final dual-runtime gate + parity check

**Files:** none (verification only)

- [ ] **Step 1: Backend gate**

Run: `cd apps/server && python -m pytest test_main.py -q`
Expected: all pass (including the new `TestRankModels`, `TestModelValidation`, `TestReactiveRetry`; `TestLiveModelListing` skipped without a key).

- [ ] **Step 2: Frontend gate**

Run: `cd apps/web && bun run lint && bun run test:run && bun run build`
Expected: 0 lint errors, all tests pass (live integration suite skipped), build succeeds.

- [ ] **Step 3: Native iOS sync (if building the app)**

Run: `cd apps/web && bun run build:ios`
Expected: web build + `cap sync ios` succeed (regenerates `public/`, `config.xml`, `capacitor.config.json`).

- [ ] **Step 4: Parity confirmation (Quality Gate #7)**

Manually confirm both runtimes implement: configured-first resolution, dynamic ranked fallback, proactive cache, reactive re-resolve+retry, and the same user-facing error. The ranking test tables match between `test_main.py::TestRankModels` and `modelResolver.test.ts`.

- [ ] **Step 5: Final commit (if any cleanup) / open PR**

```bash
git status   # ensure clean
# (open PR via the app's PR tool when ready)
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Pure-dynamic resolution → Tasks 2, 6. ✓
- Ranking heuristic (stable/flash/version/exclusions) → Tasks 1, 5. ✓
- Proactive + reactive recovery → Tasks 2/3 (server), 6/7 (native). ✓
- Dead-code removal (`directModeAI.ts`) → Task 9. ✓
- Clear user-facing error + i18n in 6 locales → Task 10. ✓
- Tests for model-unavailable & fallback, both runtimes → Tasks 1-3, 5-7. ✓
- **Live model-listing works** (user's explicit ask) → Tasks 4 (server) & 8 (native), opt-in integration tests. ✓
- Dual-runtime parity (Gate #7) → Task 11 + mirrored test tables. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `rank_models`/`rankModels` return model id (prefix stripped) or null/None; `resolveWorkingModel(client, configured, forceRefresh?)` and `generateTextWithRetry(client, configured, req)` signatures are consistent across Tasks 6-7; `AIServiceError('MODEL_NOT_FOUND')` matches the existing `AIErrorCode`. ✓

**Note for implementer:** Confirm the installed `@google/genai` version's `models.list()` return type (array vs async `Pager`) in Task 6; the `for await` loop handles both, but adjust the `ModelClient.list` type if the SDK types differ.
