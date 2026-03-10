"""Generation progress tracking for real-time status updates.

Provides an async event emitter that the profile generation flow can use
to push phase updates to connected SSE clients.
"""

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Dict, Optional


class GenerationPhase(str, Enum):
    """Phases of profile generation."""
    QUEUED = "queued"
    ANALYZING = "analyzing"
    GENERATING = "generating"
    VALIDATING = "validating"
    RETRYING = "retrying"
    UPLOADING = "uploading"
    COMPLETE = "complete"
    FAILED = "failed"
    KEEPALIVE = "keepalive"


@dataclass
class ProgressEvent:
    """A single progress event."""
    phase: GenerationPhase
    message: str
    attempt: int = 0          # retry attempt number (0 = first try)
    max_attempts: int = 3     # total attempts allowed
    elapsed: float = 0.0      # seconds since generation started
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@dataclass
class GenerationState:
    """Tracks the state of an in-progress generation."""
    generation_id: str
    created_at: float = field(default_factory=time.monotonic)
    events: list = field(default_factory=list)
    _waiters: list = field(default_factory=list, repr=False)
    _completed: bool = False

    def emit(self, event: ProgressEvent):
        """Push a new progress event and notify all waiters."""
        event.elapsed = round(time.monotonic() - self.created_at, 1)
        self.events.append(event)

        if event.phase in (GenerationPhase.COMPLETE, GenerationPhase.FAILED):
            self._completed = True

        # Wake up all waiting SSE consumers
        for waiter in self._waiters:
            if not waiter.done():
                waiter.set_result(event)
        self._waiters.clear()

    async def stream(self) -> AsyncIterator[ProgressEvent]:
        """Async generator that yields events as they arrive.

        First replays any events that have already been emitted, then
        blocks until new events arrive.
        """
        # Replay existing events
        for event in list(self.events):
            yield event

        # Stream new events as they arrive
        while not self._completed:
            waiter: asyncio.Future = asyncio.get_running_loop().create_future()
            self._waiters.append(waiter)
            try:
                event = await asyncio.wait_for(waiter, timeout=60)
                yield event
            except asyncio.TimeoutError:
                # Yield keepalive so the SSE connection stays open for
                # long-running generations (retries, slow models, etc.)
                yield ProgressEvent(phase=GenerationPhase.KEEPALIVE, message="keepalive")
                continue
            finally:
                # Remove the waiter so emit() doesn't set results on orphans
                try:
                    self._waiters.remove(waiter)
                except ValueError:
                    pass  # already removed by emit()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize current state for SSE."""
        latest = self.events[-1] if self.events else None
        return {
            "generation_id": self.generation_id,
            "phase": latest.phase.value if latest else "queued",
            "message": latest.message if latest else "Waiting...",
            "attempt": latest.attempt if latest else 0,
            "max_attempts": latest.max_attempts if latest else 3,
            "elapsed": latest.elapsed if latest else 0,
            "events_count": len(self.events),
        }


# In-memory store of active generations (only one at a time due to lock)
_active_generations: Dict[str, GenerationState] = {}


def create_generation(generation_id: str) -> GenerationState:
    """Create and register a new generation state."""
    state = GenerationState(generation_id=generation_id)
    _active_generations[generation_id] = state
    return state


def get_generation(generation_id: str) -> Optional[GenerationState]:
    """Get an active generation state by ID."""
    return _active_generations.get(generation_id)


def remove_generation(generation_id: str) -> None:
    """Remove a completed generation from the store."""
    _active_generations.pop(generation_id, None)


def get_latest_generation() -> Optional[GenerationState]:
    """Get the most recently created generation state."""
    if not _active_generations:
        return None
    return list(_active_generations.values())[-1]
