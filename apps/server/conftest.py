"""
Pytest configuration and shared fixtures for meticai-server tests.

This module MUST be loaded before main.py to set up test environment variables.
"""

import os
import tempfile
import shutil
import pytest

# Set test environment variables BEFORE main.py is imported
# This runs at import time, ensuring environment is set up early
os.environ["TEST_MODE"] = "true"

# Create a temporary directory for test data
test_data_dir = tempfile.mkdtemp(prefix="meticai_test_")
os.environ["DATA_DIR"] = test_data_dir


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data():
    """Clean up temporary test data directory after all tests complete."""
    yield
    # Cleanup after all tests finish
    if os.path.exists(test_data_dir):
        try:
            shutil.rmtree(test_data_dir)
        except (PermissionError, OSError):
            # If cleanup fails, it's not critical for tests
            pass


@pytest.fixture(autouse=True)
def _reset_in_memory_caches():
    """Reset all in-memory service caches between tests.
    
    This prevents stale data from leaking across test boundaries when
    tests write directly to on-disk files and expect fresh reads.
    """
    import services.cache_service as _cs
    import services.settings_service as _ss
    import services.history_service as _hs
    import services.meticulous_service as _ms

    _cs._llm_cache = None
    _cs._shot_cache = None
    _ss._settings_cache = None
    _hs._history_cache = None
    _ms._profile_list_cache = None
    _ms._profile_list_cache_time = 0.0

    # Also reset settings file on disk to defaults to prevent cross-test leaks
    from config import DATA_DIR
    settings_file = DATA_DIR / "settings.json"
    if settings_file.exists():
        settings_file.unlink()

    yield

