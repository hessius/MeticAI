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


def parse_gemini_error(error_text: str) -> str:
    """Parse Gemini CLI error output and return a user-friendly message.
    
    The Gemini CLI often returns verbose stack traces. This function extracts
    the meaningful error message for display to end users.
    
    Args:
        error_text: Raw stderr output from the Gemini CLI
        
    Returns:
        A clean, user-friendly error message
    """
    import re
    
    error_text_lower = error_text.lower()
    
    # Check for quota errors
    if 'quota' in error_text_lower or 'exhausted' in error_text_lower:
        return (
            "Daily API quota exhausted. The free Gemini API has usage limits. "
            "Please wait until tomorrow for your quota to reset, or upgrade to "
            "a paid API plan at https://aistudio.google.com/"
        )
    
    # Check for rate limiting
    if 'rate limit' in error_text_lower or 'too many requests' in error_text_lower:
        return (
            "Rate limit exceeded. Too many requests in a short time. "
            "Please wait a minute and try again."
        )
    
    # Check for authentication errors
    if 'api key' in error_text_lower or 'authentication' in error_text_lower or 'unauthorized' in error_text_lower:
        return (
            "API authentication failed. Please check that your GEMINI_API_KEY "
            "is valid and properly configured in your .env file."
        )
    
    # Check for network/connection errors
    if 'network' in error_text_lower or 'connection' in error_text_lower or 'timeout' in error_text_lower:
        return (
            "Network error connecting to Gemini API. Please check your "
            "internet connection and try again."
        )
    
    # Check for MCP/Meticulous connection errors
    if 'mcp' in error_text_lower or 'meticulous' in error_text_lower:
        if 'connection refused' in error_text_lower or 'cannot connect' in error_text_lower:
            return (
                "Cannot connect to the Meticulous machine. Please ensure your "
                "espresso machine is powered on and connected to the network."
            )
    
    # Check for content safety errors
    if 'safety' in error_text_lower or 'blocked' in error_text_lower:
        return (
            "Request was blocked by content safety filters. "
            "Please try rephrasing your preferences."
        )
    
    # Try to extract a clean error message from stack trace
    # Look for common error patterns
    patterns = [
        r'Error:\s*(.+?)(?:\n|$)',
        r'error:\s*(.+?)(?:\n|$)',
        r'Exception:\s*(.+?)(?:\n|$)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, error_text, re.IGNORECASE)
        if match:
            extracted = match.group(1).strip()
            # Don't return if it's just a file path or technical detail
            if len(extracted) > 10 and not extracted.startswith('/') and not extracted.startswith('file:'):
                return extracted[:200]  # Limit length
    
    # Fallback: return a generic message with truncated technical detail
    if len(error_text) > 150:
        return f"Profile generation failed. Technical details: {error_text[:100]}..."
    
    return f"Profile generation failed: {error_text}" if error_text else "Profile generation failed unexpectedly."


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
            # Parse the error to provide a user-friendly message
            user_message = parse_gemini_error(result.stderr or result.stdout or "Unknown error")
            return {
                "status": "error", 
                "analysis": coffee_analysis,
                "message": user_message
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


# ============================================
# Shot History Cache Management
# ============================================

SHOT_CACHE_FILE = Path("/app/data/shot_cache.json")
SHOT_CACHE_STALE_SECONDS = 3600  # 60 minutes - after this, data is stale but still returned


def _ensure_shot_cache_file():
    """Ensure the shot cache file and directory exist."""
    SHOT_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not SHOT_CACHE_FILE.exists():
        SHOT_CACHE_FILE.write_text("{}")


def _load_shot_cache() -> dict:
    """Load shot cache from file."""
    _ensure_shot_cache_file()
    try:
        with open(SHOT_CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {}


def _save_shot_cache(cache: dict):
    """Save shot cache to file."""
    _ensure_shot_cache_file()
    with open(SHOT_CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2)


def _get_cached_shots(profile_name: str, limit: int) -> tuple[Optional[dict], bool, Optional[float]]:
    """Get cached shots for a profile.
    
    Returns a tuple of (cached_data, is_stale, cached_at_timestamp).
    - cached_data: The cached response data, or None if no cache exists
    - is_stale: True if cache is older than SHOT_CACHE_STALE_SECONDS
    - cached_at: Unix timestamp of when cache was created
    
    Cache is stored indefinitely but marked stale after 60 minutes.
    """
    cache = _load_shot_cache()
    cache_key = profile_name.lower()
    
    if cache_key not in cache:
        return None, False, None
    
    cached_entry = cache[cache_key]
    cached_time = cached_entry.get("cached_at", 0)
    cached_limit = cached_entry.get("limit", 0)
    
    # Check if limit matches (requesting more than cached = cache miss)
    if limit > cached_limit:
        return None, False, None
    
    # Check if cache is stale (older than 60 minutes)
    is_stale = time.time() - cached_time > SHOT_CACHE_STALE_SECONDS
    
    return cached_entry.get("data"), is_stale, cached_time


def _set_cached_shots(profile_name: str, data: dict, limit: int):
    """Store shots in cache for a profile."""
    cache = _load_shot_cache()
    cache_key = profile_name.lower()
    
    cache[cache_key] = {
        "cached_at": time.time(),
        "limit": limit,
        "data": data
    }
    
    _save_shot_cache(cache)


# ============================================
# Profile Image Cache Management
# ============================================

IMAGE_CACHE_DIR = Path("/app/data/image_cache")


def _ensure_image_cache_dir():
    """Ensure the image cache directory exists."""
    IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _get_cached_image(profile_name: str) -> Optional[bytes]:
    """Get cached image for a profile if it exists.
    
    Returns the image bytes or None if not cached.
    """
    _ensure_image_cache_dir()
    cache_file = IMAGE_CACHE_DIR / f"{profile_name.lower().replace('/', '_').replace(' ', '_')}.png"
    
    if cache_file.exists():
        try:
            return cache_file.read_bytes()
        except Exception as e:
            logger.warning(f"Failed to read cached image for {profile_name}: {e}")
            return None
    return None


def _set_cached_image(profile_name: str, image_data: bytes):
    """Store image in cache for a profile."""
    _ensure_image_cache_dir()
    cache_file = IMAGE_CACHE_DIR / f"{profile_name.lower().replace('/', '_').replace(' ', '_')}.png"
    
    try:
        cache_file.write_bytes(image_data)
        logger.info(f"Cached image for profile: {profile_name} ({len(image_data)} bytes)")
    except Exception as e:
        logger.warning(f"Failed to cache image for {profile_name}: {e}")


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


# ============================================
# Shot History from Meticulous Machine
# ============================================

# Lazy-loaded Meticulous API client
_meticulous_api = None


def get_meticulous_api():
    """Lazily initialize and return the Meticulous API client."""
    global _meticulous_api
    if _meticulous_api is None:
        from meticulous.api import Api
        meticulous_ip = os.environ.get("METICULOUS_IP", "meticulousmodelalmondmilklatte.local")
        # Ensure we use http:// prefix
        if not meticulous_ip.startswith("http"):
            meticulous_ip = f"http://{meticulous_ip}"
        _meticulous_api = Api(base_url=meticulous_ip)
    return _meticulous_api


def decompress_shot_data(compressed_data: bytes) -> dict:
    """Decompress zstandard-compressed shot data."""
    import zstandard as zstd
    dctx = zstd.ZstdDecompressor()
    decompressed = dctx.decompress(compressed_data)
    return json.loads(decompressed.decode('utf-8'))


async def fetch_shot_data(date_str: str, filename: str) -> dict:
    """Fetch and decompress shot data from the Meticulous machine."""
    import httpx
    
    api = get_meticulous_api()
    url = f"{api.base_url}/api/v1/history/files/{date_str}/{filename}"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        
        # Check if it's compressed (zstd)
        if filename.endswith('.zst'):
            return decompress_shot_data(response.content)
        else:
            return response.json()


@app.get("/api/shots/dates")
async def get_shot_dates(request: Request):
    """Get all available shot dates from the machine.
    
    Returns:
        List of dates with available shot history
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching shot history dates",
            extra={"request_id": request_id}
        )
        
        api = get_meticulous_api()
        result = api.get_history_dates()
        
        # Check for API error
        if hasattr(result, 'error') and result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {result.error}"
            )
        
        # Extract date names
        dates = [d.name for d in result] if result else []
        
        return {"dates": sorted(dates, reverse=True)}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to fetch shot dates: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch shot dates from machine"}
        )


@app.get("/api/shots/files/{date}")
async def get_shot_files(request: Request, date: str):
    """Get shot files for a specific date.
    
    Args:
        date: Date in YYYY-MM-DD format
        
    Returns:
        List of shot filenames for that date
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching shot files for date",
            extra={"request_id": request_id, "date": date}
        )
        
        api = get_meticulous_api()
        result = api.get_shot_files(date)
        
        # Check for API error
        if hasattr(result, 'error') and result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {result.error}"
            )
        
        # Extract filenames
        files = [f.name for f in result] if result else []
        
        return {"date": date, "files": files}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to fetch shot files: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "date": date, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch shot files from machine"}
        )


@app.get("/api/shots/data/{date}/{filename:path}")
async def get_shot_data(request: Request, date: str, filename: str):
    """Get the actual shot data for a specific shot.
    
    Args:
        date: Date in YYYY-MM-DD format
        filename: Shot filename (e.g., HH:MM:SS.shot.json.zst)
        
    Returns:
        Decompressed shot data with telemetry
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching shot data",
            extra={"request_id": request_id, "date": date, "shot_file": filename}
        )
        
        shot_data = await fetch_shot_data(date, filename)
        
        return {
            "date": date,
            "filename": filename,
            "data": shot_data
        }
        
    except Exception as e:
        logger.error(
            f"Failed to fetch shot data: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "date": date, "shot_file": filename, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch shot data from machine"}
        )


@app.get("/api/shots/by-profile/{profile_name}")
async def get_shots_by_profile(
    request: Request, 
    profile_name: str,
    limit: int = 20,
    include_data: bool = False,
    force_refresh: bool = False
):
    """Get all shots that used a specific profile.
    
    This endpoint scans shot history to find all shots that match the given profile name.
    Results are cached server-side indefinitely, but marked stale after 60 minutes.
    When stale, cached data is still returned with is_stale=true so client can show it
    while fetching fresh data in the background.
    
    Args:
        profile_name: Name of the profile to search for
        limit: Maximum number of shots to return (default: 20)
        include_data: Whether to include full telemetry data (default: False for performance)
        force_refresh: Skip cache and fetch fresh data (default: False)
        
    Returns:
        List of shots matching the profile, with cache metadata (cached_at, is_stale)
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Searching for shots by profile",
            extra={"request_id": request_id, "profile_name": profile_name, "limit": limit, "force_refresh": force_refresh}
        )
        
        # Check server-side cache first (unless forcing refresh or requesting data)
        if not force_refresh and not include_data:
            cached_data, is_stale, cached_at = _get_cached_shots(profile_name, limit)
            if cached_data:
                logger.info(
                    f"Returning cached shots for profile '{profile_name}' (stale={is_stale})",
                    extra={"request_id": request_id, "count": cached_data.get("count", 0), "from_cache": True, "is_stale": is_stale}
                )
                # Add cache metadata to response
                cached_data["cached_at"] = cached_at
                cached_data["is_stale"] = is_stale
                return cached_data
        
        api = get_meticulous_api()
        
        # Get all available dates
        dates_result = api.get_history_dates()
        if hasattr(dates_result, 'error') and dates_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {dates_result.error}"
            )
        
        dates = [d.name for d in dates_result] if dates_result else []
        matching_shots = []
        
        # Search through dates (most recent first)
        for date in sorted(dates, reverse=True):
            if len(matching_shots) >= limit:
                break
                
            # Get files for this date
            files_result = api.get_shot_files(date)
            if hasattr(files_result, 'error') and files_result.error:
                logger.warning(f"Could not get files for {date}: {files_result.error}")
                continue
            
            files = [f.name for f in files_result] if files_result else []
            
            # Check each shot file
            for filename in files:
                if len(matching_shots) >= limit:
                    break
                    
                try:
                    shot_data = await fetch_shot_data(date, filename)
                    
                    # Extract profile name from shot data
                    # Can be in "profile_name" or "profile.name" depending on firmware
                    shot_profile_name = shot_data.get("profile_name", "")
                    if not shot_profile_name and isinstance(shot_data.get("profile"), dict):
                        shot_profile_name = shot_data.get("profile", {}).get("name", "")
                    
                    # Case-insensitive match
                    if shot_profile_name.lower() == profile_name.lower():
                        # Extract final weight and time from the data array
                        data_entries = shot_data.get("data", [])
                        final_weight = None
                        total_time_ms = None
                        
                        if data_entries:
                            last_entry = data_entries[-1]
                            # Weight is in shot.weight
                            if isinstance(last_entry.get("shot"), dict):
                                final_weight = last_entry["shot"].get("weight")
                            # Time is in milliseconds
                            total_time_ms = last_entry.get("time")
                        
                        shot_info = {
                            "date": date,
                            "filename": filename,
                            "timestamp": shot_data.get("time"),  # Unix timestamp
                            "profile_name": shot_profile_name,
                            "final_weight": final_weight,
                            "total_time": total_time_ms / 1000 if total_time_ms else None,  # Convert to seconds
                        }
                        
                        if include_data:
                            shot_info["data"] = shot_data
                        
                        matching_shots.append(shot_info)
                        
                except Exception as e:
                    logger.warning(
                        f"Could not process shot {date}/{filename}: {str(e)}",
                        extra={"request_id": request_id}
                    )
                    continue
        
        logger.info(
            f"Found {len(matching_shots)} shots for profile '{profile_name}'",
            extra={"request_id": request_id, "count": len(matching_shots)}
        )
        
        current_time = time.time()
        response_data = {
            "profile_name": profile_name,
            "shots": matching_shots,
            "count": len(matching_shots),
            "limit": limit,
            "cached_at": current_time,
            "is_stale": False
        }
        
        # Cache the result (only if not including full data, which is too large)
        if not include_data:
            _set_cached_shots(profile_name, response_data, limit)
        
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to search shots by profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to search shots by profile"}
        )


def process_image_for_profile(image_data: bytes, content_type: str = "image/png") -> tuple[str, bytes]:
    """Process an image for profile upload: crop to square, resize to 512x512, convert to base64 data URI.
    
    Args:
        image_data: Raw image bytes
        content_type: MIME type of the image
        
    Returns:
        Tuple of (base64 data URI string, PNG bytes for caching)
    """
    from PIL import Image as PILImage
    import io
    import base64
    
    # Open image with PIL
    img = PILImage.open(io.BytesIO(image_data))
    
    # Convert to RGB if necessary (for PNG with alpha channel)
    if img.mode in ('RGBA', 'LA', 'P'):
        # Create white background for transparency
        background = PILImage.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        if img.mode in ('RGBA', 'LA'):
            background.paste(img, mask=img.split()[-1])  # Use alpha channel as mask
            img = background
        else:
            img = img.convert('RGB')
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Crop to square (center crop)
    width, height = img.size
    min_dim = min(width, height)
    left = (width - min_dim) // 2
    top = (height - min_dim) // 2
    right = left + min_dim
    bottom = top + min_dim
    img = img.crop((left, top, right, bottom))
    
    # Resize to 512x512
    img = img.resize((512, 512), PILImage.Resampling.LANCZOS)
    
    # Convert to PNG bytes
    buffer = io.BytesIO()
    img.save(buffer, format='PNG', optimize=True)
    png_bytes = buffer.getvalue()
    
    # Encode to base64 data URI
    b64_data = base64.b64encode(png_bytes).decode('utf-8')
    return f"data:image/png;base64,{b64_data}", png_bytes


@app.post("/api/profile/{profile_name}/image")
async def upload_profile_image(
    profile_name: str,
    request: Request,
    file: UploadFile = File(...)
):
    """Upload an image for a profile.
    
    The image will be:
    - Center-cropped to square aspect ratio
    - Resized to 512x512
    - Converted to base64 data URI
    - Saved to the profile on the Meticulous machine
    
    Args:
        profile_name: Name of the profile to update
        file: Image file to upload
        
    Returns:
        Success status with profile info
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Uploading image for profile: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(
                status_code=400,
                detail="File must be an image"
            )
        
        # Read image data
        image_data = await file.read()
        
        # Process image: crop, resize, encode
        image_data_uri, png_bytes = process_image_for_profile(image_data, file.content_type)
        
        # Cache the processed image for fast retrieval
        _set_cached_image(profile_name, png_bytes)
        
        logger.info(
            f"Processed image for profile: {profile_name} (size: {len(image_data_uri)} chars)",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        # Find the profile by name
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        # Find matching profile
        matching_profile = None
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                # Get full profile
                full_profile = api.get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                matching_profile = full_profile
                break
        
        if not matching_profile:
            raise HTTPException(
                status_code=404,
                detail=f"Profile '{profile_name}' not found on machine"
            )
        
        # Update the profile with the new image
        from meticulous.profile import Display
        
        # Preserve existing accent color if present
        existing_accent = None
        if matching_profile.display:
            existing_accent = matching_profile.display.accentColor
        
        matching_profile.display = Display(
            image=image_data_uri,
            accentColor=existing_accent
        )
        
        # Save the updated profile
        save_result = api.save_profile(matching_profile)
        
        if hasattr(save_result, 'error') and save_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to save profile: {save_result.error}"
            )
        
        logger.info(
            f"Successfully updated profile image: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        return {
            "status": "success",
            "message": f"Image uploaded for profile '{profile_name}'",
            "profile_id": matching_profile.id,
            "image_size": len(image_data_uri)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to upload profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to upload profile image"}
        )


# Image generation styles that work well for coffee/espresso profiles
IMAGE_GEN_STYLES = [
    "abstract",
    "minimalist", 
    "pixel-art",
    "watercolor",
    "modern",
    "vintage"
]


@app.post("/api/profile/{profile_name}/generate-image")
async def generate_profile_image(
    profile_name: str,
    request: Request,
    style: str = "abstract",
    tags: str = "",
    preview: bool = False
):
    """Generate an AI image for a profile using the nanobanana extension.
    
    This uses the Gemini CLI with the nanobanana extension to generate
    a square image based on the profile name and optional tags.
    
    IMPORTANT: This feature requires a paid Gemini API key.
    
    Args:
        profile_name: Name of the profile
        style: Image style (abstract, minimalist, pixel-art, watercolor, modern, vintage)
        tags: Comma-separated tags to include in the prompt
        preview: If true, return the image as base64 without saving to profile
        
    Returns:
        Success status with generated image info (and image data if preview=true)
    
    Args:
        profile_name: Name of the profile
        style: Image style (abstract, minimalist, pixel-art, watercolor, modern, vintage)
        tags: Comma-separated tags to include in the prompt
        
    Returns:
        Success status with generated image info
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Generating image for profile: {profile_name}",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "style": style,
                "tags": tags
            }
        )
        
        # Validate style
        if style not in IMAGE_GEN_STYLES:
            style = "abstract"
        
        # Parse tags
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        
        # Build the prompt using the advanced prompt builder
        from prompt_builder import build_image_prompt_with_metadata
        
        prompt_result = build_image_prompt_with_metadata(
            profile_name=profile_name,
            style=style,
            tags=tag_list
        )
        
        full_prompt = prompt_result["prompt"]
        prompt_metadata = prompt_result["metadata"]
        
        logger.info(
            f"Built image generation prompt",
            extra={
                "request_id": request_id,
                "prompt": full_prompt[:200],
                "influences_found": prompt_metadata.get("influences_found", 0),
                "selected_colors": prompt_metadata.get("selected_colors", []),
                "selected_moods": prompt_metadata.get("selected_moods", [])
            }
        )
        
        # Create a temporary directory for the output
        import tempfile
        import shutil
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Execute nanobanana via gemini CLI
            result = subprocess.run(
                [
                    "docker", "exec", "-i", "gemini-client",
                    "gemini", "-y",
                    f'/generate "{full_prompt}"'
                ],
                capture_output=True,
                text=True,
                timeout=120  # 2 minute timeout for image generation
            )
            
            if result.returncode != 0:
                logger.error(
                    f"Image generation failed",
                    extra={
                        "request_id": request_id,
                        "returncode": result.returncode,
                        "stderr": result.stderr,
                        "stdout": result.stdout
                    }
                )
                
                # Check for common errors
                error_output = result.stderr or result.stdout or ""
                if "API key" in error_output.lower() or "authentication" in error_output.lower():
                    raise HTTPException(
                        status_code=402,
                        detail="Image generation requires a paid Gemini API key. Please set GEMINI_API_KEY in your environment."
                    )
                
                raise HTTPException(
                    status_code=500,
                    detail=f"Image generation failed: {error_output[:200]}"
                )
            
            # Find the generated image in nanobanana-output
            # The output path is typically mentioned in the result like:
            # "saved it to `/root/nanobanana-output/filename.png`"
            output = result.stdout
            logger.info(f"Nanobanana output: {output}", extra={"request_id": request_id})
            
            # Try to find the image path in the output
            # nanobanana saves to /root/nanobanana-output/
            image_path = None
            
            # Look for paths in backticks first (common format)
            import re
            backtick_matches = re.findall(r'`([^`]+\.png)`', output)
            if backtick_matches:
                for match in backtick_matches:
                    # The path is already absolute
                    check_result = subprocess.run(
                        ["docker", "exec", "gemini-client", "test", "-f", match],
                        capture_output=True
                    )
                    if check_result.returncode == 0:
                        image_path = match
                        logger.info(f"Found image at: {image_path}", extra={"request_id": request_id})
                        break
            
            # Fallback: Look for any .png file path
            if not image_path:
                png_matches = re.findall(r'(/[\w\-/\.]+\.png)', output)
                for match in png_matches:
                    check_result = subprocess.run(
                        ["docker", "exec", "gemini-client", "test", "-f", match],
                        capture_output=True
                    )
                    if check_result.returncode == 0:
                        image_path = match
                        logger.info(f"Found image at: {image_path}", extra={"request_id": request_id})
                        break
            
            # If no path found, try to list the output directory
            if not image_path:
                list_result = subprocess.run(
                    ["docker", "exec", "gemini-client", "ls", "-t", "/root/nanobanana-output/"],
                    capture_output=True,
                    text=True
                )
                if list_result.returncode == 0 and list_result.stdout.strip():
                    newest_file = list_result.stdout.strip().split('\n')[0]
                    image_path = f"/root/nanobanana-output/{newest_file}"
            
            if not image_path:
                raise HTTPException(
                    status_code=500,
                    detail="Image generation completed but could not find output file"
                )
            
            # Read the image from the container
            cat_result = subprocess.run(
                ["docker", "exec", "gemini-client", "cat", image_path],
                capture_output=True
            )
            
            if cat_result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to read generated image"
                )
            
            image_data = cat_result.stdout
            
            # Process the image (crop/resize) and upload to profile
            image_data_uri, png_bytes = process_image_for_profile(image_data, "image/png")
            
            # Cache the processed image for fast retrieval
            _set_cached_image(profile_name, png_bytes)
            
            logger.info(
                f"Processed generated image for profile: {profile_name} (size: {len(image_data_uri)} chars)",
                extra={"request_id": request_id}
            )
            
            # If preview mode, return the image without saving
            if preview:
                logger.info(
                    f"Returning preview image for profile: {profile_name}",
                    extra={"request_id": request_id, "style": style}
                )
                return {
                    "status": "preview",
                    "message": f"Preview image generated for profile '{profile_name}'",
                    "style": style,
                    "prompt": full_prompt,
                    "prompt_metadata": prompt_metadata,
                    "image_data": image_data_uri
                }
            
            # Find the profile and update it
            api = get_meticulous_api()
            profiles_result = api.list_profiles()
            
            if hasattr(profiles_result, 'error') and profiles_result.error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Machine API error: {profiles_result.error}"
                )
            
            matching_profile = None
            for partial_profile in profiles_result:
                if partial_profile.name == profile_name:
                    full_profile = api.get_profile(partial_profile.id)
                    if hasattr(full_profile, 'error') and full_profile.error:
                        continue
                    matching_profile = full_profile
                    break
            
            if not matching_profile:
                raise HTTPException(
                    status_code=404,
                    detail=f"Profile '{profile_name}' not found on machine"
                )
            
            # Update the display image
            from meticulous.profile import Display
            
            existing_accent = None
            if matching_profile.display:
                existing_accent = matching_profile.display.accentColor
            
            matching_profile.display = Display(
                image=image_data_uri,
                accentColor=existing_accent
            )
            
            save_result = api.save_profile(matching_profile)
            
            if hasattr(save_result, 'error') and save_result.error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to save profile: {save_result.error}"
                )
            
            logger.info(
                f"Successfully generated and saved profile image: {profile_name}",
                extra={"request_id": request_id, "style": style}
            )
            
            return {
                "status": "success",
                "message": f"Image generated for profile '{profile_name}'",
                "profile_id": matching_profile.id,
                "style": style,
                "prompt": full_prompt,
                "prompt_metadata": prompt_metadata
            }
            
    except subprocess.TimeoutExpired:
        logger.error(
            f"Image generation timed out",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        raise HTTPException(
            status_code=504,
            detail="Image generation timed out. Please try again."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to generate profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to generate profile image"}
        )


from pydantic import BaseModel

class ApplyImageRequest(BaseModel):
    image_data: str  # Base64 data URI


@app.post("/api/profile/{profile_name}/apply-image")
async def apply_profile_image(
    profile_name: str,
    request: Request,
    body: ApplyImageRequest
):
    """Apply a previously generated (previewed) image to a profile.
    
    This endpoint saves a base64 image data URI to the profile's display.
    Used after previewing a generated image and choosing to keep it.
    
    Args:
        profile_name: Name of the profile
        body: Request body containing image_data (base64 data URI)
        
    Returns:
        Success status with profile info
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Applying image to profile: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        image_data_uri = body.image_data
        
        # Validate it looks like a data URI
        if not image_data_uri.startswith("data:image/"):
            raise HTTPException(
                status_code=400,
                detail="Invalid image data - must be a data URI"
            )
        
        # Extract and cache the PNG bytes from the data URI
        import base64
        try:
            # Format: data:image/png;base64,<data>
            header, b64_data = image_data_uri.split(',', 1)
            png_bytes = base64.b64decode(b64_data)
            _set_cached_image(profile_name, png_bytes)
        except Exception as e:
            logger.warning(f"Failed to cache image from apply-image: {e}")
        
        # Find the profile and update it
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        matching_profile = None
        for partial_profile in profiles_result:
            if partial_profile.name == profile_name:
                full_profile = api.get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                matching_profile = full_profile
                break
        
        if not matching_profile:
            raise HTTPException(
                status_code=404,
                detail=f"Profile '{profile_name}' not found on machine"
            )
        
        # Update the display image
        from meticulous.profile import Display
        
        existing_accent = None
        if matching_profile.display:
            existing_accent = matching_profile.display.accentColor
        
        matching_profile.display = Display(
            image=image_data_uri,
            accentColor=existing_accent
        )
        
        save_result = api.save_profile(matching_profile)
        
        if hasattr(save_result, 'error') and save_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to save profile: {save_result.error}"
            )
        
        logger.info(
            f"Successfully applied image to profile: {profile_name}",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": f"Image applied to profile '{profile_name}'",
            "profile_id": matching_profile.id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to apply profile image: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to apply profile image"}
        )


@app.get("/api/profile/{profile_name}/image-proxy")
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


@app.get("/api/profile/{profile_name}")
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


def _format_dynamics_description(stage: dict) -> str:
    """Format a human-readable description of the stage dynamics."""
    stage_type = stage.get("type", "unknown")
    dynamics_points = stage.get("dynamics_points", [])
    dynamics_over = stage.get("dynamics_over", "time")
    
    if not dynamics_points:
        return f"{stage_type} stage (no dynamics data)"
    
    unit = "bar" if stage_type == "pressure" else "ml/s"
    over_unit = "s" if dynamics_over == "time" else "g"
    
    if len(dynamics_points) == 1:
        # Constant value
        value = dynamics_points[0][1] if len(dynamics_points[0]) > 1 else dynamics_points[0][0]
        return f"Constant {stage_type} at {value} {unit}"
    elif len(dynamics_points) == 2:
        start_x, start_y = dynamics_points[0][0], dynamics_points[0][1]
        end_x, end_y = dynamics_points[1][0], dynamics_points[1][1]
        if start_y == end_y:
            return f"Constant {stage_type} at {start_y} {unit} for {end_x}{over_unit}"
        else:
            direction = "ramp up" if end_y > start_y else "ramp down"
            return f"{stage_type.capitalize()} {direction} from {start_y} to {end_y} {unit} over {end_x}{over_unit}"
    else:
        # Multiple points - describe curve
        values = [p[1] for p in dynamics_points if len(p) > 1]
        if values:
            return f"{stage_type.capitalize()} curve: {' → '.join(str(v) for v in values)} {unit}"
        return f"Multi-point {stage_type} curve"


def _format_exit_triggers(exit_triggers: list) -> list[dict]:
    """Format exit triggers into structured descriptions."""
    formatted = []
    for trigger in exit_triggers:
        trigger_type = trigger.get("type", "unknown")
        value = trigger.get("value", 0)
        comparison = trigger.get("comparison", ">=")
        
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
            "value": value,
            "comparison": comparison,
            "description": f"{trigger_type} {comp_text} {value}{unit}"
        })
    
    return formatted


def _format_limits(limits: list) -> list[dict]:
    """Format stage limits into structured descriptions."""
    formatted = []
    for limit in limits:
        limit_type = limit.get("type", "unknown")
        value = limit.get("value", 0)
        
        unit = {
            "time": "s",
            "weight": "g",
            "pressure": "bar",
            "flow": "ml/s"
        }.get(limit_type, "")
        
        formatted.append({
            "type": limit_type,
            "value": value,
            "description": f"Limit {limit_type} to {value}{unit}"
        })
    
    return formatted


def _determine_exit_trigger_hit(
    stage_data: dict,
    exit_triggers: list,
    next_stage_start: float | None = None
) -> dict:
    """Determine which exit trigger caused the stage to end.
    
    Returns:
        Dict with 'triggered' (the exit that fired) and 'not_triggered' (exits that didn't fire)
    """
    duration = stage_data.get("duration", 0)
    end_weight = stage_data.get("end_weight", 0)
    max_pressure = stage_data.get("max_pressure", 0)
    max_flow = stage_data.get("max_flow", 0)
    
    triggered = None
    not_triggered = []
    
    for trigger in exit_triggers:
        trigger_type = trigger.get("type", "")
        value = trigger.get("value", 0)
        comparison = trigger.get("comparison", ">=")
        
        # Check if this trigger was satisfied
        actual_value = 0
        if trigger_type == "time":
            actual_value = duration
        elif trigger_type == "weight":
            actual_value = end_weight
        elif trigger_type == "pressure":
            actual_value = max_pressure
        elif trigger_type == "flow":
            actual_value = max_flow
        
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
        
        trigger_info = {
            "type": trigger_type,
            "target": value,
            "actual": round(actual_value, 1),
            "description": trigger.get("description", f"{trigger_type} {comparison} {value}")
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


def _analyze_stage_execution(
    profile_stage: dict,
    shot_stage_data: dict | None,
    total_shot_duration: float
) -> dict:
    """Analyze how a single stage executed compared to its profile definition."""
    stage_name = profile_stage.get("name", "Unknown")
    stage_type = profile_stage.get("type", "unknown")
    stage_key = profile_stage.get("key", "")
    
    # Build profile target description
    dynamics_desc = _format_dynamics_description(profile_stage)
    exit_triggers = _format_exit_triggers(profile_stage.get("exit_triggers", []))
    limits = _format_limits(profile_stage.get("limits", []))
    
    result = {
        "stage_name": stage_name,
        "stage_key": stage_key,
        "stage_type": stage_type,
        "profile_target": dynamics_desc,
        "exit_triggers": exit_triggers,
        "limits": limits,
        "executed": shot_stage_data is not None,
        "execution_data": None,
        "exit_trigger_result": None,
        "limit_hit": None,
        "assessment": None
    }
    
    if shot_stage_data is None:
        result["assessment"] = {
            "status": "not_reached",
            "message": "This stage was never executed during the shot"
        }
        return result
    
    # Stage was executed - analyze it
    duration = shot_stage_data.get("duration", 0)
    start_weight = shot_stage_data.get("start_weight", 0)
    end_weight = shot_stage_data.get("end_weight", 0)
    weight_gain = end_weight - start_weight
    avg_pressure = shot_stage_data.get("avg_pressure", 0)
    max_pressure = shot_stage_data.get("max_pressure", 0)
    min_pressure = shot_stage_data.get("min_pressure", 0)
    avg_flow = shot_stage_data.get("avg_flow", 0)
    max_flow = shot_stage_data.get("max_flow", 0)
    
    result["execution_data"] = {
        "duration": round(duration, 1),
        "weight_gain": round(weight_gain, 1),
        "start_weight": round(start_weight, 1),
        "end_weight": round(end_weight, 1),
        "avg_pressure": round(avg_pressure, 1),
        "max_pressure": round(max_pressure, 1),
        "min_pressure": round(min_pressure, 1),
        "avg_flow": round(avg_flow, 1),
        "max_flow": round(max_flow, 1)
    }
    
    # Determine which exit trigger was hit
    if profile_stage.get("exit_triggers"):
        exit_result = _determine_exit_trigger_hit(
            shot_stage_data,
            profile_stage.get("exit_triggers", [])
        )
        result["exit_trigger_result"] = exit_result
    
    # Check if any limits were hit
    stage_limits = profile_stage.get("limits", [])
    for limit in stage_limits:
        limit_type = limit.get("type", "")
        limit_value = limit.get("value", 0)
        
        actual = 0
        if limit_type == "flow":
            actual = max_flow
        elif limit_type == "pressure":
            actual = max_pressure
        elif limit_type == "time":
            actual = duration
        elif limit_type == "weight":
            actual = end_weight
        
        # Check if limit was hit (within small tolerance)
        if actual >= limit_value - 0.2:
            result["limit_hit"] = {
                "type": limit_type,
                "limit_value": limit_value,
                "actual_value": round(actual, 1),
                "description": f"Hit {limit_type} limit of {limit_value}"
            }
            break
    
    # Generate assessment
    if result["exit_trigger_result"] and result["exit_trigger_result"]["triggered"]:
        if result["limit_hit"]:
            result["assessment"] = {
                "status": "hit_limit",
                "message": f"Stage exited but hit a limit ({result['limit_hit']['description']})"
            }
        else:
            result["assessment"] = {
                "status": "reached_goal",
                "message": f"Exited via: {result['exit_trigger_result']['triggered']['description']}"
            }
    elif result["exit_trigger_result"] and result["exit_trigger_result"]["not_triggered"]:
        # No trigger was hit - stage ended prematurely, this is a failure
        # Check if the dynamics goal was reached (e.g., target pressure)
        goal_reached = False
        goal_message = ""
        
        dynamics_points = profile_stage.get("dynamics_points", [])
        if dynamics_points and len(dynamics_points) >= 1:
            # Get the target value (last point in dynamics)
            target_value = dynamics_points[-1][1] if len(dynamics_points[-1]) > 1 else dynamics_points[-1][0]
            
            if stage_type == "pressure":
                # Check if we reached target pressure
                if max_pressure >= target_value * 0.95:  # Within 5%
                    goal_reached = True
                    goal_message = f"Target pressure of {target_value} bar was reached ({max_pressure:.1f} bar achieved)"
                else:
                    goal_message = f"Target pressure of {target_value} bar was NOT reached (only {max_pressure:.1f} bar achieved)"
            elif stage_type == "flow":
                if max_flow >= target_value * 0.95:
                    goal_reached = True
                    goal_message = f"Target flow of {target_value} ml/s was reached ({max_flow:.1f} ml/s achieved)"
                else:
                    goal_message = f"Target flow of {target_value} ml/s was NOT reached (only {max_flow:.1f} ml/s achieved)"
        
        if goal_reached:
            result["assessment"] = {
                "status": "incomplete",
                "message": f"Stage ended before exit triggers were satisfied, but {goal_message.lower()}"
            }
        else:
            result["assessment"] = {
                "status": "failed",
                "message": f"Stage ended before exit triggers were satisfied. {goal_message}" if goal_message else "Stage ended before exit triggers were satisfied"
            }
    else:
        result["assessment"] = {
            "status": "executed",
            "message": "Stage executed (no exit triggers defined)"
        }
    
    return result


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
        if status.lower().strip() == "retracting":
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
        "min_pressure": min(pressures) if pressures else 0,
        "max_pressure": max(pressures) if pressures else 0,
        "avg_pressure": sum(pressures) / len(pressures) if pressures else 0,
        "min_flow": min(flows) if flows else 0,
        "max_flow": max(flows) if flows else 0,
        "avg_flow": sum(flows) / len(flows) if flows else 0,
        "entry_count": len(entries)
    }


def _perform_local_shot_analysis(shot_data: dict, profile_data: dict) -> dict:
    """Perform complete local analysis of shot vs profile.
    
    This is a purely algorithmic analysis - no LLM involved.
    """
    # Extract overall shot metrics
    data_entries = shot_data.get("data", [])
    
    final_weight = 0
    total_time = 0
    max_pressure = 0
    max_flow = 0
    
    for entry in data_entries:
        shot = entry.get("shot", {})
        weight = shot.get("weight", 0)
        pressure = shot.get("pressure", 0)
        flow = shot.get("flow", 0) or shot.get("gravimetric_flow", 0)
        t = entry.get("time", 0) / 1000
        
        final_weight = max(final_weight, weight)
        total_time = max(total_time, t)
        max_pressure = max(max_pressure, pressure)
        max_flow = max(max_flow, flow)
    
    target_weight = profile_data.get("final_weight", 0) or 0
    
    # Weight analysis
    weight_deviation = 0
    weight_status = "on_target"
    if target_weight > 0:
        weight_deviation = ((final_weight - target_weight) / target_weight) * 100
        if final_weight < target_weight * 0.95:  # More than 5% under
            weight_status = "under"
        elif final_weight > target_weight * 1.1:  # More than 10% over
            weight_status = "over"
    
    # Extract shot stage data
    shot_stages = _extract_shot_stage_data(shot_data)
    
    # Profile stages
    profile_stages = profile_data.get("stages", [])
    
    # Analyze each profile stage
    stage_analyses = []
    executed_stages = set()
    unreached_stages = []
    preinfusion_time = 0
    preinfusion_stages = []
    
    for profile_stage in profile_stages:
        stage_name = profile_stage.get("name", "")
        stage_key = profile_stage.get("key", "").lower()
        
        # Find matching shot stage (by name, case-insensitive)
        shot_stage_data = None
        for shot_stage_name, data in shot_stages.items():
            if shot_stage_name.lower().strip() == stage_name.lower().strip():
                shot_stage_data = data
                executed_stages.add(stage_name)
                break
        
        analysis = _analyze_stage_execution(profile_stage, shot_stage_data, total_time)
        stage_analyses.append(analysis)
        
        # Track unreached
        if not analysis["executed"]:
            unreached_stages.append(stage_name)
        
        # Track preinfusion time
        name_lower = stage_name.lower()
        is_preinfusion = any(kw in name_lower for kw in PREINFUSION_KEYWORDS) or \
                         any(kw in stage_key for kw in ['preinfusion', 'bloom', 'soak', 'fill'])
        
        if is_preinfusion and shot_stage_data:
            preinfusion_time += shot_stage_data.get("duration", 0)
            preinfusion_stages.append({
                "name": stage_name,
                "duration": shot_stage_data.get("duration", 0),
                "start_weight": shot_stage_data.get("start_weight", 0),
                "end_weight": shot_stage_data.get("end_weight", 0),
                "max_flow": shot_stage_data.get("max_flow", 0),
                "avg_flow": shot_stage_data.get("avg_flow", 0),
                "exit_triggers": profile_stage.get("exit_triggers", [])
            })
    
    # Preinfusion analysis
    preinfusion_proportion = (preinfusion_time / total_time * 100) if total_time > 0 else 0
    
    # Calculate total weight accumulated during preinfusion
    preinfusion_weight = 0
    for pi_stage in preinfusion_stages:
        # Weight gained in this stage
        stage_weight_gain = pi_stage["end_weight"] - pi_stage["start_weight"]
        preinfusion_weight += max(0, stage_weight_gain)
    
    # Preinfusion weight analysis
    preinfusion_weight_percent = (preinfusion_weight / final_weight * 100) if final_weight > 0 else 0
    preinfusion_issues = []
    preinfusion_recommendations = []
    
    if preinfusion_weight_percent > 10:
        preinfusion_issues.append({
            "type": "excessive_preinfusion_volume",
            "severity": "warning" if preinfusion_weight_percent <= 15 else "concern",
            "message": f"Pre-infusion accounted for {preinfusion_weight_percent:.1f}% of total shot volume (target: ≤10%)",
            "detail": f"{preinfusion_weight:.1f}g of {final_weight:.1f}g total"
        })
        
        # Check for high flow during preinfusion
        max_preinfusion_flow = max((s["max_flow"] for s in preinfusion_stages), default=0)
        avg_preinfusion_flow = sum(s["avg_flow"] for s in preinfusion_stages) / len(preinfusion_stages) if preinfusion_stages else 0
        
        if max_preinfusion_flow > 2.0 or avg_preinfusion_flow > 1.0:
            preinfusion_issues.append({
                "type": "high_preinfusion_flow",
                "severity": "warning",
                "message": f"High flow during pre-infusion (max: {max_preinfusion_flow:.1f} ml/s, avg: {avg_preinfusion_flow:.1f} ml/s)",
                "detail": "May indicate grind is too coarse"
            })
            preinfusion_recommendations.append("Consider using a finer grind to slow early flow")
        
        # Check if exit triggers include weight/flow protection
        has_weight_exit = False
        has_flow_exit = False
        for pi_stage in preinfusion_stages:
            for trigger in pi_stage.get("exit_triggers", []):
                trigger_type = trigger.get("type", "") if isinstance(trigger, dict) else ""
                if "weight" in trigger_type.lower():
                    has_weight_exit = True
                if "flow" in trigger_type.lower():
                    has_flow_exit = True
        
        if not has_weight_exit and not has_flow_exit:
            preinfusion_recommendations.append("Consider adding a weight or flow exit trigger to pre-infusion stages to prevent excessive early volume")
        elif not has_weight_exit:
            preinfusion_recommendations.append("Consider adding a weight-based exit trigger to limit pre-infusion volume")
    
    return {
        "shot_summary": {
            "final_weight": round(final_weight, 1),
            "target_weight": round(target_weight, 1) if target_weight else None,
            "total_time": round(total_time, 1),
            "max_pressure": round(max_pressure, 1),
            "max_flow": round(max_flow, 1)
        },
        "weight_analysis": {
            "status": weight_status,
            "target": round(target_weight, 1) if target_weight else None,
            "actual": round(final_weight, 1),
            "deviation_percent": round(weight_deviation, 1)
        },
        "stage_analyses": stage_analyses,
        "unreached_stages": unreached_stages,
        "preinfusion_summary": {
            "stages": [s["name"] for s in preinfusion_stages],
            "total_time": round(preinfusion_time, 1),
            "proportion_of_shot": round(preinfusion_proportion, 1),
            "weight_accumulated": round(preinfusion_weight, 1),
            "weight_percent_of_total": round(preinfusion_weight_percent, 1),
            "issues": preinfusion_issues,
            "recommendations": preinfusion_recommendations
        },
        "profile_info": {
            "name": profile_data.get("name", "Unknown"),
            "temperature": profile_data.get("temperature"),
            "stage_count": len(profile_stages)
        }
    }


@app.post("/api/shots/analyze")
async def analyze_shot(
    request: Request,
    profile_name: str = Form(...),
    shot_date: str = Form(...),
    shot_filename: str = Form(...),
    profile_description: Optional[str] = Form(None)
):
    """Analyze a shot against its profile using local algorithmic analysis.
    
    This endpoint fetches the shot data and profile information, then performs
    a detailed comparison of actual execution vs profile intent.
    
    Args:
        profile_name: Name of the profile used for the shot
        shot_date: Date of the shot (YYYY-MM-DD)
        shot_filename: Filename of the shot
        profile_description: Optional description of the profile's intent (for future AI use)
        
    Returns:
        Detailed analysis of shot performance against profile
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Starting shot analysis",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename
            }
        )
        
        # Fetch shot data
        shot_data = await fetch_shot_data(shot_date, shot_filename)
        
        # Fetch profile from machine
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        profile_data = None
        for partial_profile in profiles_result:
            if partial_profile.name.lower() == profile_name.lower():
                full_profile = api.get_profile(partial_profile.id)
                if not (hasattr(full_profile, 'error') and full_profile.error):
                    # Convert profile object to dict
                    profile_data = {
                        "name": full_profile.name,
                        "temperature": getattr(full_profile, 'temperature', None),
                        "final_weight": getattr(full_profile, 'final_weight', None),
                        "stages": []
                    }
                    
                    # Extract full stage data including dynamics and triggers
                    if hasattr(full_profile, 'stages') and full_profile.stages:
                        for stage in full_profile.stages:
                            stage_dict = {
                                "name": getattr(stage, 'name', 'Unknown'),
                                "key": getattr(stage, 'key', ''),
                                "type": getattr(stage, 'type', 'unknown'),
                            }
                            # Add dynamics
                            for attr in ['dynamics_points', 'dynamics_over', 'dynamics_interpolation']:
                                val = getattr(stage, attr, None)
                                if val is not None:
                                    stage_dict[attr] = val
                            # Add exit triggers and limits
                            for attr in ['exit_triggers', 'limits']:
                                val = getattr(stage, attr, None)
                                if val is not None:
                                    # Convert to list of dicts if needed
                                    if isinstance(val, list):
                                        stage_dict[attr] = [
                                            dict(item) if hasattr(item, '__dict__') else item
                                            for item in val
                                        ]
                                    else:
                                        stage_dict[attr] = val
                            profile_data["stages"].append(stage_dict)
                break
        
        if not profile_data:
            # Fallback: try to get profile from shot data itself
            shot_profile = shot_data.get("profile", {})
            if shot_profile:
                profile_data = shot_profile
            else:
                raise HTTPException(
                    status_code=404,
                    detail=f"Profile '{profile_name}' not found on machine or in shot data"
                )
        
        # Perform local analysis
        analysis = _perform_local_shot_analysis(shot_data, profile_data)
        
        logger.info(
            "Shot analysis completed successfully",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "stages_analyzed": len(analysis.get("stage_analyses", [])),
                "unreached_stages": len(analysis.get("unreached_stages", []))
            }
        )
        
        return {
            "status": "success",
            "analysis": analysis
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Shot analysis failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename,
                "error_type": type(e).__name__
            }
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Shot analysis failed"}
        )


# ============================================================================
# Profile Import Endpoints
# ============================================================================

@app.get("/api/machine/profiles")
async def list_machine_profiles(request: Request):
    """List all profiles from the Meticulous machine with full details.
    
    Returns profiles that are on the machine but may not be in the MeticAI history.
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching all profiles from machine",
            extra={"request_id": request_id}
        )
        
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        if hasattr(profiles_result, 'error') and profiles_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profiles_result.error}"
            )
        
        profiles = []
        for partial_profile in profiles_result:
            try:
                full_profile = api.get_profile(partial_profile.id)
                if hasattr(full_profile, 'error') and full_profile.error:
                    continue
                
                # Check if this profile exists in our history
                in_history = False
                try:
                    if HISTORY_FILE.exists():
                        with open(HISTORY_FILE, 'r') as f:
                            history = json.load(f)
                            # History is a list, not a dict
                            entries = history if isinstance(history, list) else history.get("entries", [])
                            in_history = any(
                                entry.get("profile_name") == full_profile.name 
                                for entry in entries
                            )
                except Exception:
                    pass
                
                # Convert profile to dict
                profile_dict = {
                    "id": full_profile.id,
                    "name": full_profile.name,
                    "author": getattr(full_profile, 'author', None),
                    "temperature": getattr(full_profile, 'temperature', None),
                    "final_weight": getattr(full_profile, 'final_weight', None),
                    "in_history": in_history,
                    "has_description": False,
                    "description": None
                }
                
                # Check for existing description in history
                if in_history:
                    try:
                        with open(HISTORY_FILE, 'r') as f:
                            history = json.load(f)
                            entries = history if isinstance(history, list) else history.get("entries", [])
                            for entry in entries:
                                if entry.get("profile_name") == full_profile.name:
                                    if entry.get("reply"):
                                        profile_dict["has_description"] = True
                                    break
                    except Exception:
                        pass
                
                profiles.append(profile_dict)
            except Exception as e:
                logger.warning(
                    f"Failed to fetch profile {partial_profile.name}: {e}",
                    extra={"request_id": request_id}
                )
        
        logger.info(
            f"Found {len(profiles)} profiles on machine",
            extra={"request_id": request_id, "profile_count": len(profiles)}
        )
        
        return {
            "status": "success",
            "profiles": profiles,
            "total": len(profiles)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to list machine profiles: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@app.get("/api/machine/profile/{profile_id}/json")
async def get_machine_profile_json(profile_id: str, request: Request):
    """Get the full profile JSON from the Meticulous machine.
    
    Args:
        profile_id: The profile ID to fetch
        
    Returns:
        Full profile JSON suitable for export/import
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            f"Fetching profile JSON: {profile_id}",
            extra={"request_id": request_id, "profile_id": profile_id}
        )
        
        api = get_meticulous_api()
        profile = api.get_profile(profile_id)
        
        if hasattr(profile, 'error') and profile.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {profile.error}"
            )
        
        # Convert to dict for JSON serialization
        profile_json = {}
        for attr in ['id', 'name', 'author', 'temperature', 'final_weight', 'stages', 
                     'variables', 'display', 'isDefault', 'source', 'beverage_type',
                     'tank_temperature']:
            if hasattr(profile, attr):
                val = getattr(profile, attr)
                if val is not None:
                    # Handle nested objects
                    if hasattr(val, '__dict__'):
                        profile_json[attr] = val.__dict__
                    elif isinstance(val, list):
                        profile_json[attr] = [
                            item.__dict__ if hasattr(item, '__dict__') else item 
                            for item in val
                        ]
                    else:
                        profile_json[attr] = val
        
        return {
            "status": "success",
            "profile": profile_json
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile JSON: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@app.post("/api/profile/import")
async def import_profile(request: Request):
    """Import a profile into the MeticAI history.
    
    The profile can come from:
    - A JSON file upload
    - A profile already on the machine (by ID)
    
    If the profile has no description, it will be sent to the LLM for analysis.
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        profile_json = body.get("profile")
        generate_description = body.get("generate_description", True)
        source = body.get("source", "file")  # "file" or "machine"
        
        if not profile_json:
            raise HTTPException(status_code=400, detail="No profile JSON provided")
        
        profile_name = profile_json.get("name", "Imported Profile")
        
        logger.info(
            f"Importing profile: {profile_name}",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "source": source,
                "generate_description": generate_description
            }
        )
        
        # Check if profile already exists in history
        existing_entry = None
        if HISTORY_FILE.exists():
            with open(HISTORY_FILE, 'r') as f:
                history = json.load(f)
                # History is a list, not a dict
                entries = history if isinstance(history, list) else history.get("entries", [])
                for entry in entries:
                    if entry.get("profile_name") == profile_name:
                        existing_entry = entry
                        break
        
        if existing_entry:
            return {
                "status": "exists",
                "message": f"Profile '{profile_name}' already exists in history",
                "entry_id": existing_entry.get("id")
            }
        
        # Generate description if requested
        reply = None
        if generate_description:
            try:
                reply = await _generate_profile_description(profile_json, request_id)
            except Exception as e:
                logger.warning(
                    f"Failed to generate description: {e}",
                    extra={"request_id": request_id}
                )
                reply = f"Profile imported from {source}. Description generation failed."
        else:
            reply = f"Profile imported from {source}."
        
        # Create history entry
        entry_id = str(uuid.uuid4())
        timestamp = datetime.now().isoformat()
        
        new_entry = {
            "id": entry_id,
            "timestamp": timestamp,
            "profile_name": profile_name,
            "user_preferences": f"Imported from {source}",
            "reply": reply,
            "profile_json": profile_json,
            "imported": True,
            "import_source": source
        }
        
        # Save to history - history is a list
        if HISTORY_FILE.exists():
            with open(HISTORY_FILE, 'r') as f:
                history = json.load(f)
                # Ensure it's a list
                if not isinstance(history, list):
                    history = history.get("entries", [])
        else:
            history = []
        
        history.insert(0, new_entry)
        
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=2)
        
        logger.info(
            f"Profile imported successfully: {profile_name}",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        return {
            "status": "success",
            "entry_id": entry_id,
            "profile_name": profile_name,
            "has_description": reply is not None and "Description generation failed" not in reply
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to import profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
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


@app.post("/api/profile/convert-description")
async def convert_profile_description(request: Request):
    """Convert an existing profile description to the standard MeticAI format.
    
    Takes a profile with an existing description and reformats it while
    preserving all original information.
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        profile_json = body.get("profile")
        existing_description = body.get("description", "")
        
        if not profile_json:
            raise HTTPException(status_code=400, detail="No profile JSON provided")
        
        profile_name = profile_json.get("name", "Unknown Profile")
        
        logger.info(
            f"Converting description for profile: {profile_name}",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        
        prompt = f"""Analyze this Meticulous Espresso profile and convert its description to the standard MeticAI format.

IMPORTANT: Preserve ALL information from the original description. Do not lose any details - only reformat them.

PROFILE JSON:
```json
{json.dumps(profile_json, indent=2)}
```

ORIGINAL DESCRIPTION:
{existing_description}

Convert to this exact format while preserving all original information:

Profile Created: {profile_name}

Description:
[Preserve the original description's key points and add technical insights from the profile JSON]

Preparation:
• Dose: [From original or profile settings]
• Grind: [From original or recommend based on profile]
• Temperature: [From profile: {profile_json.get('temperature', 'Not specified')}°C]
• Target Yield: [From profile: {profile_json.get('final_weight', 'Not specified')}g]
• Expected Time: [Calculate from stages if possible]

Why This Works:
[Combine original explanation with technical analysis of the profile stages]

Special Notes:
[Preserve any special notes from original, add any additional insights]

Remember: NO information should be lost in this conversion!"""

        model = get_vision_model()
        response = model.generate_content(prompt)
        converted_description = response.text.strip()
        
        # Update the history entry if it exists
        entry_id = body.get("entry_id")
        if entry_id:
            if HISTORY_FILE.exists():
                with open(HISTORY_FILE, 'r') as f:
                    history = json.load(f)
                
                # History is a list, not a dict
                entries = history if isinstance(history, list) else history.get("entries", [])
                for entry in entries:
                    if entry.get("id") == entry_id:
                        entry["reply"] = converted_description
                        entry["description_converted"] = True
                        break
                
                with open(HISTORY_FILE, 'w') as f:
                    json.dump(history, f, indent=2)
        
        logger.info(
            f"Description converted successfully for: {profile_name}",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "converted_description": converted_description
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to convert description: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )

