# Test Fixes Documentation

## Overview
This document explains the test failures that occurred after recent bugfixes and how they were resolved without rolling back the improvements.

---

## Latest Fix (January 2026) - Post-Caching Implementation

### Problem Statement
After adding server-side LLM analysis caching, **19 Python tests were failing**:
- **5 LLM analysis tests**: Permission denied errors on `/app/data`
- **6 Barista persona tests**: TypeError when accessing NoneType
- **8 analyze_and_profile tests**: Status returning 'error' instead of 'success'

### Root Causes

#### 1. Hardcoded Data Paths
**Issue**: All data files used hardcoded `/app/data` paths which don't exist in test environment.

**Root Cause**: Paths were defined as constants at module level:
```python
SETTINGS_FILE = Path("/app/data/settings.json")
HISTORY_FILE = Path("/app/data/profile_history.json")
LLM_CACHE_FILE = Path("/app/data/llm_analysis_cache.json")
SHOT_CACHE_FILE = Path("/app/data/shot_cache.json")
IMAGE_CACHE_DIR = Path("/app/data/image_cache")
```

When tests ran, these paths couldn't be created due to permission issues, causing errors.

**Fix**: Made paths configurable via environment variables:
```python
# In main.py
TEST_MODE = os.environ.get("TEST_MODE") == "true"
if TEST_MODE:
    DATA_DIR = Path(tempfile.gettempdir()) / "meticai_test_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
else:
    DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))

# Then use DATA_DIR for all paths
SETTINGS_FILE = DATA_DIR / "settings.json"
HISTORY_FILE = DATA_DIR / "profile_history.json"
# etc.
```

Created `conftest.py` to set environment variables before main.py imports:
```python
# conftest.py runs at import time before tests
os.environ["TEST_MODE"] = "true"
test_data_dir = tempfile.mkdtemp(prefix="meticai_test_")
os.environ["DATA_DIR"] = test_data_dir
```

#### 2. Missing Null Safety in Image Prompt Generation
**Issue**: `TypeError: 'NoneType' object is not subscriptable` in 6 barista tests.

**Root Cause**: In `generate_profile_image()`, code accessed dictionary keys without checking if result was None:
```python
prompt_result = build_image_prompt_with_metadata(...)
full_prompt = prompt_result["prompt"]  # TypeError if None!
```

**Fix**: Added null checking and safe access:
```python
prompt_result = build_image_prompt_with_metadata(...)

if not prompt_result or not isinstance(prompt_result, dict):
    raise HTTPException(
        status_code=500,
        detail="Failed to build image generation prompt"
    )

full_prompt = prompt_result.get("prompt", "")
prompt_metadata = prompt_result.get("metadata", {})
```

#### 3. LLM Analysis Cache Persistence
**Issue**: Tests expecting specific LLM behavior were hitting cached results from previous tests.

**Root Cause**: The new LLM caching feature (with 3-day TTL) was persisting data across tests because all tests shared the same temp directory.

**Fix**: Added `force_refresh=true` parameter to all LLM analysis tests:
```python
response = client.post("/api/shots/analyze-llm", data={
    "profile_name": "Test",
    "shot_date": "2024-01-15",
    "shot_filename": "shot.json",
    "force_refresh": "true"  # Bypass cache in tests
})
```

#### 4. History File Mock Issue  
**Issue**: Test `test_load_history_with_missing_file` expected empty list but got data from previous tests.

**Root Cause**: Test was trying to mock `Path` class but the module-level constant `HISTORY_FILE` was already evaluated. Also, the file actually existed from previous tests.

**Fix**: Changed test to mock `open()` to raise `FileNotFoundError`:
```python
@patch('main._ensure_history_file')
@patch('builtins.open')
def test_load_history_with_missing_file(self, mock_open_func, mock_ensure):
    mock_open_func.side_effect = FileNotFoundError("File not found")
    history = _load_history()
    assert history == []
```

### Changes Made

#### File: `coffee-relay/main.py`
- **Lines 35-47**: Added `DATA_DIR` configuration with test mode support
- **Lines 1006, 1225, 1256, 1327, 1403**: Updated all hardcoded paths to use `DATA_DIR`
- **Lines 2402-2422**: Added null safety checks for `prompt_result` in `generate_profile_image()`
- **Impact**: Enables tests to run with temporary directories, prevents NoneType errors

#### File: `coffee-relay/conftest.py` (new file)
- **Purpose**: Set up test environment variables before main.py is imported
- **Lines 10-16**: Configure TEST_MODE and DATA_DIR for all tests
- **Impact**: All tests automatically use temporary directories

#### File: `coffee-relay/test_main.py`
- **Lines 3497, 3520, 3563, 3611, 3666, 3682**: Added `force_refresh="true"` to 6 LLM analysis tests
- **Lines 1843-1856**: Fixed `test_load_history_with_missing_file` to mock `open()` instead of `Path`
- **Impact**: Tests properly bypass cache and handle file operations

### Test Results

#### Before Fixes
- **19 failures**, 160 passed
- Permission errors on `/app/data`
- NoneType subscript errors
- Unexpected cache hits

#### After Fixes
- **0 failures**, 179 passed ✅ (test_main.py)
- **0 failures**, 19 passed ✅ (test_logging.py)
- **Total: 198 tests passing**

### Benefits Added

This fix maintains all recent improvements while adding:

1. **Test Environment Isolation**: Tests use temporary directories, preventing conflicts
2. **Production Flexibility**: `DATA_DIR` can be configured via environment variable
3. **Robust Error Handling**: Null safety prevents crashes on edge cases
4. **Cache Control**: Tests can bypass cache when needed for deterministic behavior

### Validation

All fixes validated by:
1. Running full Python test suite (179 + 19 = 198 tests)
2. Verifying bash scripts have valid syntax
3. Confirming no production behavior changed
4. Ensuring proper separation of test and production environments

---

## Previous Fix (Earlier) - Status and Update Endpoints
After merging several PRs with bugfixes and improvements (#32, #37, #39, #42, #45, #47), CI tests started failing:
- **10 Python tests failing** (all in `/status` and `/api/trigger-update` endpoints)
- **1 Bash test failing** (macOS dock shortcut prompt text)

## Root Causes

### 1. Bash Test Failure (test #32)
**Issue**: Test expected text "Would you like to add a MeticAI shortcut" but actual script had different text.

**Root Cause**: PR #37 added macOS dock shortcut functionality with the prompt "Would you like to add MeticAI to your Dock?" but the test wasn't updated to match.

**Fix**: Updated test to match actual script text.
```bash
# Before:
run grep -q "Would you like to add a MeticAI shortcut" "$SCRIPT_PATH"

# After:
run grep -q "Would you like to add MeticAI to your Dock?" "$SCRIPT_PATH"
```

### 2. Python Tests - `/status` Endpoint (2 failures)
**Issue**: Tests expected subprocess calls but got different behavior.

**Root Cause**: PR #32 changed `/status` endpoint implementation from running `update.sh --check-only` via subprocess to reading directly from `.versions.json` file. Tests were still mocking subprocess calls instead of file I/O.

**Original Implementation** (what tests expected):
```python
result = subprocess.run(["bash", "update.sh", "--check-only"], ...)
# Parse stdout to determine update availability
```

**New Implementation** (what code actually does):
```python
version_file_path = Path("/app/.versions.json")
if version_file_path.exists():
    with open(version_file_path, 'r') as f:
        version_data = json.load(f)
```

**Fix**: Updated tests to mock `Path.exists()` and `open()` instead of `subprocess.run()`.

### 3. Python Tests - `/api/trigger-update` Endpoint (8 failures)
**Issue**: All tests returned 500 errors instead of expected 200/test-specific responses.

**Root Cause**: Endpoint checks if `/app/update.sh` exists before running it:
```python
script_path = Path("/app/update.sh")
if not script_path.exists():
    raise HTTPException(status_code=500, detail={...})
```

Tests were mocking `subprocess.run()` but not `Path.exists()`, so the check failed and raised a 500 error before subprocess was ever called.

**Fix**: Added `@patch('main.Path')` to all affected tests and configured the mock to return a Path object where `.exists()` returns `True`.

```python
# Before:
@patch('main.subprocess.run')
def test_trigger_update_success(self, mock_subprocess, client):
    ...

# After:
@patch('main.subprocess.run')
@patch('main.Path')
def test_trigger_update_success(self, mock_subprocess, mock_path_class, client):
    mock_script_path = Mock()
    mock_script_path.exists.return_value = True
    mock_path_class.return_value = mock_script_path
    ...
```

## Changes Made

### File: `tests/test_local_install.bats`
- **Line 177**: Updated expected prompt text to match actual implementation
- **Impact**: Minimal - single line change

### File: `coffee-relay/test_main.py`
- **Line 13**: Added `mock_open` import for file mocking
- **TestStatusEndpoint (6 tests)**: 
  - Removed `subprocess.run` mocks
  - Added `Path` and `open()` mocks
  - Configured mocks to simulate file existence and JSON content
- **TestTriggerUpdateEndpoint (8 tests)**:
  - Added `Path` mocks to all tests
  - Configured `Path.exists()` to return `True`
  - Maintained all other test logic unchanged
- **Impact**: Updated test mocking to match new implementation, no test coverage lost

## Test Results

### Before Fixes
- Python: 10 failures, 39 passing
- Bash: 1 failure, 50 passing

### After Fixes
- Python: 0 failures, 49 passing ✅
- Bash: 0 failures, 51 passing ✅

## Benefits Maintained

All improvements from recent bugfixes remain intact:

1. **Update System** (PR #32): Automatic repository switching, version tracking, API-accessible status
2. **macOS Dock Shortcut** (PR #37): Easy access to web app for macOS users
3. **Trigger Update API** (PR #39): Programmatic update triggering for web interfaces
4. **Installation Improvements** (PRs #42, #45, #47): Early .env detection, automatic IP discovery, network scanning, QR codes

## Validation

All fixes were validated by:
1. Running full Python test suite locally (49 tests)
2. Running full Bash test suite locally (51 tests)
3. Verifying no functionality was removed or degraded
4. Confirming all tests use proper mocking patterns

## Conclusion

The test failures were caused by tests not being updated to match improved implementations. By updating the test mocking to match the new behavior, all tests now pass while preserving all the improvements from recent bugfixes.
