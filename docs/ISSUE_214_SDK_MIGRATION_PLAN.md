# Issue #214 — Gemini CLI to Python SDK Migration Plan

## 1. Goal

Replace Gemini CLI subprocess usage in `/api/analyze_and_profile` with a Python SDK-based implementation that preserves current API behavior while enabling robust tool/function-calling for profile creation and application.

## Implementation Status (2026-02-28)

- ✅ CLI subprocess path removed from `apps/server/api/routes/coffee.py`.
- ✅ Gemini SDK generation path is active for profile creation prompts.
- ✅ Model output JSON is extracted and profile creation is executed via `async_create_profile(...)`.
- ✅ Backward-compatible API response fields are preserved (`status`, `analysis`, `reply`, `history_id`, error `message`).
- ✅ Regression suite validation completed:
  - `TEST_MODE=true python3 -m pytest test_main.py -x -q` → 572 passed
  - `TEST_MODE=true python3 -m pytest test_logging.py -x -q` → 19 passed
  - `bats tests/test_install.bats` → 159 passed

Notes:

- The current implementation uses SDK generation + server-side profile creation (JSON extraction flow) rather than a full SDK tool-calling loop.
- Stage 3 (explicit function-calling loop with retries/allowlisted tool dispatch) can be layered on top of the current path if stricter MCP-style orchestration is still desired.

## 2. Current State

- The analyze-and-profile path in `apps/server/api/routes/coffee.py` currently invokes Gemini via subprocess (pattern: `subprocess.run(["gemini", "-y", prompt], ...)`).
- Output is post-processed in Python (including JSON extraction/cleanup) before returning API responses.
- Profile creation/application behavior is currently coupled to CLI output shape and parsing noise handling.

## 3. Non-Goals

- No endpoint contract redesign for `/api/analyze_and_profile`.
- No UI workflow or payload schema changes in `apps/web/`.
- No broad refactor of unrelated analysis endpoints.
- No immediate removal of existing fallback/error messaging semantics.

## 4. Stage Plan

### Stage 1 — Parity extraction with SDK text generation

- Introduce SDK-backed model invocation in service layer (candidate location: `apps/server/services/gemini_service.py`).
- Keep response assembly identical to current route behavior in `apps/server/api/routes/coffee.py`.
- Preserve existing JSON extraction and cleanup behavior for history writes and API response compatibility.
- Acceptance: same successful response shape and equivalent extracted analysis payloads from representative fixtures.

### Stage 2 — Python tool-execution layer with strict allowlist

- Add a dedicated tool execution module (candidate: `apps/server/services/tool_executor.py`) for profile operations.
- Implement strict allowlist limited to `create_profile` and `apply_profile` operations (matching current security expectations).
- Normalize tool input/output and explicit error mapping before returning to route layer.
- Acceptance: tools can be executed from Python without CLI dependency; disallowed tool names are rejected deterministically.

### Stage 3 — Function-calling loop, retries, and validation handling

- Implement SDK function-calling/tool loop orchestration in analysis flow (candidate integration in `apps/server/services/analysis_service.py`).
- Add bounded retries for transient model/tool failures and explicit validation branches for malformed tool args/results.
- Reuse schema validation patterns already used for profile payload quality gates.
- Acceptance: deterministic retry limits, clear validation errors, and stable success path across flaky-response scenarios.

### Stage 4 — Remove CLI-specific code and tighten tests

- Remove CLI subprocess invocation and noise-parsing branches once parity and tool loop are proven.
- Delete dead helpers tied only to CLI transport behavior.
- Strengthen tests around SDK path, tool loop, and error mapping in `apps/server/test_main.py` (and related service tests if split).
- Acceptance: no runtime dependency on `gemini` binary for analyze-and-profile path; tests pass under `TEST_MODE=true`.

## 5. Backward Compatibility Contract

- Preserve response fields exactly for existing clients:
  - Success path fields: `status`, `analysis`, `reply`, `history_id`.
  - Error path field: `message` (with current user-facing semantics).
- Preserve history JSON extraction behavior:
  - Continue extracting normalized JSON analysis used for persistence/history records.
  - Maintain equivalent behavior when model output includes extra prose/wrappers.
  - Do not change existing history record shape consumed by history endpoints.

## 6. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| SDK output differs from CLI text shape | Parsing/compatibility regressions in API response/history | Keep Stage 1 parity harness with fixture comparisons against current outputs before switching default |
| Tool loop can call unintended operations | Security and safety regression | Enforce strict allowlist (`create_profile`, `apply_profile`) with explicit reject path and tests |
| Validation failures for tool args/results | Runtime failures and unclear user errors | Add explicit schema validation + user-safe error mapping + bounded retries |
| Retry logic causes latency spikes | Slower endpoint responses | Use small bounded retry count, timeout caps, and structured logging for tuning |
| Mixed old/new path behavior during migration | Hard-to-debug inconsistencies | Introduce feature flag and route-level branch with deterministic logging of selected path |

## 7. Test Plan

Targeted commands (from `apps/server`):

- `TEST_MODE=true python3 -m pytest test_main.py -k "analyze_and_profile" -q`
- `TEST_MODE=true python3 -m pytest test_main.py -k "llm_analysis or convert_description" -q`
- `TEST_MODE=true python3 -m pytest test_logging.py -q`

Scenarios to cover:

- Parity success: SDK path returns same top-level fields and compatible `analysis`/`reply` formatting.
- History extraction: noisy model text still yields expected normalized JSON persisted for history.
- Tool allowlist: allowed tools succeed; non-allowlisted tool calls fail with controlled error `message`.
- Retry/validation: transient model/tool errors retry within limit; malformed tool args surface deterministic validation errors.
- Error compatibility: client-visible error payload still includes expected `message` semantics.

## 8. Rollout / Feature Flag Suggestion

- Add server-side feature flag (e.g., environment variable in `apps/server/config.py`) to select transport path:
  - `false` (default initially): keep CLI path.
  - `true`: enable Python SDK + tool loop path.
- Rollout steps:
  1. Ship dark (flag off) with tests merged.
  2. Enable in dev/local and CI test matrix variant.
  3. Enable in production-like environment with monitoring.
  4. Flip default to SDK after stability window; then remove CLI code in Stage 4.
