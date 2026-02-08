"""Shared state and helper functions for scheduling."""
from datetime import datetime, timezone, timedelta
from typing import Optional
import asyncio
import logging
import json
from pathlib import Path
import os
import tempfile

logger = logging.getLogger(__name__)

# Data directory configuration
TEST_MODE = os.environ.get("TEST_MODE") == "true"
if TEST_MODE:
    DATA_DIR = Path(tempfile.gettempdir()) / "meticai_test_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
else:
    DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))

# In-memory storage for scheduled shots and recurring schedules
_scheduled_shots: dict = {}
_scheduled_tasks: dict = {}
_recurring_schedules: dict = {}


class SchedulePersistence:
    """Simple JSON persistence for scheduled shots."""
    
    def __init__(self, filename: str):
        self.filepath = DATA_DIR / filename
        self.filepath.parent.mkdir(parents=True, exist_ok=True)
    
    async def save(self, data: dict):
        """Save data to file."""
        try:
            # Use atomic write
            temp_path = self.filepath.with_suffix('.tmp')
            with open(temp_path, 'w') as f:
                json.dump(data, f, indent=2)
            temp_path.replace(self.filepath)
        except Exception as e:
            logger.error(f"Failed to save to {self.filepath}: {e}")
    
    async def load(self) -> dict:
        """Load data from file."""
        try:
            if self.filepath.exists():
                with open(self.filepath, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load from {self.filepath}: {e}")
        return {}


# Persistence instances
_persistence = SchedulePersistence("scheduled_shots.json")
_recurring_persistence = SchedulePersistence("recurring_schedules.json")


async def save_scheduled_shots():
    """Save scheduled shots to persistence."""
    await _persistence.save(_scheduled_shots)


async def load_scheduled_shots() -> dict:
    """Load scheduled shots from persistence."""
    return await _persistence.load()


async def save_recurring_schedules():
    """Save recurring schedules to persistence."""
    await _recurring_persistence.save(_recurring_schedules)


async def load_recurring_schedules():
    """Load recurring schedules from persistence."""
    global _recurring_schedules
    _recurring_schedules = await _recurring_persistence.load()


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
                last_run_str = schedule.get("last_run")
                if last_run_str:
                    last_run = datetime.fromisoformat(last_run_str)
                    days_since = (candidate - last_run).days
                    if days_since >= interval_days:
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
