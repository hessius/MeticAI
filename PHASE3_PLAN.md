# Phase 3: Test Coverage Enhancement - Implementation Plan

## Overview

Phase 3 focuses on improving test coverage from the current ~25% to 70%+ on critical paths. With the modularized codebase from Phase 2, we can now test components in isolation.

## Current State

- **Test File**: `test_main.py` (7,362 lines, 352 test functions)
- **Current Coverage**: ~25% (369/1504 statements)
- **Target Coverage**: 70%+ on critical paths

## Phase 3 Goals

### 1. Update Test Imports ✅ PRIORITY 1
- Update imports in `test_main.py` to use new modular structure
- Change from testing monolithic `main.py` to testing individual modules
- Ensure all existing tests still pass

### 2. Add Service Module Tests 📝 PRIORITY 2
Create dedicated test files for each service:
- `tests/test_cache_service.py` - Cache management (14 functions)
- `tests/test_settings_service.py` - Settings operations (4 functions)
- `tests/test_history_service.py` - History management (7 functions)
- `tests/test_gemini_service.py` - AI integration (4 functions)
- `tests/test_meticulous_service.py` - Machine API (4 functions)
- `tests/test_analysis_service.py` - Shot analysis (15 functions)

### 3. Add Route Module Tests 📝 PRIORITY 3
Create dedicated test files for each route module:
- `tests/test_routes_coffee.py` - Coffee analysis endpoints (2 endpoints)
- `tests/test_routes_system.py` - System endpoints (10 endpoints)
- `tests/test_routes_history.py` - History CRUD (6 endpoints)
- `tests/test_routes_shots.py` - Shot endpoints (7 endpoints)
- `tests/test_routes_profiles.py` - Profile management (11 endpoints)
- `tests/test_routes_scheduling.py` - Scheduling (10 endpoints)

### 4. Add Utility Tests 📝 PRIORITY 4
- `tests/test_file_utils.py` - File operations (2 functions)
- `tests/test_sanitization.py` - Input sanitization (2 functions)

## Critical Path Focus Areas

Based on the issue, focus testing on:
1. ✅ Shot analysis functions (`_analyze_stage_execution`, `_perform_local_shot_analysis`)
2. ✅ Profile image generation and processing
3. ✅ Scheduling system (recurring schedules, shot execution)
4. ✅ Machine API interaction layer
5. ✅ Cache management functions

## Testing Strategy

### Unit Tests
- Test each service/utility function in isolation
- Mock external dependencies (API calls, file I/O, database)
- Use pytest fixtures for common setup

### Integration Tests
- Test route modules with full FastAPI TestClient
- Test end-to-end workflows
- Validate API contracts

### Test Organization
- Follow existing patterns from `test_main.py`
- Group related tests into test classes
- Use descriptive test names
- Add docstrings explaining test purpose

## Success Criteria

- ✅ All existing tests pass after import updates
- ✅ 70%+ coverage on service modules
- ✅ 70%+ coverage on critical path functions
- ✅ All new tests pass in CI/CD
- ✅ No decrease in overall code quality

## Implementation Steps

### Step 1: Update Existing Test Imports
1. Analyze current test structure
2. Update imports to use new modules
3. Run tests and fix any failures
4. Commit working tests

### Step 2: Add Service Tests
1. Start with cache_service (most functions)
2. Add analysis_service tests (critical path)
3. Add remaining service tests
4. Verify coverage improvements

### Step 3: Add Route Tests
1. Start with coffee routes (entry point)
2. Add system routes (health checks)
3. Add remaining route tests
4. Ensure integration tests work

### Step 4: Add Utility Tests
1. Test file_utils
2. Test sanitization
3. Verify edge cases

### Step 5: Verify and Document
1. Run full test suite
2. Generate coverage report
3. Document coverage improvements
4. Update test documentation

## Notes

- Maintain existing test patterns and conventions
- Use pytest-asyncio for async tests
- Mock external services (Gemini API, Meticulous machine)
- Keep tests fast and independent
- Follow TDD principles for new features

---

**Status**: Planning Complete - Ready to Begin Implementation
**Next**: Update test imports in `test_main.py`
