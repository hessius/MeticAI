"""Shared state, persistence, and helper functions for scheduling.

This module is the single source of truth for:
- Scheduled shots state and persistence
- Recurring schedules state and persistence  
- Helper functions for schedule timing calculations
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging
import json
import asyncio
from pathlib import Path

from config import DATA_DIR

logger = logging.getLogger(__name__)

# ==============================================================================
# Shared In-Memory State
# ==============================================================================
# These are the ONLY copies of these dictionaries - all modules should import from here

_scheduled_shots: dict = {}
_scheduled_tasks: dict = {}
_recurring_schedules: dict = {}

# Constant for preheat duration
PREHEAT_DURATION_MINUTES = 10


# ==============================================================================
# Scheduled Shots Persistence
# ==============================================================================

class ScheduledShotsPersistence:
    """Manages persistence of scheduled shots to disk.
    
    Scheduled shots are stored in a JSON file to survive server restarts.
    This ensures that scheduled shots are not lost during crashes, deploys,
    or host reboots.
    """
    
    def __init__(self, persistence_file: str | Path | None = None):
        """Initialize the persistence layer.
        
        Args:
            persistence_file: Path to the JSON file for storing scheduled shots.
                             Defaults to DATA_DIR/scheduled_shots.json.
        """
        if persistence_file is None:
            self.persistence_file = DATA_DIR / "scheduled_shots.json"
        else:
            self.persistence_file = Path(persistence_file)
        self._lock = asyncio.Lock()
        
        # Ensure the parent directory exists
        self.persistence_file.parent.mkdir(parents=True, exist_ok=True)
    
    async def save(self, scheduled_shots: dict) -> None:
        """Save scheduled shots to disk.
        
        Args:
            scheduled_shots: Dictionary of scheduled shots to persist.
        """
        async with self._lock:
            try:
                # Only save shots that are scheduled or preheating (not completed/failed/cancelled)
                active_shots = {
                    shot_id: shot for shot_id, shot in scheduled_shots.items()
                    if shot.get("status") in ["scheduled", "preheating"]
                }
                
                # Write atomically using a temporary file
                temp_file = self.persistence_file.with_suffix('.tmp')
                with open(temp_file, 'w') as f:
                    json.dump(active_shots, f, indent=2)
                
                # Atomic rename
                temp_file.replace(self.persistence_file)
                
                logger.debug(f"Persisted {len(active_shots)} scheduled shots to {self.persistence_file}")
            except Exception as e:
                logger.error(f"Failed to save scheduled shots: {e}", exc_info=True)
    
    async def load(self) -> dict:
        """Load scheduled shots from disk.
        
        Returns:
            Dictionary of scheduled shots, or empty dict if file doesn't exist or is invalid.
        """
        async with self._lock:
            try:
                if not self.persistence_file.exists():
                    logger.info("No persisted scheduled shots found (first run)")
                    return {}
                
                with open(self.persistence_file, 'r') as f:
                    data = json.load(f)
                
                if not isinstance(data, dict):
                    logger.warning("Invalid scheduled shots file format, ignoring")
                    return {}
                
                logger.info(f"Loaded {len(data)} scheduled shots from {self.persistence_file}")
                return data
            except json.JSONDecodeError as e:
                logger.error(f"Corrupt scheduled shots file, ignoring: {e}")
                # Backup the corrupt file
                try:
                    backup_file = self.persistence_file.with_suffix('.corrupt')
                    self.persistence_file.rename(backup_file)
                    logger.info(f"Backed up corrupt file to {backup_file}")
                except Exception:
                    # Ignore errors during backup (file system issues, permissions, etc.)
                    pass
                return {}
            except Exception as e:
                logger.error(f"Failed to load scheduled shots: {e}", exc_info=True)
                return {}
    
    async def clear(self) -> None:
        """Clear all persisted scheduled shots."""
        async with self._lock:
            try:
                if self.persistence_file.exists():
                    self.persistence_file.unlink()
                    logger.info("Cleared persisted scheduled shots")
            except Exception as e:
                logger.error(f"Failed to clear scheduled shots: {e}", exc_info=True)


# ==============================================================================
# Recurring Schedules Persistence
# ==============================================================================

class RecurringSchedulesPersistence:
    """Manages persistence of recurring schedules to disk.
    
    Recurring schedules define repeated preheat/shot times (e.g., daily, weekdays).
    """
    
    def __init__(self, persistence_file: str | Path | None = None):
        if persistence_file is None:
            self.persistence_file = DATA_DIR / "recurring_schedules.json"
        else:
            self.persistence_file = Path(persistence_file)
        self._lock = asyncio.Lock()
        
        self.persistence_file.parent.mkdir(parents=True, exist_ok=True)
    
    async def save(self, schedules: dict) -> None:
        """Save recurring schedules to disk."""
        async with self._lock:
            try:
                # Only save enabled schedules
                active_schedules = {
                    sid: s for sid, s in schedules.items()
                    if s.get("enabled", True)
                }
                
                temp_file = self.persistence_file.with_suffix('.tmp')
                with open(temp_file, 'w') as f:
                    json.dump(active_schedules, f, indent=2)
                temp_file.replace(self.persistence_file)
                
                logger.debug(f"Persisted {len(active_schedules)} recurring schedules")
            except Exception as e:
                logger.error(f"Failed to save recurring schedules: {e}", exc_info=True)
    
    async def load(self) -> dict:
        """Load recurring schedules from disk."""
        async with self._lock:
            try:
                if not self.persistence_file.exists():
                    return {}
                
                with open(self.persistence_file, 'r') as f:
                    data = json.load(f)
                
                if not isinstance(data, dict):
                    return {}
                
                logger.info(f"Loaded {len(data)} recurring schedules")
                return data
            except Exception as e:
                logger.error(f"Failed to load recurring schedules: {e}", exc_info=True)
                return {}


# ==============================================================================
# Persistence Instances and Helper Functions  
# ==============================================================================

# Initialize persistence layers
_scheduled_shots_persistence = ScheduledShotsPersistence()
_recurring_schedules_persistence = RecurringSchedulesPersistence()

# Legacy alias for backward compatibility
SchedulePersistence = ScheduledShotsPersistence


async def save_scheduled_shots():
    """Save scheduled shots to persistence."""
    await _scheduled_shots_persistence.save(_scheduled_shots)


async def load_scheduled_shots() -> dict:
    """Load scheduled shots from persistence."""
    return await _scheduled_shots_persistence.load()


async def save_recurring_schedules():
    """Save recurring schedules to persistence."""
    await _recurring_schedules_persistence.save(_recurring_schedules)


async def load_recurring_schedules():
    """Load recurring schedules from persistence."""
    global _recurring_schedules
    _recurring_schedules = await _recurring_schedules_persistence.load()


async def restore_scheduled_shots():
    """Restore scheduled shots from disk on startup."""
    global _scheduled_shots
    _scheduled_shots = await _scheduled_shots_persistence.load()
    
    if _scheduled_shots:
        logger.info(f"Restored {len(_scheduled_shots)} scheduled shots from persistence")


# ==============================================================================
# Schedule Timing Calculations
# ==============================================================================

def get_next_occurrence(schedule: dict) -> Optional[datetime]:
    """Calculate the next occurrence of a recurring schedule.
    
    Args:
        schedule: Recurring schedule dict with:
            - time: HH:MM format
            - recurrence_type: 'daily', 'weekdays', 'weekends', 'interval', 'specific_days'
            - interval_days: For 'interval' type, number of days between runs
            - days_of_week: For 'specific_days' type, list of day numbers (0=Monday)
    
    Returns:
        Next datetime when the schedule should run, or None if invalid.
    """
    MAX_SCHEDULING_DAYS = 400  # Maximum ~1 year ahead to search for next occurrence
    
    try:
        time_str = schedule.get("time", "07:00")
        hour, minute = map(int, time_str.split(":"))
        recurrence_type = schedule.get("recurrence_type", "daily")
        
        now = datetime.now(timezone.utc)
        today = now.date()
        
        # Start checking from today
        candidate = datetime(today.year, today.month, today.day, hour, minute, tzinfo=timezone.utc)
        
        # If today's time has passed, start from tomorrow
        if candidate <= now:
            candidate += timedelta(days=1)
        
        # Find the next valid day based on recurrence type
        for _ in range(MAX_SCHEDULING_DAYS):
            weekday = candidate.weekday()  # 0=Monday, 6=Sunday
            
            if recurrence_type == "daily":
                return candidate
            elif recurrence_type == "weekdays" and weekday < 5:  # Mon-Fri
                return candidate
            elif recurrence_type == "weekends" and weekday >= 5:  # Sat-Sun
                return candidate
            elif recurrence_type == "interval":
                interval_days = schedule.get("interval_days", 1)
                # Check if this day is valid based on last_run
                last_run = schedule.get("last_run")
                if last_run:
                    try:
                        # Handle ISO format with trailing Z (replace with +00:00 for fromisoformat)
                        last_run_str = last_run.replace('Z', '+00:00') if isinstance(last_run, str) else str(last_run)
                        last_run_dt = datetime.fromisoformat(last_run_str)
                        days_since = (candidate - last_run_dt).days
                        if days_since >= interval_days:
                            return candidate
                    except (ValueError, AttributeError):
                        # Invalid datetime format - treat as no last run
                        logger.warning(f"Invalid last_run format for schedule {schedule.get('id')}: {last_run}")
                        return candidate
                else:
                    # No last run, so this is the first run
                    return candidate
            elif recurrence_type == "specific_days":
                days_of_week = schedule.get("days_of_week", [])
                if weekday in days_of_week:
                    return candidate
            
            # Move to next day
            candidate += timedelta(days=1)
        
        return None
    except Exception as e:
        logger.error(f"Failed to calculate next occurrence: {e}")
        return None

