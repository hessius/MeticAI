"""Configuration management for MeticAI server.

This module centralizes all configuration constants and environment variables
for easier management and testing.
"""

import os
import tempfile
from pathlib import Path
import re


class Config:
    """Central configuration for MeticAI server."""
    
    # Test Mode
    TEST_MODE = os.environ.get("TEST_MODE") == "true"
    
    # Data Directories
    if TEST_MODE:
        DATA_DIR = Path(tempfile.gettempdir()) / "meticai_test_data"
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    else:
        DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
    
    LOG_DIR = Path(os.environ.get("LOG_DIR", "/app/logs"))
    
    # API Keys and Endpoints
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
    METICULOUS_IP = os.environ.get("METICULOUS_IP", "")
    PI_IP = os.environ.get("PI_IP", "")
    
    # Application Settings
    UPDATE_CHECK_INTERVAL = 7200  # 2 hours in seconds
    MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB in bytes
    
    # Cache Settings
    LLM_CACHE_TTL_SECONDS = 259200  # 3 days (72 hours)
    SHOT_CACHE_STALE_SECONDS = 3600  # 1 hour
    
    # Stage Status Constants
    STAGE_STATUS_RETRACTING = "retracting"
    
    # Regex Patterns (pre-compiled for performance)
    VERSION_PATTERN = re.compile(
        r'^\s*version\s*=\s*["\']([^"\']+)["\']', 
        re.MULTILINE
    )


# Convenience access to config
config = Config()


# Backward compatibility - export commonly used constants
DATA_DIR = config.DATA_DIR
UPDATE_CHECK_INTERVAL = config.UPDATE_CHECK_INTERVAL
MAX_UPLOAD_SIZE = config.MAX_UPLOAD_SIZE
VERSION_PATTERN = config.VERSION_PATTERN
STAGE_STATUS_RETRACTING = config.STAGE_STATUS_RETRACTING
