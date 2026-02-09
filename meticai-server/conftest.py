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

