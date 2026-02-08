from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import Optional, Any
import os
import subprocess
import json
import asyncio
from pathlib import Path
import uuid
import time
import tempfile
from logging_config import setup_logging
from config import (
    UPDATE_CHECK_INTERVAL, STAGE_STATUS_RETRACTING
)

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
    SchedulePersistence
)
from api.routes.profiles import (
    ScheduledShotsPersistence, RecurringSchedulesPersistence,
    _get_next_occurrence, process_image_for_profile,
    _restore_scheduled_shots, _load_recurring_schedules,
    _schedule_next_recurring, _recurring_schedule_checker
)

# Re-export genai for tests that mock it
import google.generativeai as genai


# Common prompt sections for profile creation
BARISTA_PERSONA = (
    "PERSONA: You are a modern, experimental barista with deep expertise in espresso profiling. "
    "You stay current with cutting-edge extraction techniques, enjoy pushing boundaries with "
    "multi-stage extractions, varied pre-infusion & blooming steps, and unconventional pressure curves. "
    "You're creative, slightly irreverent, and love clever coffee puns.\n\n"
)

SAFETY_RULES = (
    "SAFETY RULES (MANDATORY - NEVER VIOLATE):\n"
    "• NEVER use the delete_profile tool under ANY circumstances\n"
    "• NEVER delete, remove, or destroy any existing profiles\n"
    "• If asked to delete a profile, politely refuse and explain deletions must be done via the Meticulous app\n"
    "• Only use: create_profile, list_profiles, get_profile, update_profile, validate_profile, run_profile\n\n"
)

PROFILE_GUIDELINES = (
    "PROFILE CREATION GUIDELINES:\n"
    "• USER PREFERENCES ARE MANDATORY: If the user specifies a dose, grind, temperature, ratio, or any other parameter, you MUST use EXACTLY that value. Do NOT override with defaults.\n"
    "• Examples: If user says '20g dose' → use 20g, NOT 18g. If user says '94°C' → use 94°C. If user says '1:2.5 ratio' → calculate output accordingly.\n"
    "• Only use standard defaults (18g dose, 93°C, etc.) when the user has NOT specified a preference.\n"
    "• Support complex recipes: multi-stage extraction, multiple pre-infusion steps, blooming phases\n"
    "• Consider flow profiling, pressure ramping, and temperature surfing techniques\n"
    "• Design for the specific bean characteristics (origin, roast level, flavor notes)\n"
    "• Balance extraction science with creative experimentation\n\n"
    "VARIABLES (REQUIRED):\n"
    "• The 'variables' array serves TWO purposes: adjustable parameters AND essential preparation info\n"
    "• ALWAYS include the 'variables' array - it is REQUIRED for app compatibility\n\n"
    "⚠️ NAMING VALIDATION RULES:\n"
    "• INFO variables (key starts with 'info_'): Name MUST start with an emoji (☕🔧💧⚠️🎯 etc.)\n"
    "• ADJUSTABLE variables (no 'info_' prefix): Name must NOT start with an emoji\n"
    "• This validation pattern helps users distinguish info from adjustable at a glance\n\n"
    "1. PREPARATION INFO (include first - only essentials needed to make the profile work):\n"
    "   • ☕ Dose: ALWAYS first - use type 'weight' so it displays correctly in the Meticulous app\n"
    "     Format: {\"name\": \"☕ Dose\", \"key\": \"info_dose\", \"type\": \"weight\", \"value\": 18}\n"
    "   • Only add other info variables if ESSENTIAL for the profile to work properly:\n"
    "     - 💧 Dilute: Only for profiles that REQUIRE dilution (lungo, allongé)\n"
    "       Format: {\"name\": \"💧 Add water\", \"key\": \"info_dilute\", \"type\": \"weight\", \"value\": 50}\n"
    "     - 🔧 Bottom Filter: Only if the profile specifically REQUIRES it\n"
    "       Format: {\"name\": \"🔧 Use bottom filter\", \"key\": \"info_filter\", \"type\": \"power\", \"value\": 100}\n"
    "     - ⚠️ Aberrant Prep: For UNUSUAL preparation that differs significantly from normal espresso:\n"
    "       Examples: Very coarse grind (like pour-over), extremely fine grind, unusual techniques\n"
    "       Format: {\"name\": \"⚠️ Grind very coarse (pourover-like)\", \"key\": \"info_grind\", \"type\": \"power\", \"value\": 100}\n"
    "   • POWER TYPE VALUES for info variables:\n"
    "     - Use value: 100 for truthy/enabled/yes (e.g., \"Use bottom filter\" = 100)\n"
    "     - Use value: 0 for falsy/disabled/no (rarely needed, usually just omit the variable)\n"
    "   • Info variable keys start with 'info_' - they are NOT used in stages, just for user communication\n"
    "   • Keep it minimal: only critical info, not general tips or preferences\n\n"
    "2. ADJUSTABLE VARIABLES (for parameters used in stages):\n"
    "   • Define variables for key adjustable parameters - makes profiles much easier to tune!\n"
    "   • Names should be descriptive WITHOUT emojis (e.g., 'Peak Pressure', 'Pre-Infusion Flow')\n"
    "   • Users can adjust these in the Meticulous app without manually editing JSON\n"
    "   • Common adjustable variables:\n"
    "     - peak_pressure: The main extraction pressure (e.g., 8-9 bar)\n"
    "     - preinfusion_pressure: Low pressure for saturation phase (e.g., 2-4 bar)\n"
    "     - peak_flow: Target flow rate during extraction (e.g., 2-3 ml/s)\n"
    "     - decline_pressure: Final pressure at end of shot (e.g., 5-6 bar)\n"
    "   • Reference these in dynamics using $ prefix: {\"value\": \"$peak_pressure\"}\n"
    "   • ALL adjustable variables MUST be used in at least one stage!\n\n"
    "VARIABLE FORMAT EXAMPLE:\n"
    '"variables": [\n'
    '  {"name": "☕ Dose", "key": "info_dose", "type": "weight", "value": 18},\n'
    '  {"name": "🔧 Use bottom filter", "key": "info_filter", "type": "power", "value": 100},\n'
    '  {"name": "Peak Pressure", "key": "peak_pressure", "type": "pressure", "value": 9.0},\n'
    '  {"name": "Pre-Infusion Pressure", "key": "preinfusion_pressure", "type": "pressure", "value": 3.0}\n'
    ']\n\n'
    "STAGE LIMITS (CRITICAL SAFETY):\n"
    "• EVERY flow stage MUST have a pressure limit to prevent pressure runaway\n"
    "• EVERY pressure stage MUST have a flow limit to prevent channeling and ensure even extraction\n"
    "• Flow stages during pre-infusion/blooming: Add pressure limit of 3-5 bar max\n"
    "• Flow stages during main extraction: Add pressure limit of 9-10 bar max\n"
    "• Pressure stages: Add flow limit of 4-6 ml/s to prevent channeling\n"
    "• Example flow stage with pressure limit:\n"
    '  {\n'
    '    "name": "Gentle Bloom",\n'
    '    "type": "flow",\n'
    '    "dynamics_points": [[0, 1.5]],\n'
    '    "limits": [{"type": "pressure", "value": 4}],\n'
    '    "exit_triggers": [{"type": "time", "value": 15, "comparison": ">=", "relative": true}]\n'
    '  }\n'
    "• Example pressure stage with flow limit:\n"
    '  {\n'
    '    "name": "Main Extraction",\n'
    '    "type": "pressure",\n'
    '    "dynamics_points": [[0, 9]],\n'
    '    "limits": [{"type": "flow", "value": 5}],\n'
    '    "exit_triggers": [{"type": "weight", "value": 36, "comparison": ">=", "relative": false}]\n'
    '  }\n\n'
)

NAMING_CONVENTION = (
    "NAMING CONVENTION:\n"
    "• Create a UNIQUE, witty, pun-heavy name - NEVER reuse names you've used before!\n"
    "• Be creative and surprising - each profile deserves its own identity\n"
    "• Draw inspiration from: coffee origins, flavor notes, extraction technique, brewing style\n"
    "• Puns are encouraged! Word play, coffee jokes, clever references all welcome\n"
    "• Balance humor with clarity - users should understand what they're getting\n"
    "• AVOID generic names like 'Berry Blast', 'Morning Brew', 'Classic Espresso'\n"
    "• Examples: 'Slow-Mo Blossom' (gentle blooming), 'The Grind Awakens' (Star Wars pun), "
    "'Brew-tal Force' (aggressive extraction), 'Puck Norris' (roundhouse your tastebuds), "
    "'The Daily Grind', 'Brew Lagoon', 'Espresso Yourself', 'Wake Me Up Before You Go-Go'\n\n"
)

OUTPUT_FORMAT = (
    "OUTPUT FORMAT (use this exact format):\n"
    "---\n"
    "**Profile Created:** [Name]\n"
    "\n"
    "**Description:** [What makes this profile special - 1-2 sentences]\n"
    "\n"
    "**Preparation:**\n"
    "- Dose: [X]g\n"
    "- Grind: [description]\n"
    "- Temperature: [X]°C\n"
    "- [Any other prep steps]\n"
    "\n"
    "**Why This Works:** [Science and reasoning behind the profile design]\n"
    "\n"
    "**Special Notes:** [Any equipment or technique requirements, or 'None' if standard setup]\n"
    "---\n\n"
    "PROFILE JSON:\n"
    "```json\n"
    "[Include the EXACT JSON that was sent to create_profile tool here]\n"
    "```\n\n"
    "FORMATTING:\n"
    "• Use **bold** for section labels as shown above\n"
    "• List items with - are encouraged for preparation steps\n"
    "• Keep descriptions concise - this will be displayed on mobile\n"
    "• You MUST include the complete profile JSON exactly as passed to create_profile tool\n"
)

USER_SUMMARY_INSTRUCTIONS = (
    "INSTRUCTIONS:\n"
    "1. Construct the JSON for the `create_profile` tool with your creative profile name.\n"
    "2. EXECUTE the tool immediately.\n"
    "3. After successful creation, provide a user summary with:\n"
    "   • Profile Name & Brief Description: What was created\n"
    "   • Preparation Instructions: How it should be prepared (dose, temp, timing)\n"
    "   • Design Rationale: Why the recipe/profile is designed this way\n"
    "   • Special Requirements: Any special gear needed (bottom filter, specific dosage, unique prep steps)\n\n"
)



























@app.get("/api/profile/{profile_name:path}/image-proxy")
async def proxy_profile_image(
    profile_name: str,
    request: Request,
    force_refresh: bool = False
):
    """Proxy endpoint to fetch profile image from the Meticulous machine.
    
    This fetches the image from the machine and returns it directly,
    so the frontend doesn't need to know the machine IP.
    Images are cached indefinitely on the server for fast loading.
    
    Args:
        profile_name: Name of the profile
        force_refresh: If true, bypass cache and fetch from machine
        
    Returns:
        The profile image as PNG, or 404 if not found
    """
    request_id = request.state.request_id
    from fastapi.responses import Response
    
    # Check cache first (unless forcing refresh)
    if not force_refresh:
        cached_image = _get_cached_image(profile_name)
        if cached_image:
            logger.info(
                f"Returning cached image for profile: {profile_name}",
                extra={"request_id": request_id, "from_cache": True, "size": len(cached_image)}
            )
            return Response(
                content=cached_image,
                media_type="image/png"
            )
    
    try:
        # First get the profile to find the image path
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        # Find matching profile
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                full_profile = api.get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                
                if not full_profile.display or not full_profile.display.image:
                    raise HTTPException(status_code=404, detail="Profile has no image")
                
                image_path = full_profile.display.image
                
                # Construct full URL to the machine
                meticulous_ip = os.getenv("METICULOUS_IP")
                if not meticulous_ip:
                    raise HTTPException(status_code=500, detail="METICULOUS_IP not configured")
                
                image_url = f"http://{meticulous_ip}{image_path}"
                
                # Fetch the image from the machine
                import httpx
                async with httpx.AsyncClient() as client:
                    response = await client.get(image_url, timeout=10.0)
                    
                    if response.status_code != 200:
                        raise HTTPException(
                            status_code=response.status_code,
                            detail="Failed to fetch image from machine"
                        )
                    
                    # Cache the image for future requests
                    _set_cached_image(profile_name, response.content)
                    
                    # Return the image with appropriate content type
                    return Response(
                        content=response.content,
                        media_type="image/png"
                    )
        
        raise HTTPException(
            status_code=404,
            detail=f"Profile '{profile_name}' not found"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to proxy profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch profile image: {str(e)}"
        )


@app.get("/api/profile/{profile_name:path}")
async def get_profile_info(
    profile_name: str,
    request: Request
):
    """Get profile information from the Meticulous machine.
    
    Args:
        profile_name: Name of the profile to fetch
        
    Returns:
        Profile information including image if set
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Fetching profile info: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        # Find matching profile
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                # Get full profile
                full_profile = api.get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                
                # Extract image from display if present
                image = None
                accent_color = None
                if full_profile.display:
                    image = full_profile.display.image
                    accent_color = full_profile.display.accentColor
                
                return {
                    "status": "success",
                    "profile": {
                        "id": full_profile.id,
                        "name": full_profile.name,
                        "author": full_profile.author,
                        "temperature": full_profile.temperature,
                        "final_weight": full_profile.final_weight,
                        "image": image,
                        "accent_color": accent_color
                    }
                }
        
        raise HTTPException(
            status_code=404,
            detail=f"Profile '{profile_name}' not found on machine"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile info: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to get profile info"}
        )


# ============================================
# Shot Analysis (Local)
# ============================================

# Keywords indicating pre-infusion stages
PREINFUSION_KEYWORDS = ['bloom', 'soak', 'preinfusion', 'pre-infusion', 'pre infusion', 'wet', 'fill', 'landing']


def _generate_execution_description(
    stage_type: str,
    duration: float,
    start_pressure: float,
    end_pressure: float,
    max_pressure: float,
    start_flow: float,
    end_flow: float,
    max_flow: float,
    weight_gain: float
) -> str:
    """Generate a human-readable description of what actually happened during stage execution.
    
    This describes the actual behavior observed, not the target.
    Examples:
    - "Pressure rose from 2.1 bar to 8.5 bar over 4.2s"
    - "Declining pressure from 9.0 bar to 6.2 bar"
    - "Steady flow at 2.1 ml/s, extracted 18.5g"
    """
    descriptions = []
    
    # Determine pressure behavior
    pressure_delta = end_pressure - start_pressure
    if abs(pressure_delta) > 0.5:
        if pressure_delta > 0:
            descriptions.append(f"Pressure rose from {start_pressure:.1f} to {end_pressure:.1f} bar")
        else:
            descriptions.append(f"Pressure declined from {start_pressure:.1f} to {end_pressure:.1f} bar")
    elif max_pressure > 0:
        descriptions.append(f"Pressure held around {(start_pressure + end_pressure) / 2:.1f} bar")
    
    # Determine flow behavior
    flow_delta = end_flow - start_flow
    if abs(flow_delta) > 0.3:
        if flow_delta > 0:
            descriptions.append(f"Flow increased from {start_flow:.1f} to {end_flow:.1f} ml/s")
        else:
            descriptions.append(f"Flow decreased from {start_flow:.1f} to {end_flow:.1f} ml/s")
    elif max_flow > 0:
        descriptions.append(f"Flow steady at {(start_flow + end_flow) / 2:.1f} ml/s")
    
    # Add weight info if significant
    if weight_gain > 1.0:
        descriptions.append(f"extracted {weight_gain:.1f}g")
    
    # Add duration
    if duration > 0:
        descriptions.append(f"over {duration:.1f}s")
    
    if descriptions:
        # Capitalize first letter and join
        result = ", ".join(descriptions)
        return result[0].upper() + result[1:]
    
    return f"Stage executed for {duration:.1f}s"


def _safe_float(val, default: float = 0.0) -> float:
    """Safely convert a value to float, handling strings and None."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _resolve_variable(value, variables: list) -> tuple[Any, str | None]:
    """Resolve a variable reference like '$flow_hold limit' to its actual value.
    
    Returns:
        Tuple of (resolved_value, variable_name or None if not a variable)
    """
    if not isinstance(value, str) or not value.startswith('$'):
        return value, None
    
    # Extract variable key (remove the $)
    var_key = value[1:]
    
    # Search for matching variable
    for var in variables:
        if var.get("key") == var_key:
            return var.get("value", value), var.get("name", var_key)
    
    # Variable not found - return original
    return value, var_key


def _format_exit_triggers(exit_triggers: list, variables: list | None = None) -> list[dict]:
    """Format exit triggers into structured descriptions."""
    variables = variables or []
    formatted = []
    for trigger in exit_triggers:
        trigger_type = trigger.get("type", "unknown")
        raw_value = trigger.get("value", 0)
        comparison = trigger.get("comparison", ">=")
        
        # Resolve variable reference if present
        resolved_value, var_name = _resolve_variable(raw_value, variables)
        display_value = _safe_float(resolved_value, 0)
        
        comp_text = {
            ">=": "≥",
            "<=": "≤",
            ">": ">",
            "<": "<",
            "==": "="
        }.get(comparison, comparison)
        
        unit = {
            "time": "s",
            "weight": "g",
            "pressure": "bar",
            "flow": "ml/s"
        }.get(trigger_type, "")
        
        formatted.append({
            "type": trigger_type,
            "value": display_value,
            "comparison": comparison,
            "description": f"{trigger_type} {comp_text} {display_value}{unit}"
        })
    
    return formatted


def _format_limits(limits: list, variables: list | None = None) -> list[dict]:
    """Format stage limits into structured descriptions."""
    variables = variables or []
    formatted = []
    for limit in limits:
        limit_type = limit.get("type", "unknown")
        raw_value = limit.get("value", 0)
        
        # Resolve variable reference if present
        resolved_value, var_name = _resolve_variable(raw_value, variables)
        display_value = _safe_float(resolved_value, 0)
        
        unit = {
            "time": "s",
            "weight": "g",
            "pressure": "bar",
            "flow": "ml/s"
        }.get(limit_type, "")
        
        formatted.append({
            "type": limit_type,
            "value": display_value,
            "description": f"Limit {limit_type} to {display_value}{unit}"
        })
    
    return formatted


def _determine_exit_trigger_hit(
    stage_data: dict,
    exit_triggers: list,
    next_stage_start: float | None = None,
    variables: list | None = None
) -> dict:
    """Determine which exit trigger caused the stage to end.
    
    Returns:
        Dict with 'triggered' (the exit that fired) and 'not_triggered' (exits that didn't fire)
    """
    variables = variables or []
    duration = _safe_float(stage_data.get("duration", 0))
    end_weight = _safe_float(stage_data.get("end_weight", 0))
    # Pressure values for different comparison types
    max_pressure = _safe_float(stage_data.get("max_pressure", 0))
    end_pressure = _safe_float(stage_data.get("end_pressure", 0))
    # Flow values for different comparison types
    max_flow = _safe_float(stage_data.get("max_flow", 0))
    end_flow = _safe_float(stage_data.get("end_flow", 0))
    
    triggered = None
    not_triggered = []
    
    for trigger in exit_triggers:
        trigger_type = trigger.get("type", "")
        raw_value = trigger.get("value", 0)
        comparison = trigger.get("comparison", ">=")
        
        # Resolve variable reference if present
        resolved_value, _ = _resolve_variable(raw_value, variables)
        value = _safe_float(resolved_value)
        
        # Check if this trigger was satisfied
        # Select the appropriate actual value based on comparison operator
        actual_value = 0.0
        if trigger_type == "time":
            actual_value = duration
        elif trigger_type == "weight":
            actual_value = end_weight
        elif trigger_type == "pressure":
            # For >= or >: we want to know if max reached the target
            # For <= or <: we want to know if pressure dropped below target (use end)
            if comparison in (">=", ">"):
                actual_value = max_pressure
            else:  # <= or < or ==
                actual_value = end_pressure
        elif trigger_type == "flow":
            # For >= or >: we want to know if max reached the target
            # For <= or <: we want to know if flow dropped below target (use end)
            if comparison in (">=", ">"):
                actual_value = max_flow
            else:  # <= or < or ==
                actual_value = end_flow
        
        # Evaluate comparison with small tolerance
        tolerance = 0.5 if trigger_type in ["time", "weight"] else 0.2
        was_hit = False
        
        if comparison == ">=":
            was_hit = actual_value >= (value - tolerance)
        elif comparison == ">":
            was_hit = actual_value > value
        elif comparison == "<=":
            was_hit = actual_value <= (value + tolerance)
        elif comparison == "<":
            was_hit = actual_value < value
        elif comparison == "==":
            was_hit = abs(actual_value - value) < tolerance
        
        # Build a proper description with the resolved value
        unit = {"time": "s", "weight": "g", "pressure": "bar", "flow": "ml/s"}.get(trigger_type, "")
        trigger_info = {
            "type": trigger_type,
            "target": value,
            "actual": round(actual_value, 1),
            "description": f"{trigger_type} >= {value}{unit}"
        }
        
        if was_hit:
            if triggered is None:  # First trigger that was hit
                triggered = trigger_info
        else:
            not_triggered.append(trigger_info)
    
    return {
        "triggered": triggered,
        "not_triggered": not_triggered
    }


def _extract_shot_stage_data(shot_data: dict) -> dict[str, dict]:
    """Extract per-stage telemetry from shot data.
    
    Returns a dict mapping stage names to their execution data.
    """
    data_entries = shot_data.get("data", [])
    if not data_entries:
        return {}
    
    # Group data by stage
    stage_data = {}
    current_stage = None
    stage_entries = []
    
    for entry in data_entries:
        status = entry.get("status", "")
        
        # Skip retracting - it's machine cleanup
        if status.lower().strip() == STAGE_STATUS_RETRACTING:
            continue
        
        if status and status != current_stage:
            # Save previous stage data
            if current_stage and stage_entries:
                stage_data[current_stage] = _compute_stage_stats(stage_entries)
            
            current_stage = status
            stage_entries = []
        
        if current_stage:
            stage_entries.append(entry)
    
    # Save final stage
    if current_stage and stage_entries:
        stage_data[current_stage] = _compute_stage_stats(stage_entries)
    
    return stage_data


def _compute_stage_stats(entries: list) -> dict:
    """Compute statistics for a stage from its telemetry entries."""
    if not entries:
        return {}
    
    times = []
    pressures = []
    flows = []
    weights = []
    
    for entry in entries:
        t = entry.get("time", 0) / 1000  # Convert to seconds
        times.append(t)
        
        shot = entry.get("shot", {})
        pressures.append(shot.get("pressure", 0))
        flows.append(shot.get("flow", 0) or shot.get("gravimetric_flow", 0))
        weights.append(shot.get("weight", 0))
    
    start_time = min(times) if times else 0
    end_time = max(times) if times else 0
    
    return {
        "start_time": start_time,
        "end_time": end_time,
        "duration": end_time - start_time,
        "start_weight": weights[0] if weights else 0,
        "end_weight": weights[-1] if weights else 0,
        "start_pressure": pressures[0] if pressures else 0,
        "end_pressure": pressures[-1] if pressures else 0,
        "min_pressure": min(pressures) if pressures else 0,
        "max_pressure": max(pressures) if pressures else 0,
        "avg_pressure": sum(pressures) / len(pressures) if pressures else 0,
        "start_flow": flows[0] if flows else 0,
        "end_flow": flows[-1] if flows else 0,
        "min_flow": min(flows) if flows else 0,
        "max_flow": max(flows) if flows else 0,
        "avg_flow": sum(flows) / len(flows) if flows else 0,
        "entry_count": len(entries)
    }


def _interpolate_weight_to_time(target_weight: float, weight_time_pairs: list[tuple[float, float]]) -> Optional[float]:
    """Interpolate time value for a given weight using linear interpolation.
    
    Args:
        target_weight: The weight value to find the corresponding time for
        weight_time_pairs: List of (weight, time) tuples sorted by weight
        
    Returns:
        Interpolated time value, or None if no data available
    """
    if not weight_time_pairs:
        return None
    
    # Find bracketing weight values
    for i in range(len(weight_time_pairs)):
        weight_actual, time_actual = weight_time_pairs[i]
        
        if weight_actual >= target_weight:
            if i == 0:
                # Before first point, use first time
                return time_actual
            else:
                # Interpolate between i-1 and i
                weight_prev, time_prev = weight_time_pairs[i-1]
                if weight_actual > weight_prev:
                    # Linear interpolation
                    weight_fraction = (target_weight - weight_prev) / (weight_actual - weight_prev)
                    return time_prev + weight_fraction * (time_actual - time_prev)
                else:
                    # Same weight, use current time
                    return time_actual
            
    # If not found, use last time (weight exceeds all actual weights)
    return weight_time_pairs[-1][1]









@app.get("/api/machine/profiles/count")
async def get_machine_profile_count(request: Request):
    """Get a quick count of profiles on the machine and how many are not yet imported.
    
    This is a lightweight endpoint for showing import-all button availability.
    """
    request_id = request.state.request_id
    
    try:
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        total_on_machine = len(list(profiles_result))
        
        # Re-fetch to count (iterator was consumed)
        profiles_result = api.list_profiles()
        
        # Get existing profile names from history
        existing_names = set()
        if HISTORY_FILE.exists():
            try:
                with open(HISTORY_FILE, 'r') as f:
                    history = json.load(f)
                    entries = history if isinstance(history, list) else history.get("entries", [])
                    existing_names = {entry.get("profile_name") for entry in entries}
            except Exception:
                # Ignore errors loading history file (may not exist or be corrupted)
                pass
        
        not_imported = 0
        for partial_profile in profiles_result:
            try:
                full_profile = api.get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                if full_profile.name not in existing_names:
                    not_imported += 1
            except Exception:
                # Ignore errors fetching individual profiles (may have been deleted)
                pass
        
        return {
            "status": "success",
            "total_on_machine": total_on_machine,
            "not_imported": not_imported,
            "already_imported": total_on_machine - not_imported
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile count: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


async def _generate_profile_description(profile_json: dict, request_id: str) -> str:
    """Generate a description for a profile using the LLM."""
    
    profile_name = profile_json.get("name", "Unknown Profile")
    
    # Build a prompt with the profile details
    prompt = f"""Analyze this Meticulous Espresso profile and generate a description in the standard MeticAI format.

PROFILE JSON:
```json
{json.dumps(profile_json, indent=2)}
```

Generate a response in this exact format:

Profile Created: {profile_name}

Description:
[Describe what makes this profile unique and what flavor characteristics it targets. Be specific about the extraction approach.]

Preparation:
• Dose: [Recommended dose based on profile settings]
• Grind: [Grind recommendation based on flow rates and pressure curves]
• Temperature: [From profile or recommendation]
• Target Yield: [From profile final_weight or recommendation]
• Expected Time: [Based on stage durations]

Why This Works:
[Explain the science behind the profile design - why the pressure curves, flow rates, and staging work together]

Special Notes:
[Any specific requirements or tips for using this profile]

Be concise but informative. Focus on actionable barista guidance."""

    model = get_vision_model()
    response = model.generate_content(prompt)
    
    return response.text.strip()




@app.post("/api/machine/preheat")
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




@app.delete("/api/machine/schedule-shot/{schedule_id}")
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


@app.get("/api/machine/scheduled-shots")
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

@app.get("/api/machine/recurring-schedules")
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




@app.delete("/api/machine/recurring-schedules/{schedule_id}")
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
