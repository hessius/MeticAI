# Test Fixes Documentation

## Overview
This document explains the test failures that occurred after recent bugfixes and how they were resolved without rolling back the improvements.

## Problem Statement
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
