# Post-Mortem: "Untitled Profile" Crash (2026-02-23)

## Incident Summary

**Severity:** Critical — Profile Catalogue completely broken  
**Duration:** ~24 hours (first reported → fix deployed)  
**Impact:** UI showed 1 entry as "Untitled Profile", crashed with `Ce.match is not a function` on click  
**Root Cause:** Test data artifact in Docker named volume + missing null guards in frontend  
**Fix:** Commit `feb5182` on `version/2.0.0`

---

## Timeline

| Time | Event |
|------|-------|
| 2026-02-09 | Docker volume `meticai-data` created on local machine |
| Unknown | Test artifact `{"id": "test123", "name": "TestProfile"}` written to `/data/profile_history.json` inside the named volume |
| 2026-02-23 ~17:00 | User reports Profile Catalogue broken — 1 entry, "Untitled Profile", crash on click |
| 2026-02-23 ~18:00 | Investigation begins. API endpoints return 200, not 500 (user saw stale errors from previous container) |
| 2026-02-23 ~18:30 | Root cause identified: malformed entry in Docker volume's `profile_history.json` |
| 2026-02-23 ~19:00 | Fix implemented: backend validation + frontend null guards |
| 2026-02-23 ~22:00 | All tests pass (547 Python + 235 web), container rebuilt, API verified via curl |
| 2026-02-23 ~23:00 | Browser testing confirms zero console errors, all views functional |
| 2026-02-23 ~23:15 | Fix deployed to Pi |

---

## Root Cause Analysis

### The Data

The Docker named volume `meticai-data` (mounted at `/data` inside the container) contained a file `profile_history.json` with this content:

```json
[{"id": "test123", "name": "TestProfile"}]
```

This is a **test fixture** — the exact data written by `test_main.py` line ~5424. A valid v2 history entry requires fields like `profile_name`, `reply`, `profile_json`, and `created_at`. This entry has none of them — only `id` and `name` (which isn't even a recognized field).

### How It Got There

The Docker named volume `meticai-data` is **separate** from the host's `./data/` directory. The volume persists across container rebuilds and `docker compose down/up` cycles.

The test suite (`test_main.py`) includes tests that write directly to `HISTORY_FILE` (which resolves to `DATA_DIR / "profile_history.json"`). The `conftest.py` creates a temporary directory and sets `DATA_DIR` to isolate tests. However:

1. The named volume was created on **2026-02-09**
2. At some point, test code ran in a context where `DATA_DIR` resolved to `/data` (the production path inside the container), rather than a temporary directory
3. The most likely scenario: a test was executed inside the running container (`docker exec meticai ...`) before proper test isolation was fully in place, or a manual debugging session wrote this entry
4. The entry persisted in the named volume indefinitely — surviving every `docker compose down && up` and image rebuild

### The Failure Chain

```
Malformed entry in volume
    ↓
history_service.load_history() loads it without validation
    ↓
API returns entry with profile_name derived as "Untitled Profile"
(fallback: profile_json.get("name") → "Untitled Profile" since profile_json is None)
    ↓
Frontend renders "Untitled Profile" in catalogue
    ↓
User clicks entry → HistoryView.tsx opens detail view
    ↓
parseProfileSections(entry.reply) called where entry.reply is undefined
    ↓
entry.reply.match(headerPattern) → TypeError: Cannot read properties of undefined
    ↓
Minified as "Ce.match is not a function" → full page crash
```

---

## What Was Fixed

### 1. Backend Validation (`history_service.py`)
- `load_history()` now validates every entry on load
- Entries missing **both** `profile_name` and `reply` are silently dropped
- Dropped entries are logged as warnings: `"Dropping malformed history entry (no profile_name or reply): id=..."`
- Cleaned data is persisted back to disk, preventing the same bad data from being loaded again

### 2. Frontend Null Guards (`HistoryView.tsx`)
- `parseProfileSections(text)` now accepts `string | undefined | null` and returns `[]` for falsy input
- `handleSaveImage` now uses `(entry.profile_name || 'profile')` instead of raw `entry.profile_name`

### 3. Test Data Schema (`test_main.py`)
- `test_load_history_with_valid_file` updated to use proper v2 schema (includes `profile_name` and `reply`)
- New test `test_load_history_filters_malformed_entries` validates that malformed entries are filtered out

### Files Changed
```
apps/server/services/history_service.py  | +38 -3
apps/server/test_main.py                 | +22 -2
apps/web/src/components/HistoryView.tsx  | +3 -2
```

---

## Lessons Learned

### 1. Named Docker Volumes Are Invisible State
The `meticai-data` named volume persists silently across rebuilds. Data written to it — even by accident — survives `docker compose down`, image rebuilds, and redeployments. This made the bug appear "permanent" and hard to trace.

**Recommendation:** Add a data migration/validation step to the container's startup sequence (s6 `init` stage) that validates critical JSON files before the server starts.

### 2. Backend Should Never Trust Data On Disk
The `load_history()` function loaded and returned whatever was in `profile_history.json` without any schema validation. A single malformed entry broke the entire UI.

**Recommendation:** All data loading functions should validate entries against expected schemas and log/discard malformed data.

### 3. Frontend Must Defend Against Missing Fields
The frontend assumed `entry.reply` would always be a string. A single undefined field caused a full-page crash in the minified bundle.

**Recommendation:** All data destructured from API responses should use optional chaining (`?.`) or null guards, especially before calling string methods like `.match()`.

### 4. Test Fixtures Should Match Production Schema
The test used `{"id": "test123", "name": "TestProfile"}` which doesn't match the v2 schema at all. Even if test isolation works perfectly, having tests that write invalid data means any leak will cause production failures.

**Recommendation:** Test fixtures should always use realistic, schema-valid data.

---

## Verification

| Check | Result |
|-------|--------|
| Python tests (547) | ✅ All pass |
| Web tests (235) | ✅ All pass |
| `GET /api/history` | ✅ Returns `{"entries": [], "total": 0}` (malformed entry filtered) |
| `GET /api/machine/profiles` | ✅ Returns 18 profiles |
| `GET /api/last-shot` | ✅ Returns "Tropic Like It's Hot" |
| Browser: Home page | ✅ Loads, machine connected, no errors |
| Browser: Profile Catalogue | ✅ Displays valid entries, no crash |
| Browser: Profile Detail | ✅ All sections render correctly |
| Browser: Profile Dropdown | ✅ Shows all 18 machine profiles |
| Browser: Console errors | ✅ Zero errors |
| Pi deployment | ✅ Container healthy, endpoints responding |
