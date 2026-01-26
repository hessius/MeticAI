"""
Pytest configuration and shared fixtures for coffee-relay tests.

This module MUST be loaded before main.py to set up test environment variables.
"""

import os
import tempfile

# Set test environment variables BEFORE main.py is imported
# This runs at import time, ensuring environment is set up early
os.environ["TEST_MODE"] = "true"

# Create a temporary directory for test data
test_data_dir = tempfile.mkdtemp(prefix="meticai_test_")
os.environ["DATA_DIR"] = test_data_dir

