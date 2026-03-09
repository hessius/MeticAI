"""Shot annotations service for user notes on shot data.

Stores user-provided annotations (markdown text and star ratings) for shots,
keyed by {date}/{filename} to match the machine's shot storage structure.

Storage format: JSON object mapping shot keys to annotation objects:
{
    "2024-01-15/shot_001.json": {
        "annotation": "Great flow, but extraction was slightly fast...",
        "rating": 4,
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


def _validate_rating(rating) -> Optional[int]:
    """Validate and normalise a rating value.

    Returns an int 1-5 or None.  Raises ValueError for out-of-range values.
    """
    if rating is None:
        return None
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        raise ValueError("Rating must be an integer between 1 and 5")
    if rating < 1 or rating > 5:
        raise ValueError("Rating must be between 1 and 5")
    return rating


def get_annotation(date: str, filename: str) -> Optional[dict]:
    """Get the full annotation entry for a specific shot.
    
    Args:
        date: Shot date (e.g., "2024-01-15")
        filename: Shot filename (e.g., "shot_001.json")
    
    Returns:
        Dict with annotation text, rating, and updated_at if exists, None otherwise.
    """
    annotations = _load_annotations()
    key = make_shot_key(date, filename)
    entry = annotations.get(key)
    if entry and isinstance(entry, dict):
        return {
            "annotation": entry.get("annotation"),
            "rating": entry.get("rating"),
            "updated_at": entry.get("updated_at"),
        }
    return None


def set_annotation(date: str, filename: str, annotation: str, rating=None) -> dict:
    """Set the annotation for a specific shot.
    
    Args:
        date: Shot date
        filename: Shot filename
        annotation: Markdown annotation text (empty string to clear text)
        rating: Star rating 1-5, or None to leave unchanged / clear
    
    Returns:
        Updated annotation entry.
    """
    validated_rating = _validate_rating(rating)
    annotations = _load_annotations()
    key = make_shot_key(date, filename)
    
    has_text = annotation and annotation.strip()
    existing = annotations.get(key, {}) if isinstance(annotations.get(key), dict) else {}

    # Merge: keep existing rating if caller didn't provide one
    new_annotation = annotation.strip() if has_text else None
    new_rating = validated_rating if rating is not None else existing.get("rating")

    if not new_annotation and not new_rating:
        # Nothing left — remove entry entirely
        if key in annotations:
            del annotations[key]
            _save_annotations(annotations)
        return {"annotation": None, "rating": None}
    
    entry = {
        "annotation": new_annotation,
        "rating": new_rating,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    annotations[key] = entry
    _save_annotations(annotations)
    
    logger.info(f"Saved annotation for shot {key}")
    return entry


def set_rating(date: str, filename: str, rating) -> dict:
    """Set only the star rating for a shot, preserving existing annotation text.

    Args:
        date: Shot date
        filename: Shot filename
        rating: Star rating 1-5, or None to clear rating
    
    Returns:
        Updated annotation entry.
    """
    validated_rating = _validate_rating(rating)
    annotations = _load_annotations()
    key = make_shot_key(date, filename)
    existing = annotations.get(key, {}) if isinstance(annotations.get(key), dict) else {}

    existing_text = existing.get("annotation")

    if not existing_text and not validated_rating:
        # Nothing left — remove entry entirely
        if key in annotations:
            del annotations[key]
            _save_annotations(annotations)
        return {"annotation": None, "rating": None}

    entry = {
        "annotation": existing_text,
        "rating": validated_rating,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    annotations[key] = entry
    _save_annotations(annotations)

    logger.info(f"Saved rating for shot {key}")
    return entry


def delete_annotation(date: str, filename: str) -> bool:
    """Delete the entire annotation entry for a shot.

    Args:
        date: Shot date
        filename: Shot filename

    Returns:
        True if an annotation was deleted, False if none existed.
    """
    annotations = _load_annotations()
    key = make_shot_key(date, filename)
    if key in annotations:
        del annotations[key]
        _save_annotations(annotations)
        logger.info(f"Deleted annotation for shot {key}")
        return True
    return False


def get_all_annotations() -> dict:
    """Get all shot annotations.
    
    Returns:
        Dict mapping shot keys to annotation entries.
    """
    return _load_annotations().copy()


def has_annotation(date: str, filename: str) -> bool:
    """Check whether a shot has any annotation (text or rating)."""
    annotations = _load_annotations()
    key = make_shot_key(date, filename)
    return key in annotations


def invalidate_cache() -> None:
    """Clear the in-memory cache (for testing)."""
    global _annotations_cache
    _annotations_cache = None
