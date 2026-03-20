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
import copy
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from services.meticulous_service import (
    async_create_profile,
    async_delete_profile,
    async_list_profiles,
    async_load_profile_by_id,
    async_load_profile_from_json,
    MachineUnreachableError,
)

logger = logging.getLogger(__name__)

# Well-known temporary profile names created by features like pour-over.
# Used by cleanup_stale() to remove orphans on startup.
TEMP_PROFILE_NAMES = frozenset({"MeticAI Ratio Pour-Over"})

# Prefixes for temporary profile names (e.g. recipe profiles, override profiles).
TEMP_PROFILE_PREFIXES = frozenset({"MeticAI Recipe: ", "MeticAI Override: "})


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
    ephemeral: bool = False


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


# Variable types recognised by the Meticulous profile format.
VARIABLE_TYPES = frozenset({
    "pressure", "flow", "weight", "power", "time", "piston_position",
    "temperature",
})


def apply_variable_overrides(
    profile_data: Dict[str, Any],
    overrides: Dict[str, Any],
) -> Dict[str, Any]:
    """Apply variable value overrides to a deep-copied profile.

    Only adjustable variables (key does NOT start with ``info_``) can be
    overridden.  Unknown keys or ``info_`` keys are silently skipped so
    callers don't need to pre-filter.

    When overriding synthesised top-level keys (``final_weight``,
    ``temperature``) the corresponding top-level profile field is also
    updated so that the Meticulous machine receives the correct value
    regardless of whether it reads from ``variables`` or the top-level.

    Returns a new profile dict — the original is not mutated.
    """
    profile = copy.deepcopy(profile_data)
    variables = profile.get("variables")

    # Top-level keys that may be synthesised as variables
    TOP_LEVEL_KEYS = {"final_weight", "temperature"}

    if not overrides:
        return profile

    applied: dict[str, Any] = {}

    # Apply overrides to the variables array if present
    if variables:
        adjustable_keys: set[str] = set()
        for var in variables:
            key = var.get("key", "")
            if key and not key.startswith("info_"):
                adjustable_keys.add(key)

        for key, value in overrides.items():
            if key not in adjustable_keys:
                if key not in TOP_LEVEL_KEYS:
                    logger.debug("Skipping override for non-adjustable key: %s", key)
                continue
            for var in variables:
                if var.get("key") == key:
                    var["value"] = value
                    applied[key] = value
                    break

    # Always apply top-level key overrides directly on the profile dict
    for key in TOP_LEVEL_KEYS:
        if key in overrides:
            profile[key] = overrides[key]
            if key not in applied:
                applied[key] = overrides[key]

    if applied:
        logger.info("Applied %d variable override(s): %s", len(applied), list(applied))
    return profile


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


async def load_ephemeral(
    profile_json: Dict[str, Any],
    params: Optional[Dict[str, Any]] = None,
    previous_profile_id: Optional[str] = None,
    previous_profile_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Load a profile into the machine's memory without persisting.

    Uses ``POST /api/v1/profile/load`` to make the profile the active
    selection for the next shot.  Nothing is saved to the machine's
    catalogue, so there is nothing to delete during cleanup — only
    the previous profile needs to be restored.

    Args:
        profile_json: Full profile JSON (will be normalised before sending).
        params: Optional bookkeeping dict (stored in active state).
        previous_profile_id: ID of the profile to restore after cleanup.
        previous_profile_name: Name of the profile to restore after cleanup.

    Returns:
        Dict with ``profile_id`` and ``profile_name``.
    """
    async with _get_lock():
        # Force-cleanup any lingering temp profile
        if _active is not None:
            logger.warning(
                "Replacing already-active temp profile %s", _active.profile_name
            )
            if previous_profile_id is None:
                previous_profile_id = _active.previous_profile_id
                previous_profile_name = _active.previous_profile_name
            await _force_cleanup_inner(restore=False)

        name = profile_json.get("name", "Ephemeral Profile")
        profile_id = profile_json.get("id", "ephemeral")

        # Ephemeral load — the profile is NOT saved to the catalogue
        await async_load_profile_from_json(profile_json)

        _set_active(ActiveTempProfile(
            profile_id=profile_id,
            profile_name=name,
            original_params=params or {},
            previous_profile_id=previous_profile_id,
            previous_profile_name=previous_profile_name,
            ephemeral=True,
        ))

        logger.info("Ephemeral profile loaded: %s (%s)", name, profile_id)
        return {"profile_id": profile_id, "profile_name": name}


async def cleanup() -> Dict[str, str]:
    """Run a purge cycle and clean up the active temp profile.

    For ephemeral profiles (loaded via ``load_ephemeral``), no delete is
    needed — the profile was never saved to the catalogue.  For persisted
    temp profiles (created via ``create_and_load``), the profile is deleted.

    In both cases the previously-active profile is restored.

    Returns:
        Dict with ``status`` key.
    """
    async with _get_lock():
        if _active is None:
            return {"status": "no_active_profile"}

        profile_id = _active.profile_id
        profile_name = _active.profile_name
        previous_profile_name = _active.previous_profile_name
        is_ephemeral = _active.ephemeral
        _set_active(None)

        # Purge first (flush water)
        try:
            from api.routes.commands import _do_publish, _get_snapshot
            snapshot = _get_snapshot()
            if not snapshot.get("brewing"):
                _do_publish("purge")
        except Exception as exc:
            logger.warning("Purge before cleanup failed (non-fatal): %s", exc)

        # Only delete from catalogue if the profile was persisted
        if not is_ephemeral:
            try:
                await async_delete_profile(profile_id)
                logger.info("Temp profile deleted: %s (%s)", profile_name, profile_id)
            except Exception as exc:
                logger.error("Failed to delete temp profile %s: %s", profile_id, exc)
                return {"status": "delete_failed", "error": str(exc)}
        else:
            logger.info("Ephemeral profile cleaned up (no delete needed): %s", profile_name)

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
    is_ephemeral = _active.ephemeral
    _set_active(None)

    # Only delete from catalogue if the profile was persisted
    if not is_ephemeral:
        try:
            await async_delete_profile(profile_id)
            logger.info("Temp profile force-deleted: %s (%s)", profile_name, profile_id)
        except Exception as exc:
            logger.error("Failed to force-delete temp profile %s: %s", profile_id, exc)
            return {"status": "delete_failed", "error": str(exc)}
    else:
        logger.info("Ephemeral profile force-cleaned (no delete needed): %s", profile_name)

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
