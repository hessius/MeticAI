"""Cache service for managing LLM analysis, shot history, and profile image caches.

This module provides caching functionality for:
- LLM analysis results (with TTL-based expiration)
- Shot history data (with staleness tracking)
- Profile images (binary file cache)
"""

import json
import time
from typing import Optional
from logging_config import get_logger

from config import DATA_DIR, LLM_CACHE_TTL_SECONDS, SHOT_CACHE_STALE_SECONDS
from utils.file_utils import atomic_write_json
from utils.sanitization import sanitize_profile_name_for_filename

logger = get_logger()

# ============================================
# LLM Analysis Cache Configuration
# ============================================

LLM_CACHE_FILE = DATA_DIR / "llm_analysis_cache.json"

# In-memory cache (loaded from disk on first access, write-through on save)
_llm_cache: Optional[dict] = None


def _ensure_llm_cache_file():
    """Ensure the LLM cache file and directory exist."""
    LLM_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not LLM_CACHE_FILE.exists():
        LLM_CACHE_FILE.write_text("{}")


def _load_llm_cache() -> dict:
    """Load LLM analysis cache, using in-memory copy when available."""
    global _llm_cache
    if _llm_cache is not None:
        return _llm_cache
    _ensure_llm_cache_file()
    try:
        data = json.loads(LLM_CACHE_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        data = None
    if not isinstance(data, dict):
        data = {}
    _llm_cache = data
    return _llm_cache


def _save_llm_cache(cache: dict):
    """Write-through: update in-memory cache and persist to disk."""
    global _llm_cache
    _llm_cache = cache
    _ensure_llm_cache_file()
    atomic_write_json(LLM_CACHE_FILE, cache)


def _get_llm_cache_key(profile_name: str, shot_date: str, shot_filename: str) -> str:
    """Generate a cache key for LLM analysis."""
    return f"{profile_name}_{shot_date}_{shot_filename}"


def get_cached_llm_analysis(
    profile_name: str, shot_date: str, shot_filename: str
) -> Optional[str]:
    """Get cached LLM analysis if it exists and is not expired."""
    cache = _load_llm_cache()
    key = _get_llm_cache_key(profile_name, shot_date, shot_filename)

    if key in cache:
        entry = cache[key]
        timestamp = entry.get("timestamp", 0)
        now = time.time()

        if now - timestamp < LLM_CACHE_TTL_SECONDS:
            return entry.get("analysis")
        else:
            # Expired - remove from cache
            del cache[key]
            _save_llm_cache(cache)

    return None


def save_llm_analysis_to_cache(
    profile_name: str, shot_date: str, shot_filename: str, analysis: str
):
    """Save LLM analysis to cache."""
    cache = _load_llm_cache()
    key = _get_llm_cache_key(profile_name, shot_date, shot_filename)

    cache[key] = {
        "analysis": analysis,
        "timestamp": time.time(),
        "profile_name": profile_name,
        "shot_date": shot_date,
        "shot_filename": shot_filename,
    }

    _save_llm_cache(cache)


# ============================================
# Shot History Cache Management
# ============================================

SHOT_CACHE_FILE = DATA_DIR / "shot_cache.json"

# In-memory cache (loaded from disk on first access, write-through on save)
_shot_cache: Optional[dict] = None


def _ensure_shot_cache_file():
    """Ensure the shot cache file and directory exist."""
    SHOT_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not SHOT_CACHE_FILE.exists():
        SHOT_CACHE_FILE.write_text("{}")


def _load_shot_cache() -> dict:
    """Load shot cache, using in-memory copy when available."""
    global _shot_cache
    if _shot_cache is not None:
        return _shot_cache
    _ensure_shot_cache_file()
    try:
        with open(SHOT_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        data = None
    if not isinstance(data, dict):
        data = {}
    _shot_cache = data
    return _shot_cache


def _save_shot_cache(cache: dict):
    """Write-through: update in-memory cache and persist to disk."""
    global _shot_cache
    _shot_cache = cache
    _ensure_shot_cache_file()
    atomic_write_json(SHOT_CACHE_FILE, cache)


def _get_cached_shots(
    profile_name: str, limit: int
) -> tuple[Optional[dict], bool, Optional[float]]:
    """Get cached shots for a profile.

    Returns a tuple of (cached_data, is_stale, cached_at_timestamp).
    - cached_data: The cached response data, or None if no cache exists
    - is_stale: True if cache is older than SHOT_CACHE_STALE_SECONDS
    - cached_at: Unix timestamp of when cache was created

    Cache is stored indefinitely but marked stale after 60 minutes.
    """
    cache = _load_shot_cache()
    cache_key = profile_name.lower()

    if cache_key not in cache:
        return None, False, None

    cached_entry = cache[cache_key]
    cached_time = cached_entry.get("cached_at", 0)
    cached_limit = cached_entry.get("limit", 0)

    # Check if limit matches (requesting more than cached = cache miss)
    if limit > cached_limit:
        return None, False, None

    # Check if cache is stale (older than 60 minutes)
    is_stale = time.time() - cached_time > SHOT_CACHE_STALE_SECONDS

    return cached_entry.get("data"), is_stale, cached_time


def _set_cached_shots(profile_name: str, data: dict, limit: int):
    """Store shots in cache for a profile."""
    cache = _load_shot_cache()
    cache_key = profile_name.lower()

    cache[cache_key] = {"cached_at": time.time(), "limit": limit, "data": data}

    _save_shot_cache(cache)


# ============================================
# Shot Profile Index
# ============================================
# Persistent mapping: "date/filename" → {name, profile_id, weight, time_ms, timestamp}
# Built incrementally — each shot file is fetched at most once.

SHOT_INDEX_FILE = DATA_DIR / "shot_profile_index.json"

_shot_index: Optional[dict] = None


def _load_shot_index() -> dict:
    """Load shot profile index from disk/memory."""
    global _shot_index
    if _shot_index is not None:
        return _shot_index
    SHOT_INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        if SHOT_INDEX_FILE.exists():
            with open(SHOT_INDEX_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "entries" in data:
                _shot_index = data
                return _shot_index
    except (json.JSONDecodeError, IOError):
        pass
    _shot_index = {"entries": {}, "indexed_dates": []}
    return _shot_index


def _save_shot_index():
    """Write shot profile index to disk."""
    if _shot_index is None:
        return
    SHOT_INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(SHOT_INDEX_FILE, _shot_index)


def get_indexed_shot_metadata(key: str) -> Optional[dict]:
    """Look up metadata for a single shot by 'date/filename' key."""
    idx = _load_shot_index()
    return idx["entries"].get(key)


def get_indexed_dates() -> set:
    """Return the set of dates already indexed."""
    idx = _load_shot_index()
    return set(idx.get("indexed_dates", []))


def update_shot_index(new_entries: dict, new_dates: list):
    """Merge new entries into the index and persist."""
    idx = _load_shot_index()
    idx["entries"].update(new_entries)
    existing = set(idx.get("indexed_dates", []))
    existing.update(new_dates)
    idx["indexed_dates"] = sorted(existing)
    _save_shot_index()


def lookup_shots_by_profile(profile_name: str, limit: int = 20) -> Optional[list]:
    """Return shots for a profile from the index, or None if index is empty."""
    idx = _load_shot_index()
    entries = idx.get("entries", {})
    if not entries:
        return None

    matches = []
    for key, meta in entries.items():
        if meta.get("name", "").lower() == profile_name.lower():
            parts = key.split("/", 1)
            if len(parts) == 2:
                matches.append({
                    "date": parts[0],
                    "filename": parts[1],
                    "timestamp": meta.get("timestamp"),
                    "profile_name": meta["name"],
                    "profile_id": meta.get("profile_id", ""),
                    "final_weight": meta.get("weight"),
                    "total_time": meta["time_ms"] / 1000 if meta.get("time_ms") else None,
                })

    # Sort newest first
    matches.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return matches[:limit]


def get_all_indexed_shots(limit: int = 50, offset: int = 0) -> Optional[list]:
    """Return all indexed shots sorted newest-first, or None if empty."""
    idx = _load_shot_index()
    entries = idx.get("entries", {})
    if not entries:
        return None

    all_shots = []
    for key, meta in entries.items():
        parts = key.split("/", 1)
        if len(parts) == 2:
            all_shots.append({
                "date": parts[0],
                "filename": parts[1],
                "timestamp": meta.get("timestamp"),
                "profile_name": meta.get("name", ""),
                "profile_id": meta.get("profile_id", ""),
                "final_weight": meta.get("weight"),
                "total_time": meta["time_ms"] / 1000 if meta.get("time_ms") else None,
            })

    all_shots.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return all_shots[offset:offset + limit]


# ============================================
# Profile Image Cache Management
# ============================================

IMAGE_CACHE_DIR = DATA_DIR / "image_cache"


def _ensure_image_cache_dir():
    """Ensure the image cache directory exists."""
    IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _get_cached_image(profile_name: str) -> Optional[bytes]:
    """Get cached image for a profile if it exists.

    Returns the image bytes or None if not cached.
    """
    _ensure_image_cache_dir()
    safe_name = sanitize_profile_name_for_filename(profile_name)
    cache_file = IMAGE_CACHE_DIR / f"{safe_name}.png"

    # Security check: ensure the resolved path is still within IMAGE_CACHE_DIR
    try:
        cache_file_resolved = cache_file.resolve()
        if not str(cache_file_resolved).startswith(str(IMAGE_CACHE_DIR.resolve())):
            logger.warning(
                f"Path traversal attempt detected for profile: {profile_name}"
            )
            return None
    except Exception as e:
        logger.warning(f"Failed to resolve cache path for {profile_name}: {e}")
        return None

    if cache_file.exists():
        try:
            return cache_file.read_bytes()
        except Exception as e:
            logger.warning(f"Failed to read cached image for {profile_name}: {e}")
            return None
    return None


def _set_cached_image(profile_name: str, image_data: bytes):
    """Store image in cache for a profile."""
    _ensure_image_cache_dir()
    safe_name = sanitize_profile_name_for_filename(profile_name)
    cache_file = IMAGE_CACHE_DIR / f"{safe_name}.png"

    # Security check: ensure the resolved path is still within IMAGE_CACHE_DIR
    try:
        cache_file_resolved = cache_file.resolve()
        if not str(cache_file_resolved).startswith(str(IMAGE_CACHE_DIR.resolve())):
            logger.warning(
                f"Path traversal attempt detected for profile: {profile_name}"
            )
            return
    except Exception as e:
        logger.warning(f"Failed to resolve cache path for {profile_name}: {e}")
        return

    try:
        cache_file.write_bytes(image_data)
        logger.info(
            f"Cached image for profile: {profile_name} ({len(image_data)} bytes)"
        )
    except Exception as e:
        logger.warning(f"Failed to cache image for {profile_name}: {e}")
