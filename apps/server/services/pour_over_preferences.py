"""Pour-over preferences service.

Persists per-mode (free / ratio) pour-over UI preferences so they survive
page reloads and are consistent across devices.

Storage: ``DATA_DIR / pour_over_preferences.json``
"""

import json
import logging
from pathlib import Path
from typing import Optional

from config import DATA_DIR
from utils.file_utils import atomic_write_json

logger = logging.getLogger(__name__)

PREFS_FILE: Path = DATA_DIR / "pour_over_preferences.json"

_MODE_DEFAULTS = {
    "autoStart": True,
    "bloomEnabled": True,
    "bloomSeconds": 30,
    "bloomWeightMultiplier": 2,
    "machineIntegration": False,
    "doseGrams": None,
    "brewRatio": None,
}

_RECIPE_MODE_DEFAULTS = {
    "machineIntegration": False,
    "autoStart": True,
    "progressionMode": "weight",  # "weight" = advance pours on scale, "time" = advance all on timer
}

_DEFAULT_PREFS = {
    "free": dict(_MODE_DEFAULTS),
    "ratio": dict(_MODE_DEFAULTS),
    "recipe": dict(_RECIPE_MODE_DEFAULTS),
}

# In-memory cache – loaded lazily, write-through on save.
_cache: Optional[dict] = None


def _ensure_file() -> None:
    """Create the prefs file with defaults if it doesn't exist yet."""
    PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not PREFS_FILE.exists():
        atomic_write_json(PREFS_FILE, _DEFAULT_PREFS)


def load_preferences() -> dict:
    """Return the full preferences dict, merging with defaults for safety."""
    global _cache
    if _cache is not None:
        return _cache

    _ensure_file()

    try:
        with open(PREFS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        data = None

    if not isinstance(data, dict):
        data = {}

    # Merge defaults per mode so missing keys always have a value.
    result: dict = {}
    for mode in ("free", "ratio"):
        stored = data.get(mode, {})
        if not isinstance(stored, dict):
            stored = {}
        result[mode] = {**_MODE_DEFAULTS, **stored}

    # Recipe mode uses its own smaller defaults
    stored_recipe = data.get("recipe", {})
    if not isinstance(stored_recipe, dict):
        stored_recipe = {}
    result["recipe"] = {**_RECIPE_MODE_DEFAULTS, **stored_recipe}

    _cache = result
    return _cache


def save_preferences(prefs: dict) -> dict:
    """Validate, persist, and return the normalised preferences.

    Only known keys are stored; unexpected keys are silently dropped.
    """
    global _cache
    _ensure_file()

    result: dict = {}
    for mode in ("free", "ratio"):
        incoming = prefs.get(mode, {})
        if not isinstance(incoming, dict):
            incoming = {}

        merged = dict(_MODE_DEFAULTS)  # start from defaults
        for key in _MODE_DEFAULTS:
            if key in incoming:
                merged[key] = incoming[key]
        result[mode] = merged

    # Recipe mode preferences
    incoming_recipe = prefs.get("recipe", {})
    if not isinstance(incoming_recipe, dict):
        incoming_recipe = {}
    merged_recipe = dict(_RECIPE_MODE_DEFAULTS)
    for key in _RECIPE_MODE_DEFAULTS:
        if key in incoming_recipe:
            merged_recipe[key] = incoming_recipe[key]
    result["recipe"] = merged_recipe

    _cache = result
    atomic_write_json(PREFS_FILE, result)
    return result


def reset_cache() -> None:
    """Clear the in-memory cache (useful in tests)."""
    global _cache
    _cache = None
