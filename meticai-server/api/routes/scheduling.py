"""Machine status and scheduling endpoints."""
from fastapi import APIRouter, Request, HTTPException
from typing import Optional
from datetime import datetime, timezone, timedelta
import json
import uuid
import logging
import asyncio

from services.meticulous_service import get_meticulous_api, execute_scheduled_shot

router = APIRouter()
logger = logging.getLogger(__name__)

# Constants
PREHEAT_DURATION_MINUTES = 15

# In-memory storage for scheduled shots
_scheduled_shots = {}
_scheduled_tasks = {}
_recurring_schedules = {}


async def _save_scheduled_shots():
    """Placeholder - in production this should persist to disk."""
    pass


async def _save_recurring_schedules():
    """Placeholder - in production this should persist to disk."""
    pass


async def _schedule_next_recurring(schedule_id: str, schedule: dict):
    """Placeholder - in production this should schedule the next occurrence."""
    pass


def _get_next_occurrence(schedule: dict) -> Optional[datetime]:
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
        for _ in range(400):  # Max ~1 year ahead
            weekday = candidate.weekday()  # 0=Monday, 6=Sunday
            
            if recurrence_type == "daily":
                return candidate
            elif recurrence_type == "weekdays":
                if weekday < 5:  # Monday-Friday
                    return candidate
            elif recurrence_type == "weekends":
                if weekday >= 5:  # Saturday-Sunday
                    return candidate
            elif recurrence_type == "specific_days":
                days = schedule.get("days_of_week", [])
                if weekday in days:
                    return candidate
            elif recurrence_type == "interval":
                # For interval, we need to check against last_run
                last_run_str = schedule.get("last_run")
                interval_days = schedule.get("interval_days", 1)
                
                if not last_run_str:
                    return candidate  # First run
                
                last_run = datetime.fromisoformat(last_run_str.replace('Z', '+00:00'))
                next_run = last_run + timedelta(days=interval_days)
                next_run = next_run.replace(hour=hour, minute=minute, second=0, microsecond=0)
                
                if next_run > now:
                    return next_run
                else:
                    # If we missed runs, schedule for next available slot
                    return candidate
            
            candidate += timedelta(days=1)
        
        return None
    except Exception as e:
        logger.error(f"Failed to calculate next occurrence: {e}")
        return None




@router.get("/api/machine/status")
async def get_machine_status(request: Request):
    """Get the current status of the Meticulous machine.
    
    Returns machine state, current profile, and whether preheating is active.
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching machine status",
            extra={"request_id": request_id}
        )
        
        api = get_meticulous_api()
        
        # Get current shot/status (live machine state)
        try:
            status = api.session.get(f"{api.base_url}/api/v1/status")
            if status.status_code == 200:
                status_data = status.json()
            else:
                status_data = {"state": "unknown"}
        except Exception as e:
            logger.warning(f"Could not fetch machine status: {e}")
            status_data = {"state": "unknown", "error": str(e)}
        
        # Get settings to check preheat state
        try:
            settings = api.get_settings()
            if hasattr(settings, 'error') and settings.error:
                settings_data = {}
            elif hasattr(settings, 'model_dump'):
                settings_data = settings.model_dump()
            else:
                settings_data = dict(settings) if settings else {}
        except Exception as e:
            logger.warning(f"Could not fetch settings: {e}")
            settings_data = {}
        
        # Get last loaded profile
        try:
            last_profile = api.get_last_profile()
            if hasattr(last_profile, 'error') and last_profile.error:
                last_profile_data = None
            elif hasattr(last_profile, 'profile'):
                last_profile_data = {
                    "id": last_profile.profile.id if hasattr(last_profile.profile, 'id') else None,
                    "name": last_profile.profile.name if hasattr(last_profile.profile, 'name') else None
                }
            else:
                last_profile_data = None
        except Exception as e:
            logger.warning(f"Could not fetch last profile: {e}")
            last_profile_data = None
        
        return {
            "status": "success",
            "machine_status": status_data,
            "settings": settings_data,
            "current_profile": last_profile_data,
            "scheduled_shots": list(_scheduled_shots.values())
        }
        
    except Exception as e:
        logger.error(
            f"Failed to get machine status: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.post("/api/machine/preheat")
async def start_preheat(request: Request):
    """Start preheating the machine.
    
    Preheating takes approximately 10 minutes to reach optimal temperature.
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Starting machine preheat",
            extra={"request_id": request_id}
        )
        
        api = get_meticulous_api()
        
        if api is None:
            raise HTTPException(
                status_code=503,
                detail="Meticulous machine not connected"
            )
        
        # Use ActionType.PREHEAT to start the preheat cycle
        try:
            from meticulous.api_types import ActionType
            result = api.execute_action(ActionType.PREHEAT)
            
            if hasattr(result, 'error') and result.error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to start preheat: {result.error}"
                )
        except ImportError:
            # Fallback: direct API call
            result = api.session.post(
                f"{api.base_url}/api/v1/action",
                json={"action": "preheat"}
            )
            if result.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to start preheat: {result.text}"
                )
        
        return {
            "status": "success",
            "message": "Preheat started",
            "estimated_ready_in_minutes": PREHEAT_DURATION_MINUTES
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to start preheat: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.post("/api/machine/run-profile/{profile_id}")
async def run_profile(profile_id: str, request: Request):
    """Load and run a profile immediately.
    
    This loads the profile into the machine and starts extraction.
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Running profile: {profile_id}",
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        
        api = get_meticulous_api()
        
        if api is None:
            raise HTTPException(
                status_code=503,
                detail="Meticulous machine not connected"
            )
        
        # Load the profile
        load_result = api.load_profile_by_id(profile_id)
        if hasattr(load_result, 'error') and load_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to load profile: {load_result.error}"
            )
        
        # Start the extraction
        from meticulous.api_types import ActionType
        action_result = api.execute_action(ActionType.START)
        if hasattr(action_result, 'error') and action_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to start profile: {action_result.error}"
            )
        
        return {
            "status": "success",
            "message": f"Profile started",
            "profile_id": profile_id,
            "action": action_result.action if hasattr(action_result, 'action') else "start"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to run profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.post("/api/machine/schedule-shot")
async def schedule_shot(request: Request):
    """Schedule a shot to run at a specific time.
    
    Request body:
    - profile_id: str - The profile ID to run
    - scheduled_time: str - ISO format datetime when to run the shot
    - preheat: bool - Whether to preheat before the shot (default: false)
    
    If preheat is enabled, preheating will start 10 minutes before scheduled_time.
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        profile_id = body.get("profile_id")
        scheduled_time_str = body.get("scheduled_time")
        preheat = body.get("preheat", False)
        
        if not scheduled_time_str:
            raise HTTPException(
                status_code=400,
                detail="scheduled_time is required"
            )
        
        # Validate that we have either a profile or preheat enabled
        if not profile_id and not preheat:
            raise HTTPException(
                status_code=400,
                detail="Either profile_id or preheat must be provided"
            )
        
        # Parse the scheduled time
        try:
            scheduled_time = datetime.fromisoformat(scheduled_time_str.replace('Z', '+00:00'))
            # Ensure timezone-aware datetime
            if scheduled_time.tzinfo is None:
                scheduled_time = scheduled_time.replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid scheduled_time format. Use ISO format."
            )
        
        # Calculate delays
        now = datetime.now(timezone.utc)
        shot_delay = (scheduled_time - now).total_seconds()
        
        if shot_delay < 0:
            raise HTTPException(
                status_code=400,
                detail="scheduled_time must be in the future"
            )
        
        # Generate a unique ID for this scheduled shot
        schedule_id = str(uuid.uuid4())
        
        # Store the scheduled shot info
        scheduled_shot = {
            "id": schedule_id,
            "profile_id": profile_id,
            "scheduled_time": scheduled_time_str,
            "preheat": preheat,
            "status": "scheduled",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        _scheduled_shots[schedule_id] = scheduled_shot
        
        # Persist to disk
        await _save_scheduled_shots()
        
        logger.info(
            f"Scheduling shot: {schedule_id}",
            extra={
                "request_id": request_id,
                "schedule_id": schedule_id,
                "profile_id": profile_id,
                "scheduled_time": scheduled_time_str,
                "preheat": preheat
            }
        )
        
        # Create async task to execute at scheduled time
        async def execute_scheduled_shot():
            try:
                task_start_time = datetime.now(timezone.utc)
                api = get_meticulous_api()
                
                # Track whether we've already waited the full delay
                full_delay_waited = False
                
                # If preheat is enabled, start it 10 minutes before
                if preheat:
                    preheat_delay = shot_delay - (PREHEAT_DURATION_MINUTES * 60)
                    if preheat_delay > 0:
                        await asyncio.sleep(preheat_delay)
                        _scheduled_shots[schedule_id]["status"] = "preheating"
                        await _save_scheduled_shots()
                        
                        # Start preheat using ActionType.PREHEAT
                        try:
                            from meticulous.api_types import ActionType as AT
                            api.execute_action(AT.PREHEAT)
                        except Exception as e:
                            logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                        
                        # Wait for remaining time until shot
                        await asyncio.sleep(PREHEAT_DURATION_MINUTES * 60)
                        full_delay_waited = True
                    else:
                        # Not enough time for full preheat, start immediately
                        _scheduled_shots[schedule_id]["status"] = "preheating"
                        await _save_scheduled_shots()
                        try:
                            from meticulous.api_types import ActionType as AT
                            api.execute_action(AT.PREHEAT)
                        except Exception as e:
                            logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                
                # If we haven't already waited the full delay, calculate remaining time
                if not full_delay_waited:
                    elapsed = (datetime.now(timezone.utc) - task_start_time).total_seconds()
                    remaining_delay = max(0, shot_delay - elapsed)
                    await asyncio.sleep(remaining_delay)
                
                _scheduled_shots[schedule_id]["status"] = "running"
                await _save_scheduled_shots()
                
                # Load and run the profile (if profile_id was provided)
                if profile_id:
                    load_result = api.load_profile_by_id(profile_id)
                    if not (hasattr(load_result, 'error') and load_result.error):
                        from meticulous.api_types import ActionType
                        api.execute_action(ActionType.START)
                        _scheduled_shots[schedule_id]["status"] = "completed"
                        await _save_scheduled_shots()
                    else:
                        _scheduled_shots[schedule_id]["status"] = "failed"
                        _scheduled_shots[schedule_id]["error"] = load_result.error
                        await _save_scheduled_shots()
                else:
                    # Preheat only mode - mark as completed
                    _scheduled_shots[schedule_id]["status"] = "completed"
                    await _save_scheduled_shots()
                    
            except asyncio.CancelledError:
                _scheduled_shots[schedule_id]["status"] = "cancelled"
                await _save_scheduled_shots()
            except Exception as e:
                logger.error(f"Scheduled shot {schedule_id} failed: {e}")
                _scheduled_shots[schedule_id]["status"] = "failed"
                _scheduled_shots[schedule_id]["error"] = str(e)
                await _save_scheduled_shots()
            finally:
                # Clean up task reference
                if schedule_id in _scheduled_tasks:
                    del _scheduled_tasks[schedule_id]
        
        # Start the background task
        task = asyncio.create_task(execute_scheduled_shot())
        _scheduled_tasks[schedule_id] = task
        
        return {
            "status": "success",
            "schedule_id": schedule_id,
            "scheduled_shot": scheduled_shot
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to schedule shot: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.delete("/api/machine/schedule-shot/{schedule_id}")
async def cancel_scheduled_shot(schedule_id: str, request: Request):
    """Cancel a scheduled shot."""
    request_id = request.state.request_id
    
    try:
        if schedule_id not in _scheduled_shots:
            raise HTTPException(
                status_code=404,
                detail="Scheduled shot not found"
            )
        
        # Cancel the task if it exists
        if schedule_id in _scheduled_tasks:
            _scheduled_tasks[schedule_id].cancel()
            del _scheduled_tasks[schedule_id]
        
        _scheduled_shots[schedule_id]["status"] = "cancelled"
        
        # Persist to disk
        await _save_scheduled_shots()
        
        logger.info(
            f"Cancelled scheduled shot: {schedule_id}",
            extra={"request_id": request_id, "schedule_id": schedule_id}
        )
        
        return {
            "status": "success",
            "message": "Scheduled shot cancelled",
            "schedule_id": schedule_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to cancel scheduled shot: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "schedule_id": schedule_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.get("/api/machine/scheduled-shots")
async def list_scheduled_shots(request: Request):
    """List all scheduled shots."""
    request_id = request.state.request_id
    
    try:
        # Clean up completed/cancelled shots older than 1 hour
        now = datetime.now(timezone.utc)
        to_remove = []
        for schedule_id, shot in _scheduled_shots.items():
            if shot["status"] in ["completed", "cancelled", "failed"]:
                created_at = datetime.fromisoformat(shot["created_at"].replace('Z', '+00:00'))
                if (now - created_at).total_seconds() > 3600:
                    to_remove.append(schedule_id)
        
        for schedule_id in to_remove:
            del _scheduled_shots[schedule_id]
        
        # Persist changes if any shots were removed
        if to_remove:
            await _save_scheduled_shots()
        
        return {
            "status": "success",
            "scheduled_shots": list(_scheduled_shots.values())
        }
        
    except Exception as e:
        logger.error(
            f"Failed to list scheduled shots: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


# ==============================================================================
# Recurring Schedule Endpoints
# ==============================================================================

@router.get("/api/machine/recurring-schedules")
async def list_recurring_schedules(request: Request):
    """List all recurring schedules."""
    request_id = request.state.request_id
    
    try:
        logger.debug("Listing recurring schedules", extra={"request_id": request_id})
        
        # Enrich schedules with next occurrence
        enriched_schedules = []
        for schedule_id, schedule in _recurring_schedules.items():
            schedule_copy = {**schedule, "id": schedule_id}
            next_time = _get_next_occurrence(schedule)
            if next_time:
                schedule_copy["next_occurrence"] = next_time.isoformat()
            enriched_schedules.append(schedule_copy)
        
        return {
            "status": "success",
            "recurring_schedules": enriched_schedules
        }
        
    except Exception as e:
        logger.error(f"Failed to list recurring schedules: {e}", exc_info=True, extra={"request_id": request_id})
        raise HTTPException(status_code=500, detail={"status": "error", "error": str(e)})


@router.post("/api/machine/recurring-schedules")
async def create_recurring_schedule(request: Request):
    """Create a new recurring schedule.
    
    Request body:
    - name: str - Display name for the schedule
    - time: str - Time in HH:MM format (24-hour)
    - recurrence_type: str - One of: 'daily', 'weekdays', 'weekends', 'interval', 'specific_days'
    - interval_days: int - For 'interval' type, number of days between runs (default: 1)
    - days_of_week: list[int] - For 'specific_days' type, list of day numbers (0=Monday, 6=Sunday)
    - profile_id: str | null - Profile to run (null for preheat only)
    - preheat: bool - Whether to preheat before the shot (default: true)
    - enabled: bool - Whether the schedule is active (default: true)
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        
        # Validate required fields
        time_str = body.get("time")
        if not time_str:
            raise HTTPException(status_code=400, detail="time is required (HH:MM format)")
        
        # Validate time format
        try:
            hour, minute = map(int, time_str.split(":"))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError("Invalid time")
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Invalid time format. Use HH:MM (24-hour)")
        
        recurrence_type = body.get("recurrence_type", "daily")
        valid_types = ["daily", "weekdays", "weekends", "interval", "specific_days"]
        if recurrence_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"recurrence_type must be one of: {valid_types}")
        
        # Validate type-specific fields
        if recurrence_type == "interval":
            interval_days = body.get("interval_days", 1)
            if not isinstance(interval_days, int) or interval_days < 1:
                raise HTTPException(status_code=400, detail="interval_days must be a positive integer")
        
        if recurrence_type == "specific_days":
            days_of_week = body.get("days_of_week", [])
            if not isinstance(days_of_week, list) or not all(isinstance(d, int) and 0 <= d <= 6 for d in days_of_week):
                raise HTTPException(status_code=400, detail="days_of_week must be a list of integers 0-6")
            if not days_of_week:
                raise HTTPException(status_code=400, detail="days_of_week cannot be empty for specific_days type")
        
        profile_id = body.get("profile_id")
        preheat = body.get("preheat", True)
        
        if not profile_id and not preheat:
            raise HTTPException(status_code=400, detail="Either profile_id or preheat must be provided")
        
        # Generate unique ID
        schedule_id = str(uuid.uuid4())
        
        # Create schedule object
        schedule = {
            "name": body.get("name", f"Schedule {time_str}"),
            "time": time_str,
            "recurrence_type": recurrence_type,
            "interval_days": body.get("interval_days", 1) if recurrence_type == "interval" else None,
            "days_of_week": body.get("days_of_week", []) if recurrence_type == "specific_days" else None,
            "profile_id": profile_id,
            "preheat": preheat,
            "enabled": body.get("enabled", True),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        _recurring_schedules[schedule_id] = schedule
        await _save_recurring_schedules()
        
        # Schedule the next occurrence immediately
        if schedule["enabled"]:
            await _schedule_next_recurring(schedule_id, schedule)
        
        logger.info(
            f"Created recurring schedule: {schedule_id}",
            extra={"request_id": request_id, "schedule": schedule}
        )
        
        next_time = _get_next_occurrence(schedule)
        
        return {
            "status": "success",
            "message": "Recurring schedule created",
            "schedule_id": schedule_id,
            "schedule": {**schedule, "id": schedule_id},
            "next_occurrence": next_time.isoformat() if next_time else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create recurring schedule: {e}", exc_info=True, extra={"request_id": request_id})
        raise HTTPException(status_code=500, detail={"status": "error", "error": str(e)})


@router.put("/api/machine/recurring-schedules/{schedule_id}")
async def update_recurring_schedule(schedule_id: str, request: Request):
    """Update an existing recurring schedule."""
    request_id = request.state.request_id
    
    try:
        if schedule_id not in _recurring_schedules:
            raise HTTPException(status_code=404, detail="Recurring schedule not found")
        
        body = await request.json()
        schedule = _recurring_schedules[schedule_id]
        
        # Update allowed fields
        if "name" in body:
            schedule["name"] = body["name"]
        if "time" in body:
            time_str = body["time"]
            try:
                hour, minute = map(int, time_str.split(":"))
                if not (0 <= hour <= 23 and 0 <= minute <= 59):
                    raise ValueError("Invalid time")
                schedule["time"] = time_str
            except (ValueError, AttributeError):
                raise HTTPException(status_code=400, detail="Invalid time format. Use HH:MM (24-hour)")
        if "recurrence_type" in body:
            valid_types = ["daily", "weekdays", "weekends", "interval", "specific_days"]
            if body["recurrence_type"] not in valid_types:
                raise HTTPException(status_code=400, detail=f"recurrence_type must be one of: {valid_types}")
            schedule["recurrence_type"] = body["recurrence_type"]
        if "interval_days" in body:
            schedule["interval_days"] = body["interval_days"]
        if "days_of_week" in body:
            schedule["days_of_week"] = body["days_of_week"]
        if "profile_id" in body:
            schedule["profile_id"] = body["profile_id"]
        if "preheat" in body:
            schedule["preheat"] = body["preheat"]
        if "enabled" in body:
            schedule["enabled"] = body["enabled"]
        
        schedule["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        await _save_recurring_schedules()
        
        # If enabled, ensure next occurrence is scheduled
        if schedule.get("enabled", True):
            await _schedule_next_recurring(schedule_id, schedule)
        
        logger.info(f"Updated recurring schedule: {schedule_id}", extra={"request_id": request_id})
        
        next_time = _get_next_occurrence(schedule)
        
        return {
            "status": "success",
            "message": "Recurring schedule updated",
            "schedule": {**schedule, "id": schedule_id},
            "next_occurrence": next_time.isoformat() if next_time else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update recurring schedule: {e}", exc_info=True, extra={"request_id": request_id})
        raise HTTPException(status_code=500, detail={"status": "error", "error": str(e)})


@router.delete("/api/machine/recurring-schedules/{schedule_id}")
async def delete_recurring_schedule(schedule_id: str, request: Request):
    """Delete a recurring schedule."""
    request_id = request.state.request_id
    
    try:
        if schedule_id not in _recurring_schedules:
            raise HTTPException(status_code=404, detail="Recurring schedule not found")
        
        # Cancel any pending shots for this schedule
        for shot_id, shot in list(_scheduled_shots.items()):
            if shot.get("recurring_schedule_id") == schedule_id and shot.get("status") == "scheduled":
                if shot_id in _scheduled_tasks:
                    _scheduled_tasks[shot_id].cancel()
                    del _scheduled_tasks[shot_id]
                _scheduled_shots[shot_id]["status"] = "cancelled"
        
        await _save_scheduled_shots()
        
        # Delete the recurring schedule
        del _recurring_schedules[schedule_id]
        await _save_recurring_schedules()
        
        logger.info(f"Deleted recurring schedule: {schedule_id}", extra={"request_id": request_id})
        
        return {
            "status": "success",
            "message": "Recurring schedule deleted",
            "schedule_id": schedule_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete recurring schedule: {e}", exc_info=True, extra={"request_id": request_id})
        raise HTTPException(status_code=500, detail={"status": "error", "error": str(e)})
