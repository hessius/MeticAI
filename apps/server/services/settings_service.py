"""Settings service for managing application configuration."""

import json
from typing import Optional
from pathlib import Path

from config import DATA_DIR
from utils.file_utils import atomic_write_json

SETTINGS_FILE = DATA_DIR / "settings.json"

# In-memory cache (loaded from disk on first access, write-through on save)
_settings_cache: Optional[dict] = None

_DEFAULT_SETTINGS = {
    "geminiApiKey": "",
    "meticulousIp": "",
    "serverIp": "",
    "authorName": ""
}


def ensure_settings_file():
    """Ensure the settings file and directory exist."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        SETTINGS_FILE.write_text(json.dumps(_DEFAULT_SETTINGS, indent=2))


def load_settings() -> dict:
    """Load settings, using in-memory copy when available."""
    global _settings_cache
    if _settings_cache is not None:
        return _settings_cache
    ensure_settings_file()
    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
            _settings_cache = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        _settings_cache = dict(_DEFAULT_SETTINGS)
    return _settings_cache


def save_settings(settings: dict):
    """Write-through: update in-memory cache and persist to disk."""
    global _settings_cache
    _settings_cache = settings
    ensure_settings_file()
    atomic_write_json(SETTINGS_FILE, settings)


def get_author_name() -> str:
    """Get the configured author name, defaulting to 'MeticAI' if not set."""
    settings = load_settings()
    author = settings.get("authorName", "").strip()
    return author if author else "MeticAI"
