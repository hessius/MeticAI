"""Settings service for managing application configuration."""

import json
from pathlib import Path

from config import DATA_DIR

SETTINGS_FILE = DATA_DIR / "settings.json"


def ensure_settings_file():
    """Ensure the settings file and directory exist."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        default_settings = {
            "geminiApiKey": "",
            "meticulousIp": "",
            "serverIp": "",
            "authorName": ""
        }
        SETTINGS_FILE.write_text(json.dumps(default_settings, indent=2))


def load_settings() -> dict:
    """Load settings from file."""
    ensure_settings_file()
    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {
            "geminiApiKey": "",
            "meticulousIp": "",
            "serverIp": "",
            "authorName": ""
        }


def save_settings(settings: dict):
    """Save settings to file."""
    ensure_settings_file()
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(settings, f, indent=2)


def get_author_name() -> str:
    """Get the configured author name, defaulting to 'MeticAI' if not set."""
    settings = load_settings()
    author = settings.get("authorName", "").strip()
    return author if author else "MeticAI"
