"""Dial-In Guide session management service."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

from config import DATA_DIR
from models.dialin import (
    CoffeeDetails,
    DialInIteration,
    DialInSession,
    SessionStatus,
    TasteFeedback,
)

logger = logging.getLogger(__name__)

# In-memory session store keyed by session id
_sessions: dict[str, DialInSession] = {}

# Module-level asyncio lock with lazy creation.
# Recreated when the running event loop changes so that tests using a new
# loop per function don't hit "attached to a different loop".
_state_lock: Optional[asyncio.Lock] = None
_state_lock_loop: Optional[asyncio.AbstractEventLoop] = None


def _get_state_lock() -> asyncio.Lock:
    """Return the module-level state lock, (re)creating it when needed."""
    global _state_lock, _state_lock_loop
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        running_loop = None

    if _state_lock is None or (running_loop is not None and running_loop is not _state_lock_loop):
        _state_lock = asyncio.Lock()
        _state_lock_loop = running_loop
    return _state_lock


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

_PERSISTENCE_FILE: Path = DATA_DIR / "dialin_sessions.json"


async def _persist() -> None:
    """Write active sessions to disk atomically (tmp + rename)."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        active = {
            sid: session.model_dump(mode="json")
            for sid, session in _sessions.items()
            if session.status == SessionStatus.ACTIVE
        }

        tmp = _PERSISTENCE_FILE.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(active, f, indent=2)
        tmp.replace(_PERSISTENCE_FILE)

        logger.debug("Persisted %d active dial-in sessions", len(active))
    except Exception as e:
        logger.error("Failed to persist dial-in sessions: %s", e, exc_info=True)


async def _load() -> None:
    """Load sessions from disk on startup."""
    try:
        if not _PERSISTENCE_FILE.exists():
            logger.info("No persisted dial-in sessions found (first run)")
            return

        with open(_PERSISTENCE_FILE, "r") as f:
            data = json.load(f)

        if not isinstance(data, dict):
            logger.warning("Invalid dial-in sessions file format, ignoring")
            return

        for sid, raw in data.items():
            try:
                _sessions[sid] = DialInSession.model_validate(raw)
            except Exception as e:
                logger.warning("Skipping corrupt dial-in session %s: %s", sid, e)

        logger.info("Loaded %d dial-in sessions from disk", len(_sessions))
    except json.JSONDecodeError as e:
        logger.error("Corrupt dial-in sessions file, ignoring: %s", e)
        try:
            backup = _PERSISTENCE_FILE.with_suffix(".corrupt")
            _PERSISTENCE_FILE.rename(backup)
            logger.info("Backed up corrupt file to %s", backup)
        except Exception:
            pass
    except Exception as e:
        logger.error("Failed to load dial-in sessions: %s", e, exc_info=True)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def create_session(
    coffee: CoffeeDetails,
    profile_name: Optional[str] = None,
) -> DialInSession:
    """Create a new dial-in session. Returns the session with a UUID id."""
    now = datetime.now(timezone.utc)
    session = DialInSession(
        id=uuid4().hex[:12],
        coffee=coffee,
        profile_name=profile_name,
        iterations=[],
        status=SessionStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )

    async with _get_state_lock():
        _sessions[session.id] = session
        await _persist()

    logger.info("Created dial-in session %s", session.id)
    return session


async def get_session(session_id: str) -> Optional[DialInSession]:
    """Get session by id. Returns None if not found."""
    return _sessions.get(session_id)


async def list_sessions(
    status: Optional[SessionStatus] = None,
) -> list[DialInSession]:
    """List all sessions, optionally filtered by status."""
    if status is None:
        return list(_sessions.values())
    return [s for s in _sessions.values() if s.status == status]


async def add_iteration(
    session_id: str,
    taste: TasteFeedback,
    shot_ref: Optional[str] = None,
) -> DialInIteration:
    """Add a taste iteration to a session. Auto-increments iteration_number."""
    async with _get_state_lock():
        session = _sessions.get(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found")
        if session.status != SessionStatus.ACTIVE:
            raise ValueError(f"Session {session_id} is not active")

        iteration = DialInIteration(
            iteration_number=len(session.iterations) + 1,
            shot_ref=shot_ref,
            taste=taste,
            recommendations=[],
            timestamp=datetime.now(timezone.utc),
        )
        session.iterations.append(iteration)
        session.updated_at = datetime.now(timezone.utc)
        await _persist()

    logger.info(
        "Added iteration %d to session %s",
        iteration.iteration_number,
        session_id,
    )
    return iteration


async def update_recommendations(
    session_id: str,
    iteration_number: int,
    recommendations: list[str],
) -> DialInIteration:
    """Update the recommendations for a specific iteration."""
    async with _get_state_lock():
        session = _sessions.get(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found")

        for iteration in session.iterations:
            if iteration.iteration_number == iteration_number:
                iteration.recommendations = recommendations
                session.updated_at = datetime.now(timezone.utc)
                await _persist()
                return iteration

        raise ValueError(
            f"Iteration {iteration_number} not found in session {session_id}"
        )


async def complete_session(session_id: str) -> DialInSession:
    """Mark session as completed."""
    async with _get_state_lock():
        session = _sessions.get(session_id)
        if session is None:
            raise ValueError(f"Session {session_id} not found")

        session.status = SessionStatus.COMPLETED
        session.updated_at = datetime.now(timezone.utc)
        await _persist()

    logger.info("Completed dial-in session %s", session_id)
    return session


async def delete_session(session_id: str) -> bool:
    """Delete a session. Returns True if found and deleted."""
    async with _get_state_lock():
        if session_id not in _sessions:
            return False
        del _sessions[session_id]
        await _persist()

    logger.info("Deleted dial-in session %s", session_id)
    return True
