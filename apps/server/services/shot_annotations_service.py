"""Shot annotations service for user notes on shot data.

Stores user-provided annotations (markdown text) for shots, keyed by
{date}/{filename} to match the machine's shot storage structure.

Storage format: JSON object mapping shot keys to annotation objects:
{
    "2024-01-15/shot_001.json": {
        "annotation": "Great flow, but extraction was slightly fast...",
        "updated_at": "2024-01-15T10:30:00Z"
    }
}
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from logging_config import get_logger
from config import DATA_DIR
from utils.file_utils import atomic_write_json

logger = get_logger()

ANNOTATIONS_FILE = DATA_DIR / "shot_annotations.json"

# In-memory cache
_annotations_cache: Optional[dict] = None


def _ensure_file():
    """Ensure the annotations file and directory exist."""
    ANNOTATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not ANNOTATIONS_FILE.exists():
        ANNOTATIONS_FILE.write_text("{}")


def _load_annotations() -> dict:
    """Load annotations from disk, caching in memory."""
    global _annotations_cache
    if _annotations_cache is not None:
        return _annotations_cache
    
    _ensure_file()
    try:
        with open(ANNOTATIONS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        data = {}
    
    if not isinstance(data, dict):
        logger.warning("Annotations file contained non-dict — resetting")
        data = {}
    
    _annotations_cache = data
    return _annotations_cache


def _save_annotations(data: dict) -> None:
    """Save annotations to disk and update cache."""
    global _annotations_cache
    _ensure_file()
    atomic_write_json(ANNOTATIONS_FILE, data)
    _annotations_cache = data


def make_shot_key(date: str, filename: str) -> str:
    """Create a unique key for a shot from date and filename."""
    return f"{date}/{filename}"


def get_annotation(date: str, filename: str) -> Optional[str]:
    """Get the annotation for a specific shot.
    
    Args:
        date: Shot date (e.g., "2024-01-15")
        filename: Shot filename (e.g., "shot_001.json")
    
    Returns:
        Annotation text if exists, None otherwise.
    """
    annotations = _load_annotations()
    key = make_shot_key(date, filename)
    entry = annotations.get(key)
    if entry and isinstance(entry, dict):
        return entry.get("annotation")
    return None


def set_annotation(date: str, filename: str, annotation: str) -> dict:
    """Set the annotation for a specific shot.
    
    Args:
        date: Shot date
        filename: Shot filename
        annotation: Markdown annotation text (empty string to clear)
    
    Returns:
        Updated annotation entry.
    """
    annotations = _load_annotations()
    key = make_shot_key(date, filename)
    
    if not annotation or not annotation.strip():
        # Remove annotation if empty
        if key in annotations:
            del annotations[key]
            _save_annotations(annotations)
        return {"annotation": None}
    
    entry = {
        "annotation": annotation.strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    annotations[key] = entry
    _save_annotations(annotations)
    
    logger.info(f"Saved annotation for shot {key}")
    return entry


def get_all_annotations() -> dict:
    """Get all shot annotations.
    
    Returns:
        Dict mapping shot keys to annotation entries.
    """
    return _load_annotations().copy()


def invalidate_cache() -> None:
    """Clear the in-memory cache (for testing)."""
    global _annotations_cache
    _annotations_cache = None
