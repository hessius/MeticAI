"""Temporary profile lifecycle management.

Provides a reusable service that creates short-lived profiles on the
Meticulous machine, loads them for execution, then cleans them up
(purge + delete) once the shot finishes or is aborted.

The service is generic — pour-over, recipes, or any future feature can
use the same create → load → brew → cleanup lifecycle.

Temp profiles are identified by well-known names (e.g.
``MeticAI Ratio Pour-Over``) so stale orphans can be detected and
removed on startup.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from services.meticulous_service import (
    async_create_profile,
    async_delete_profile,
    async_list_profiles,
    async_load_profile_by_id,
    MachineUnreachableError,
)

logger = logging.getLogger(__name__)

# Well-known temporary profile names created by features like pour-over.
# Used by cleanup_stale() to remove orphans on startup.
TEMP_PROFILE_NAMES = frozenset({"MeticAI Ratio Pour-Over"})

# Prefixes for temporary profile names (e.g. recipe profiles).
TEMP_PROFILE_PREFIXES = frozenset({"MeticAI Recipe: "})


def is_temp_profile(name: str) -> bool:
    """Return True if *name* belongs to a MeticAI temporary profile."""
    return name in TEMP_PROFILE_NAMES or any(
        name.startswith(prefix) for prefix in TEMP_PROFILE_PREFIXES
    )

# Async lock guarding _active state to prevent interleaved mutations
# from concurrent calls to create_and_load / cleanup / force_cleanup.
_lock: asyncio.Lock | None = None


def _get_lock() -> asyncio.Lock:
    """Lazy-initialise the lock to avoid cross-event-loop issues in tests."""
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock


def _reset_lock() -> None:
    """Reset the lock (for tests that run in different event loops)."""
    global _lock
    _lock = None


@dataclass
class ActiveTempProfile:
    """Metadata about the currently-active temporary profile."""

    profile_id: str
    profile_name: str
    original_params: Dict[str, Any] = field(default_factory=dict)
    previous_profile_id: Optional[str] = None
    previous_profile_name: Optional[str] = None


# Module-level singleton state
_active: Optional[ActiveTempProfile] = None


def _set_active(profile: Optional[ActiveTempProfile]) -> None:
    global _active
    _active = profile


def get_active() -> Optional[Dict[str, Any]]:
    """Return the active temp profile metadata, or None."""
    if _active is None:
        return None
    return {
        "profile_id": _active.profile_id,
        "profile_name": _active.profile_name,
        "original_params": _active.original_params,
    }


async def create_and_load(
    profile_json: Dict[str, Any],
    params: Optional[Dict[str, Any]] = None,
    previous_profile_id: Optional[str] = None,
    previous_profile_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a temporary profile on the machine, load it, and track it.

    The profile name is taken from ``profile_json["name"]`` (or defaults to
    ``"Temp Profile"``). Callers should use a well-known temporary profile
    name (see ``TEMP_PROFILE_NAMES``) so the profile can be identified for
    cleanup. If a temp profile is already active it is force-cleaned first.

    Args:
        profile_json: Full profile JSON including the desired temp profile name.
        params: Optional dict of original user parameters for bookkeeping.
        previous_profile_id: ID of the profile to restore after cleanup.
        previous_profile_name: Name of the profile to restore after cleanup.

    Returns:
        Dict with ``profile_id`` and ``profile_name`` of the created profile.

    Raises:
        MachineUnreachableError: If the machine cannot be reached.
        HTTPException: If profile creation or loading fails.
    """
    async with _get_lock():
        return await _create_and_load_locked(profile_json, params, previous_profile_id, previous_profile_name)


async def _create_and_load_locked(
    profile_json: Dict[str, Any],
    params: Optional[Dict[str, Any]] = None,
    previous_profile_id: Optional[str] = None,
    previous_profile_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Inner implementation of create_and_load, called under lock."""
    # Force-cleanup any lingering temp profile (without restoring — we're about
    # to load a new temp profile, so we inherit the tracked previous profile)
    if _active is not None:
        logger.warning(
            "Replacing already-active temp profile %s", _active.profile_name
        )
        # Inherit the previous profile from the one being replaced so we can
        # still restore the original profile when the new temp finishes.
        if previous_profile_id is None:
            previous_profile_id = _active.previous_profile_id
            previous_profile_name = _active.previous_profile_name
        await _force_cleanup_inner(restore=False)

    name = profile_json.get("name", "Temp Profile")

    # Delete any pre-existing profile with the same name to avoid duplicates
    try:
        profiles = await async_list_profiles()
        if profiles and not isinstance(profiles, dict):
            for p in profiles:
                p_name = getattr(p, "name", None) or ""
                if p_name == name:
                    p_id = getattr(p, "id", None)
                    if p_id:
                        await async_delete_profile(p_id)
                        logger.info(
                            "Deleted pre-existing profile '%s' (%s)", p_name, p_id
                        )
    except Exception as exc:
        logger.warning("Failed to scan for duplicate profiles: %s", exc)

    # Create on machine
    result = await async_create_profile(profile_json)

    # The machine returns the saved profile with its assigned ID.
    profile_id = result.get("id") or profile_json.get("id")
    if not profile_id:
        logger.error("Machine did not return a profile ID after creation")
        raise RuntimeError("Machine did not return a profile ID after creation")

    # Load the profile on the machine (makes it the active/selected profile)
    await async_load_profile_by_id(profile_id)

    _set_active(ActiveTempProfile(
        profile_id=profile_id,
        profile_name=name,
        original_params=params or {},
        previous_profile_id=previous_profile_id,
        previous_profile_name=previous_profile_name,
    ))

    logger.info("Temp profile created and loaded: %s (%s)", name, profile_id)
    return {"profile_id": profile_id, "profile_name": name}


async def cleanup() -> Dict[str, str]:
    """Run a purge cycle and then delete the active temp profile.

    This is the normal post-shot cleanup path: purge flushes water through
    the group head, then the temporary profile is removed from the machine
    and the previously-active profile is restored.

    Returns:
        Dict with ``status`` key.
    """
    async with _get_lock():
        if _active is None:
            return {"status": "no_active_profile"}

        profile_id = _active.profile_id
        profile_name = _active.profile_name
        previous_profile_name = _active.previous_profile_name
        _set_active(None)

        # Purge first (flush water), then delete the profile
        try:
            # Deferred import to avoid circular dependency:
            # commands → temp_profile_service → commands
            from api.routes.commands import _do_publish, _get_snapshot, _require_idle
            snapshot = _get_snapshot()
            # Only purge if machine is idle (shot already stopped)
            if not snapshot.get("brewing"):
                _do_publish("purge")
        except Exception as exc:
            logger.warning("Purge before cleanup failed (non-fatal): %s", exc)

        try:
            await async_delete_profile(profile_id)
            logger.info("Temp profile deleted: %s (%s)", profile_name, profile_id)
        except Exception as exc:
            logger.error("Failed to delete temp profile %s: %s", profile_id, exc)
            return {"status": "delete_failed", "error": str(exc)}

        # Restore the previously-active profile, or deselect if none tracked
        try:
            from api.routes.commands import _do_publish
            _do_publish("select_profile", previous_profile_name or "")
            if previous_profile_name:
                logger.info("Restored previous profile: %s", previous_profile_name)
            else:
                logger.info("No previous profile — sent deselect after cleanup")
        except Exception as exc:
            logger.warning(
                "Failed to restore/deselect profile after cleanup: %s", exc
            )

        return {"status": "cleaned_up", "deleted_profile": profile_name}


async def force_cleanup() -> Dict[str, str]:
    """Delete the temp profile without purging (for aborted shots).

    Returns:
        Dict with ``status`` key.
    """
    async with _get_lock():
        return await _force_cleanup_inner(restore=True)


async def _force_cleanup_inner(restore: bool = True) -> Dict[str, str]:
    """Inner force-cleanup logic, must be called under ``_get_lock()``."""
    global _active
    if _active is None:
        return {"status": "no_active_profile"}

    profile_id = _active.profile_id
    profile_name = _active.profile_name
    previous_profile_name = _active.previous_profile_name if restore else None
    _set_active(None)

    try:
        await async_delete_profile(profile_id)
        logger.info("Temp profile force-deleted: %s (%s)", profile_name, profile_id)
    except Exception as exc:
        logger.error("Failed to force-delete temp profile %s: %s", profile_id, exc)
        return {"status": "delete_failed", "error": str(exc)}

    # Restore the previously-active profile, or deselect if none tracked
    if restore:
        try:
            from api.routes.commands import _do_publish
            _do_publish("select_profile", previous_profile_name or "")
            if previous_profile_name:
                logger.info("Restored previous profile: %s", previous_profile_name)
            else:
                logger.info("No previous profile — sent deselect after force-cleanup")
        except Exception as exc:
            logger.warning(
                "Failed to restore/deselect profile after force-cleanup: %s", exc
            )

    return {"status": "force_cleaned_up", "deleted_profile": profile_name}


async def cleanup_stale() -> Dict[str, Any]:
    """Scan for orphaned ``[Temp] `` profiles on the machine and delete them.

    Called at startup to remove leftovers from crashed sessions.

    Returns:
        Dict with count of deleted profiles and any errors.
    """
    deleted = []
    errors = []

    try:
        profiles = await async_list_profiles()
        if not profiles or isinstance(profiles, dict):
            return {"deleted": 0, "errors": []}

        for profile in profiles:
            name = getattr(profile, "name", None) or ""
            profile_id = getattr(profile, "id", None)
            if is_temp_profile(name) and profile_id:
                try:
                    await async_delete_profile(profile_id)
                    deleted.append(name)
                    logger.info("Cleaned stale temp profile: %s (%s)", name, profile_id)
                except Exception as exc:
                    errors.append({"name": name, "error": str(exc)})
                    logger.warning(
                        "Failed to clean stale temp profile %s: %s", name, exc
                    )
    except MachineUnreachableError:
        logger.info("Machine not reachable — skipping stale temp profile cleanup")
        return {"deleted": 0, "errors": [], "skipped": "machine_unreachable"}
    except Exception as exc:
        logger.warning("Failed to scan for stale temp profiles: %s", exc)
        return {"deleted": 0, "errors": [str(exc)]}

    if deleted:
        logger.info("Cleaned %d stale temp profile(s): %s", len(deleted), deleted)

    return {"deleted": len(deleted), "deleted_names": deleted, "errors": errors}
