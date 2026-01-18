from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from typing import Optional
import google.generativeai as genai
from PIL import Image
import io
import os
import subprocess
import json
import asyncio
import logging
from pathlib import Path
import uuid
import time
from logging_config import setup_logging, get_logger

# Initialize logging system with environment-aware defaults
log_dir = os.environ.get("LOG_DIR", "/app/logs")
try:
    logger = setup_logging(log_dir=log_dir)
except (PermissionError, OSError) as e:
    # Fallback to temp directory for testing
    import tempfile
    log_dir = tempfile.mkdtemp()
    logger = setup_logging(log_dir=log_dir)
    logger.warning(
        f"Failed to create log directory at {os.environ.get('LOG_DIR', '/app/logs')}, "
        f"using temporary directory: {log_dir}",
        extra={"original_error": str(e)}
    )
from datetime import datetime, timezone

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Update check interval: 2 hours in seconds
UPDATE_CHECK_INTERVAL = 7200


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
    
    yield
    
    # Cleanup on shutdown
    update_task.cancel()
    try:
        await update_task
    except asyncio.CancelledError:
        logger.info("Periodic update checker stopped")


app = FastAPI(lifespan=lifespan)

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

# 1. Setup "The Eye" - lazily initialized
_vision_model = None

def get_vision_model():
    """Lazily initialize and return the vision model."""
    global _vision_model
    if _vision_model is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY environment variable is required but not set. "
                "Please set it before starting the server."
            )
        genai.configure(api_key=api_key)
        _vision_model = genai.GenerativeModel('gemini-2.0-flash')
    return _vision_model

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
    "• Support complex recipes: multi-stage extraction, multiple pre-infusion steps, blooming phases\n"
    "• Consider flow profiling, pressure ramping, and temperature surfing techniques\n"
    "• Design for the specific bean characteristics (origin, roast level, flavor notes)\n"
    "• Balance extraction science with creative experimentation\n\n"
)

NAMING_CONVENTION = (
    "NAMING CONVENTION:\n"
    "• Create a witty, pun-heavy name that's creative yet clear about the profile specifics\n"
    "• Balance humor with clarity - users should understand what they're getting\n"
    "• Examples: 'Slow-Mo Blossom' (gentle blooming profile), 'Pressure Point' (aggressive ramp), "
    "'The Gusher' (high flow), 'Espresso Yourself' (expressive profile)\n\n"
)

OUTPUT_FORMAT = (
    "OUTPUT FORMAT:\n"
    "Profile Created: [Name]\n"
    "Description: [What makes this profile special]\n"
    "Preparation: [Dose, grind, temp, and any pre-shot steps]\n"
    "Why This Works: [Science and reasoning behind the profile design]\n"
    "Special Notes: [Any equipment or technique requirements, or 'None' if standard setup]\n\n"
    "PROFILE JSON:\n"
    "```json\n"
    "[Include the EXACT JSON that was sent to create_profile tool here, formatted as valid JSON]\n"
    "```\n\n"
    "IMPORTANT: You MUST include the complete profile JSON above exactly as it was passed to the create_profile tool. "
    "This allows users to download and share their profiles."
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

@app.post("/analyze_coffee")
async def analyze_coffee(request: Request, file: UploadFile = File(...)):
    """Phase 1: Look at the bag."""
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Starting coffee analysis",
            extra={
                "request_id": request_id,
                "endpoint": "/analyze_coffee",
                "upload_filename": file.filename,
                "content_type": file.content_type
            }
        )
        
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        logger.debug(
            "Image loaded successfully",
            extra={
                "request_id": request_id,
                "image_size": f"{image.width}x{image.height}",
                "image_format": image.format
            }
        )
        
        response = get_vision_model().generate_content([
            "Analyze this coffee bag. Extract: Roaster, Origin, Roast Level, and Flavor Notes. "
            "Return ONLY a single concise sentence describing the coffee.", 
            image
        ])
        
        analysis = response.text.strip()
        
        logger.info(
            "Coffee analysis completed successfully",
            extra={
                "request_id": request_id,
                "analysis_preview": analysis[:100] if len(analysis) > 100 else analysis
            }
        )
        
        return {"analysis": analysis}
    except Exception as e:
        logger.error(
            f"Coffee analysis failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "endpoint": "/analyze_coffee",
                "error_type": type(e).__name__,
                "upload_filename": file.filename if file else None
            }
        )
        return {"error": str(e)}

@app.post("/analyze_and_profile")
async def analyze_and_profile(
    request: Request,
    file: Optional[UploadFile] = File(None),
    user_prefs: Optional[str] = Form(None)
):
    """Unified endpoint: Analyze coffee bag and generate profile in a single LLM pass.
    
    Requires at least one of:
    - file: Image of the coffee bag
    - user_prefs: User preferences or specific instructions
    """
    request_id = request.state.request_id
    
    # Validate that at least one input is provided
    if not file and not user_prefs:
        logger.warning(
            "Request missing both file and user preferences",
            extra={
                "request_id": request_id,
                "endpoint": "/analyze_and_profile"
            }
        )
        raise HTTPException(
            status_code=400,
            detail="At least one of 'file' (image) or 'user_prefs' (preferences) must be provided"
        )
    
    coffee_analysis = None
    
    try:
        logger.info(
            "Starting profile creation",
            extra={
                "request_id": request_id,
                "endpoint": "/analyze_and_profile",
                "has_image": file is not None,
                "has_preferences": user_prefs is not None,
                "upload_filename": file.filename if file else None,
                "preferences_preview": user_prefs[:100] if user_prefs and len(user_prefs) > 100 else user_prefs
            }
        )
        
        # If image is provided, analyze it first
        if file:
            logger.debug("Reading and analyzing image", extra={"request_id": request_id})
            contents = await file.read()
            image = Image.open(io.BytesIO(contents))
            
            # Analyze the coffee bag
            analysis_response = get_vision_model().generate_content([
                "Analyze this coffee bag. Extract: Roaster, Origin, Roast Level, and Flavor Notes. "
                "Return ONLY a single concise sentence describing the coffee.", 
                image
            ])
            coffee_analysis = analysis_response.text.strip()
            
            logger.info(
                "Coffee analysis completed",
                extra={
                    "request_id": request_id,
                    "analysis": coffee_analysis
                }
            )
        
        # Construct the profile creation prompt
        if coffee_analysis and user_prefs:
            # Both image and preferences provided
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n"
                f"Coffee Analysis: '{coffee_analysis}'\n"
                f"User Preferences: '{user_prefs}'\n\n"
                f"TASK: Create a sophisticated espresso profile based on the coffee analysis and user preferences.\n\n" +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT
            )
        elif coffee_analysis:
            # Only image provided
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n"
                f"Task: Create a sophisticated espresso profile for '{coffee_analysis}'.\n\n" +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT
            )
        else:
            # Only user preferences provided
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n"
                f"User Instructions: '{user_prefs}'\n\n"
                "TASK: Create a sophisticated espresso profile based on the user's instructions.\n\n" +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT
            )
        
        logger.debug(
            "Executing profile creation via Gemini",
            extra={
                "request_id": request_id,
                "prompt_length": len(final_prompt)
            }
        )
        
        # Execute profile creation via docker
        # Note: Using -y (yolo mode) to auto-approve tool calls.
        # The --allowed-tools flag doesn't work with MCP-provided tools.
        # Security is maintained because the MCP server only exposes safe tools.
        result = subprocess.run(
            [
                "docker", "exec", "-i", "gemini-client", 
                "gemini", "-y",
                final_prompt
            ],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            logger.error(
                "Profile creation subprocess failed",
                extra={
                    "request_id": request_id,
                    "returncode": result.returncode,
                    "stderr": result.stderr,
                    "stdout": result.stdout
                }
            )
            return {
                "status": "error", 
                "analysis": coffee_analysis,
                "message": result.stderr
            }
        
        logger.info(
            "Profile creation completed successfully",
            extra={
                "request_id": request_id,
                "analysis": coffee_analysis,
                "output_preview": result.stdout[:200] if len(result.stdout) > 200 else result.stdout
            }
        )
        
        # Save to history
        history_entry = save_to_history(
            coffee_analysis=coffee_analysis,
            user_prefs=user_prefs,
            reply=result.stdout
        )
            
        return {
            "status": "success",
            "analysis": coffee_analysis,
            "reply": result.stdout,
            "history_id": history_entry.get("id")
        }

    except Exception as e:
        logger.error(
            f"Profile creation failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "endpoint": "/analyze_and_profile",
                "error_type": type(e).__name__,
                "coffee_analysis": coffee_analysis,
                "has_image": file is not None,
                "has_preferences": user_prefs is not None
            }
        )
        return {
            "status": "error",
            "analysis": coffee_analysis if coffee_analysis else None,
            "message": str(e)
        }

@app.get("/status")
async def get_status(request: Request):
    """Get system status including update availability.
    
    Returns:
        - update_available: Whether updates are available for any component
        - last_check: Timestamp of last update check
        - repositories: Status of each repository (main, mcp, web)
    
    Note: This reads from .versions.json which is populated by the update.sh
    script running on the host. The file is mounted into the container.
    Run './update.sh --check-only' on the host to refresh update status.
    """
    request_id = request.state.request_id
    
    try:
        logger.debug("Checking system status", extra={"request_id": request_id})
        
        # Read version file directly (mounted from host)
        # The file is updated by update.sh --check-only running on the host
        version_file_path = Path("/app/.versions.json")
        update_status = {
            "update_available": False,
            "last_check": None,
            "repositories": {}
        }
        
        if version_file_path.exists():
            with open(version_file_path, 'r') as f:
                version_data = json.load(f)
                # Read update_available directly from file (new format)
                update_status["update_available"] = version_data.get("update_available", False)
                update_status["last_check"] = version_data.get("last_check")
                update_status["repositories"] = version_data.get("repositories", {})
        else:
            # File doesn't exist yet - suggest running update check
            update_status["message"] = "Version file not found. Run './update.sh --check-only' on the host to check for updates."
            logger.warning(
                "Version file not found",
                extra={"request_id": request_id, "version_file": str(version_file_path)}
            )
        
        return update_status
        
    except Exception as e:
        logger.error(
            f"Failed to read system status: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "endpoint": "/status",
                "error_type": type(e).__name__
            }
        )
        return {
            "update_available": False,
            "error": str(e),
            "message": "Could not read update status"
        }

@app.post("/api/trigger-update")
async def trigger_update(request: Request):
    """Trigger the backend update process by signaling the host.
    
    This endpoint writes a timestamp to /app/.rebuild-needed which is mounted
    from the host. The host's launchd service (rebuild-watcher) monitors this
    file and runs update.sh when it changes.
    
    The update cannot run inside the container because:
    1. Docker mounts create git conflicts (files appear modified)
    2. The container cannot rebuild itself
    
    Returns:
        - status: "success" or "error"
        - message: Description of what happened
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Triggering system update via host signal",
            extra={"request_id": request_id, "endpoint": "/api/trigger-update"}
        )
        
        # Signal the host to perform the update by touching .rebuild-needed
        # This file is watched by launchd on the host (rebuild-watcher.sh)
        rebuild_signal = Path("/app/.rebuild-needed")
        
        # Write a timestamp to trigger the file change
        import time
        rebuild_signal.write_text(f"update-requested:{time.time()}\n")
        
        logger.info(
            "Update triggered - signaled host via .rebuild-needed",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": "Update triggered. The host will perform the update and restart containers."
        }
    except Exception as e:
        logger.error(
            f"Failed to trigger update: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "error_type": type(e).__name__
            }
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "Failed to signal update"
            }
        )


@app.get("/api/logs")
async def get_logs(
    request: Request,
    lines: int = 100,
    level: Optional[str] = None,
    log_type: str = "all"
):
    """Retrieve recent log entries for debugging and diagnostics.
    
    Args:
        lines: Number of lines to retrieve (default: 100, max: 1000)
        level: Filter by log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_type: Type of logs to retrieve - "all" or "errors" (default: "all")
    
    Returns:
        - logs: List of log entries (most recent first)
        - total_lines: Total number of log lines returned
        - log_file: Path to the log file
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Log retrieval requested",
            extra={
                "request_id": request_id,
                "lines": lines,
                "level": level,
                "log_type": log_type
            }
        )
        
        # Limit lines to prevent overwhelming responses
        lines = min(lines, 1000)
        
        # Determine which log file to read
        log_dir = Path("/app/logs")
        if log_type == "errors":
            log_file = log_dir / "coffee-relay-errors.log"
        else:
            log_file = log_dir / "coffee-relay.log"
        
        if not log_file.exists():
            logger.warning(
                f"Log file not found: {log_file}",
                extra={"request_id": request_id, "log_file": str(log_file)}
            )
            return {
                "logs": [],
                "total_lines": 0,
                "log_file": str(log_file),
                "message": "Log file not found - logging may not be initialized yet"
            }
        
        # Read log file (last N lines)
        with open(log_file, 'r', encoding='utf-8') as f:
            all_lines = f.readlines()
            recent_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        
        # Parse JSON log entries
        log_entries = []
        for line in reversed(recent_lines):  # Most recent first
            try:
                log_entry = json.loads(line.strip())
                
                # Filter by level if specified
                if level and log_entry.get("level") != level.upper():
                    continue
                
                log_entries.append(log_entry)
            except json.JSONDecodeError:
                # Skip malformed lines
                continue
        
        logger.debug(
            f"Retrieved {len(log_entries)} log entries",
            extra={"request_id": request_id, "log_file": str(log_file)}
        )
        
        return {
            "logs": log_entries,
            "total_lines": len(log_entries),
            "log_file": str(log_file),
            "filters": {
                "lines_requested": lines,
                "level": level,
                "log_type": log_type
            }
        }
        
    except Exception as e:
        logger.error(
            f"Failed to retrieve logs: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "error_type": type(e).__name__
            }
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "Failed to retrieve logs"
            }
        )


# ============================================
# Profile History Management
# ============================================

HISTORY_FILE = Path("/app/data/profile_history.json")


def _ensure_history_file():
    """Ensure the history file and directory exist."""
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not HISTORY_FILE.exists():
        HISTORY_FILE.write_text("[]")


def _load_history() -> list:
    """Load history from file."""
    _ensure_history_file()
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _save_history(history: list):
    """Save history to file."""
    _ensure_history_file()
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, indent=2)


def _extract_profile_json(reply: str) -> Optional[dict]:
    """Extract the profile JSON from the LLM reply.
    
    Searches for JSON blocks in the reply, trying different patterns.
    """
    import re
    
    # Try to find JSON in a code block first
    json_block_pattern = r'```json\s*([\s\S]*?)```'
    matches = re.findall(json_block_pattern, reply, re.IGNORECASE)
    
    for match in matches:
        try:
            parsed = json.loads(match.strip())
            # Check if it looks like a profile (has name, stages, etc.)
            if isinstance(parsed, dict) and ('name' in parsed or 'stages' in parsed):
                return parsed
        except json.JSONDecodeError:
            continue
    
    # Try to find a generic code block
    code_block_pattern = r'```\s*([\s\S]*?)```'
    matches = re.findall(code_block_pattern, reply)
    
    for match in matches:
        try:
            parsed = json.loads(match.strip())
            if isinstance(parsed, dict) and ('name' in parsed or 'stages' in parsed):
                return parsed
        except json.JSONDecodeError:
            continue
    
    return None


def _extract_profile_name(reply: str) -> str:
    """Extract the profile name from the LLM reply."""
    import re
    match = re.search(r'Profile Created:\s*(.+?)(?:\n|$)', reply, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return "Untitled Profile"


def save_to_history(
    coffee_analysis: Optional[str],
    user_prefs: Optional[str],
    reply: str,
    image_preview: Optional[str] = None
) -> dict:
    """Save a generated profile to history.
    
    Args:
        coffee_analysis: The coffee bag analysis text
        user_prefs: User preferences provided
        reply: The full LLM reply
        image_preview: Optional base64 image preview (thumbnail)
        
    Returns:
        The saved history entry
    """
    history = _load_history()
    
    # Generate a unique ID
    entry_id = str(uuid.uuid4())
    
    # Extract profile JSON and name
    profile_json = _extract_profile_json(reply)
    profile_name = _extract_profile_name(reply)
    
    # Create history entry
    entry = {
        "id": entry_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "profile_name": profile_name,
        "coffee_analysis": coffee_analysis,
        "user_preferences": user_prefs,
        "reply": reply,
        "profile_json": profile_json,
        "image_preview": image_preview  # Optional thumbnail
    }
    
    # Add to beginning of list (most recent first)
    history.insert(0, entry)
    
    # Keep only last 100 entries to prevent file from growing too large
    history = history[:100]
    
    _save_history(history)
    
    logger.info(
        f"Saved profile to history: {profile_name}",
        extra={"entry_id": entry_id, "has_json": profile_json is not None}
    )
    
    return entry


@app.get("/api/history")
async def get_history(
    request: Request,
    limit: int = 50,
    offset: int = 0
):
    """Get profile history.
    
    Args:
        limit: Maximum number of entries to return (default: 50)
        offset: Number of entries to skip (default: 0)
    
    Returns:
        - entries: List of history entries
        - total: Total number of entries
    """
    request_id = request.state.request_id
    
    try:
        logger.debug(
            "Fetching profile history",
            extra={"request_id": request_id, "limit": limit, "offset": offset}
        )
        
        history = _load_history()
        total = len(history)
        
        # Apply pagination
        entries = history[offset:offset + limit]
        
        # Remove large fields from list view (keep image_preview small or remove)
        for entry in entries:
            if 'image_preview' in entry:
                entry['image_preview'] = None  # Remove for list view to save bandwidth
        
        return {
            "entries": entries,
            "total": total,
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(
            f"Failed to retrieve history: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to retrieve history"}
        )


@app.get("/api/history/{entry_id}")
async def get_history_entry(request: Request, entry_id: str):
    """Get a specific history entry by ID.
    
    Args:
        entry_id: The unique ID of the history entry
    
    Returns:
        The full history entry including profile JSON
    """
    request_id = request.state.request_id
    
    try:
        logger.debug(
            "Fetching history entry",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        history = _load_history()
        
        for entry in history:
            if entry.get("id") == entry_id:
                return entry
        
        raise HTTPException(status_code=404, detail="History entry not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to retrieve history entry: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "entry_id": entry_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to retrieve history entry"}
        )


@app.delete("/api/history/{entry_id}")
async def delete_history_entry(request: Request, entry_id: str):
    """Delete a specific history entry.
    
    Args:
        entry_id: The unique ID of the history entry to delete
    
    Returns:
        Success status
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Deleting history entry",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        history = _load_history()
        original_length = len(history)
        
        history = [entry for entry in history if entry.get("id") != entry_id]
        
        if len(history) == original_length:
            raise HTTPException(status_code=404, detail="History entry not found")
        
        _save_history(history)
        
        return {"status": "success", "message": "History entry deleted"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to delete history entry: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "entry_id": entry_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to delete history entry"}
        )


@app.delete("/api/history")
async def clear_history(request: Request):
    """Clear all profile history.
    
    Returns:
        Success status
    """
    request_id = request.state.request_id
    
    try:
        logger.warning(
            "Clearing all history",
            extra={"request_id": request_id}
        )
        
        _save_history([])
        
        return {"status": "success", "message": "All history cleared"}
        
    except Exception as e:
        logger.error(
            f"Failed to clear history: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to clear history"}
        )


@app.get("/api/history/{entry_id}/json")
async def get_profile_json(request: Request, entry_id: str):
    """Get the profile JSON for download.
    
    Args:
        entry_id: The unique ID of the history entry
    
    Returns:
        The profile JSON with proper Content-Disposition header for download
    """
    request_id = request.state.request_id
    
    try:
        logger.debug(
            "Fetching profile JSON for download",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        history = _load_history()
        
        for entry in history:
            if entry.get("id") == entry_id:
                if not entry.get("profile_json"):
                    raise HTTPException(
                        status_code=404, 
                        detail="Profile JSON not available for this entry"
                    )
                
                # Create filename from profile name
                profile_name = entry.get("profile_name", "profile")
                safe_filename = "".join(
                    c if c.isalnum() or c in (' ', '-', '_') else ''
                    for c in profile_name
                ).strip().replace(' ', '-').lower()
                
                return JSONResponse(
                    content=entry["profile_json"],
                    headers={
                        "Content-Disposition": f'attachment; filename="{safe_filename}.json"'
                    }
                )
        
        raise HTTPException(status_code=404, detail="History entry not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile JSON: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "entry_id": entry_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to get profile JSON"}
        )
