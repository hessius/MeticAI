"""Configuration management for MeticAI server.

This module centralizes all configuration constants and environment variables
for easier management and testing.

Usage:
    from config import config, DATA_DIR, MAX_UPLOAD_SIZE
    
    # Access via config object
    api_key = config.GEMINI_API_KEY
    
    # Or use exported constants
    upload_limit = MAX_UPLOAD_SIZE

Attributes:
    TEST_MODE: Boolean flag for test environment (affects DATA_DIR)
    DATA_DIR: Path to data directory (temp dir in test mode, /app/data otherwise)
    LOG_DIR: Path to log directory
    GEMINI_API_KEY: Google Gemini API key from environment
    METICULOUS_IP: IP address of Meticulous espresso machine
    PI_IP: IP address of this server
    UPDATE_CHECK_INTERVAL: Seconds between update checks (default: 7200 = 2 hours)
    MAX_UPLOAD_SIZE: Maximum file upload size in bytes (default: 10 MB)
    LLM_CACHE_TTL_SECONDS: TTL for LLM analysis cache (default: 259200 = 3 days)
    SHOT_CACHE_STALE_SECONDS: Staleness threshold for shot cache (default: 3600 = 1 hour)
    VERSION_PATTERN: Compiled regex for version extraction
    STAGE_STATUS_RETRACTING: Constant for stage status

Note:
    DATA_DIR is automatically set to a temporary directory when TEST_MODE="true",
    enabling isolated testing without affecting production data.
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
STAGE_STATUS_RETRACTING = config.STAGE_STATUS_RETRACTINGLLM_CACHE_TTL_SECONDS = config.LLM_CACHE_TTL_SECONDS
SHOT_CACHE_STALE_SECONDS = config.SHOT_CACHE_STALE_SECONDS