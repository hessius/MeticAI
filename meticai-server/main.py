from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import subprocess
import asyncio
from pathlib import Path
import uuid
import time
import tempfile
from logging_config import setup_logging
from config import UPDATE_CHECK_INTERVAL

# Initialize logging system with environment-aware defaults
log_dir = os.environ.get("LOG_DIR", "/app/logs")
try:
    logger = setup_logging(log_dir=log_dir)
except (PermissionError, OSError) as e:
    # Fallback to temp directory for testing
    log_dir = tempfile.mkdtemp()
    logger = setup_logging(log_dir=log_dir)
    logger.warning(
        f"Failed to create log directory at {os.environ.get('LOG_DIR', '/app/logs')}, "
        f"using temporary directory: {log_dir}",
        extra={"original_error": str(e)}
    )
from datetime import datetime, timezone
async def check_for_updates_task():
    """Background task to check for updates by running update.sh --check-only."""
    script_path = Path("/app/update.sh")
    
    if not script_path.exists():
        logger.warning("Update script not found at /app/update.sh - skipping update check")
        return
    
    try:
        logger.info("Running scheduled update check...")
        # Run update script with --check-only flag
        # Use asyncio.to_thread to avoid blocking the event loop
        result = await asyncio.to_thread(
            subprocess.run,
            ["bash", str(script_path), "--check-only"],
            capture_output=True,
            text=True,
            cwd="/app",
            timeout=120  # 2 minutes timeout for check
        )
        
        if result.returncode == 0:
            logger.info("Update check completed successfully")
        else:
            logger.warning(f"Update check returned non-zero exit code: {result.returncode}")
            if result.stderr:
                logger.warning(f"stderr: {result.stderr}")
                
    except subprocess.TimeoutExpired:
        logger.error("Update check timed out after 2 minutes")
    except Exception as e:
        logger.error(f"Error running update check: {e}")


async def periodic_update_checker():
    """Periodically check for updates in the background."""
    # Initial check on startup (with small delay to let app fully start)
    await asyncio.sleep(10)
    await check_for_updates_task()
    
    # Then check periodically
    while True:
        await asyncio.sleep(UPDATE_CHECK_INTERVAL)
        await check_for_updates_task()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - start background tasks on startup."""
    # Start the periodic update checker
    logger.info("Starting periodic update checker (runs on startup and every 24 hours)")
    update_task = asyncio.create_task(periodic_update_checker())
    
    # Restore scheduled shots from persistence
    logger.info("Restoring scheduled shots from persistence")
    await _restore_scheduled_shots()
    
    # Load recurring schedules and schedule next occurrences
    logger.info("Loading recurring schedules from persistence")
    await _load_recurring_schedules()
    for schedule_id, schedule in _recurring_schedules.items():
        if schedule.get("enabled", True):
            await _schedule_next_recurring(schedule_id, schedule)
    
    # Start recurring schedule checker (runs every hour to ensure schedules stay current)
    recurring_task = asyncio.create_task(_recurring_schedule_checker())
    
    yield
    
    # Cleanup on shutdown
    update_task.cancel()
    recurring_task.cancel()
    try:
        await update_task
    except asyncio.CancelledError:
        logger.info("Periodic update checker stopped")
    
    try:
        await recurring_task
    except asyncio.CancelledError:
        logger.info("Recurring schedule checker stopped")
    
    # Cancel all scheduled shot tasks
    for task in _scheduled_tasks.values():
        task.cancel()
    
    # Wait for all tasks to complete
    if _scheduled_tasks:
        await asyncio.gather(*_scheduled_tasks.values(), return_exceptions=True)
        logger.info("All scheduled shot tasks cancelled")


app = FastAPI(lifespan=lifespan)

# Import route modules
from api.routes import coffee, system, history, shots, profiles, scheduling

# Middleware for request logging and tracking
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all requests with context and timing."""
    request_id = str(uuid.uuid4())
    start_time = time.time()
    
    # Extract request metadata
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    
    # Log incoming request
    logger.info(
        f"Incoming request: {request.method} {request.url.path}",
        extra={
            "request_id": request_id,
            "endpoint": request.url.path,
            "method": request.method,
            "client_ip": client_ip,
            "user_agent": user_agent
        }
    )
    
    # Store request_id in request state for use in endpoints
    request.state.request_id = request_id
    
    try:
        response = await call_next(request)
        
        # Calculate duration
        duration_ms = int((time.time() - start_time) * 1000)
        
        # Log response
        logger.info(
            f"Request completed: {request.method} {request.url.path} - {response.status_code}",
            extra={
                "request_id": request_id,
                "endpoint": request.url.path,
                "method": request.method,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "client_ip": client_ip,
                "user_agent": user_agent
            }
        )
        
        return response
    except Exception as e:
        # Calculate duration even for errors
        duration_ms = int((time.time() - start_time) * 1000)
        
        # Log error with full context
        logger.error(
            f"Request failed: {request.method} {request.url.path} - {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "endpoint": request.url.path,
                "method": request.method,
                "client_ip": client_ip,
                "user_agent": user_agent,
                "duration_ms": duration_ms,
                "error_type": type(e).__name__
            }
        )
        
        # Re-raise to let FastAPI handle it
        raise

# Configure CORS middleware to allow web app interactions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(coffee.router)
app.include_router(system.router)
app.include_router(history.router)
app.include_router(shots.router)
app.include_router(profiles.router)
app.include_router(scheduling.router)


# ============================================================================
# Backward Compatibility Re-exports
# ============================================================================
# These re-exports allow existing tests and code to import from 'main' 
# even though the functions have been moved to service modules.
# TODO: Update tests to import from the new locations and remove these.

from config import DATA_DIR, MAX_UPLOAD_SIZE, TEST_MODE
from utils.file_utils import atomic_write_json, deep_convert_to_dict
from utils.sanitization import sanitize_profile_name_for_filename as _sanitize_profile_name_for_filename
from services.gemini_service import parse_gemini_error, get_vision_model
from services.meticulous_service import get_meticulous_api, decompress_shot_data
from services.cache_service import (
    get_cached_llm_analysis, save_llm_analysis_to_cache
)
from services.settings_service import (
    ensure_settings_file as _ensure_settings_file, 
    load_settings as _load_settings, 
    SETTINGS_FILE
)
from services.scheduling_state import (
    _scheduled_shots, _scheduled_tasks, _recurring_schedules,
    SchedulePersistence, ScheduledShotsPersistence, RecurringSchedulesPersistence,
    get_next_occurrence as _get_next_occurrence,
    restore_scheduled_shots as _restore_scheduled_shots,
    load_recurring_schedules as _load_recurring_schedules,
    PREHEAT_DURATION_MINUTES,
)
from api.routes.profiles import (
    process_image_for_profile,
    _schedule_next_recurring, _recurring_schedule_checker
)

# Re-export genai for tests that mock it
import google.generativeai as genai

