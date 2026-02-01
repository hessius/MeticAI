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
import tempfile
import re
from logging_config import setup_logging, get_logger

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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def deep_convert_to_dict(obj):
    """Recursively convert an object with __dict__ to a JSON-serializable dict.
    
    Handles nested objects, lists, and special types that can't be directly serialized.
    """
    if obj is None:
        return None
    elif isinstance(obj, (str, int, float, bool)):
        return obj
    elif isinstance(obj, dict):
        return {k: deep_convert_to_dict(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [deep_convert_to_dict(item) for item in obj]
    elif hasattr(obj, '__dict__'):
        return {k: deep_convert_to_dict(v) for k, v in obj.__dict__.items() 
                if not k.startswith('_')}
    else:
        # For other types, try to convert to string as fallback
        try:
            return str(obj)
        except Exception:
            return None


def atomic_write_json(filepath: Path, data, indent: int = 2):
    """Write JSON data to a file atomically to prevent corruption.
    
    Writes to a temporary file first, then renames it to the target path.
    This ensures the file is never left in a partially-written state.
    """
    import tempfile as tf
    
    # Serialize the data first to catch any serialization errors before writing
    json_str = json.dumps(data, indent=indent, default=str)
    
    # Write to a temporary file in the same directory
    temp_fd, temp_path = tf.mkstemp(
        dir=filepath.parent, 
        prefix=f'.{filepath.name}.', 
        suffix='.tmp'
    )
    try:
        with os.fdopen(temp_fd, 'w') as f:
            f.write(json_str)
        # Atomic rename
        os.rename(temp_path, filepath)
    except Exception:
        # Clean up temp file on failure
        try:
            os.unlink(temp_path)
        except Exception:
            pass
        raise


# Data directory configuration - use environment variable or default
# In test mode, use temporary directory to avoid permission issues
TEST_MODE = os.environ.get("TEST_MODE") == "true"
if TEST_MODE:
    DATA_DIR = Path(tempfile.gettempdir()) / "meticai_test_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
else:
    DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))

# Update check interval: 2 hours in seconds
UPDATE_CHECK_INTERVAL = 7200

# Maximum upload file size: 10 MB
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB in bytes

# Regex pattern for extracting version from pyproject.toml or setup.py
# Matches: version = "x.y.z" or version = 'x.y.z'
# Pre-compiled for better performance when called repeatedly
VERSION_PATTERN = re.compile(r'^\s*version\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)


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
    "• USER PREFERENCES ARE MANDATORY: If the user specifies a dose, grind, temperature, ratio, or any other parameter, you MUST use EXACTLY that value. Do NOT override with defaults.\n"
    "• Examples: If user says '20g dose' → use 20g, NOT 18g. If user says '94°C' → use 94°C. If user says '1:2.5 ratio' → calculate output accordingly.\n"
    "• Only use standard defaults (18g dose, 93°C, etc.) when the user has NOT specified a preference.\n"
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


def get_author_instruction() -> str:
    """Get the author instruction for profile creation prompts."""
    author = get_author_name()
    return (
        f"AUTHOR:\n"
        f"• Set the 'author' field in the profile JSON to: \"{author}\"\n"
        f"• This name will appear as the profile creator on the Meticulous device\n\n"
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
        
        # Get author instruction with configured name
        author_instruction = get_author_instruction()
        
        # Construct the profile creation prompt
        if coffee_analysis and user_prefs:
            # Both image and preferences provided
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n"
                f"Coffee Analysis: '{coffee_analysis}'\n\n"
                f"⚠️ MANDATORY USER REQUIREMENTS (MUST BE FOLLOWED EXACTLY):\n"
                f"'{user_prefs}'\n"
                f"You MUST honor ALL parameters specified above. If the user requests a specific dose, temperature, ratio, or any other value, use EXACTLY that value in your profile. Do NOT substitute with defaults.\n\n"
                f"TASK: Create a sophisticated espresso profile based on the coffee analysis while strictly adhering to the user's requirements above.\n\n" +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                author_instruction +
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
                author_instruction +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT
            )
        else:
            # Only user preferences provided
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n\n"
                f"⚠️ MANDATORY USER REQUIREMENTS (MUST BE FOLLOWED EXACTLY):\n"
                f"'{user_prefs}'\n"
                f"You MUST honor ALL parameters specified above. If the user requests a specific dose, temperature, ratio, or any other value, use EXACTLY that value in your profile. Do NOT substitute with defaults.\n\n"
                "TASK: Create a sophisticated espresso profile while strictly adhering to the user's requirements above.\n\n" +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                author_instruction +
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

@app.post("/api/check-updates")
async def check_updates(request: Request):
    """Trigger a fresh update check by signaling the host-side watcher.
    
    This endpoint creates a flag file that the host-side watcher script detects
    and runs the actual git fetch. Since git operations can't run properly inside
    the container (no access to sub-repo .git directories), we delegate to the host.
    
    Returns:
        - update_available: Whether updates are available for any component
        - last_check: Timestamp of this check
        - repositories: Status of each repository (main, mcp, web)
        - fresh_check: True if this was a fresh check
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Triggering fresh update check via host signal",
            extra={"request_id": request_id, "endpoint": "/api/check-updates"}
        )
        
        # Get the current timestamp from .versions.json before signaling
        version_file_path = Path("/app/.versions.json")
        old_check_time = None
        if version_file_path.exists():
            try:
                with open(version_file_path, 'r') as f:
                    old_data = json.load(f)
                    old_check_time = old_data.get("last_check")
            except Exception:
                pass
        
        # Create signal file for host-side watcher
        signal_path = Path("/app/.update-check-requested")
        signal_path.write_text(f"requested_at: {datetime.utcnow().isoformat()}\n")
        
        logger.info(
            "Update check signal created, waiting for host to process",
            extra={"request_id": request_id}
        )
        
        # Wait for host to process the signal (poll for up to 30 seconds)
        max_wait = 30
        poll_interval = 0.5
        waited = 0
        
        while waited < max_wait:
            await asyncio.sleep(poll_interval)
            waited += poll_interval
            
            # Check if signal file was removed (host processed it)
            if not signal_path.exists():
                break
            
            # Check if .versions.json was updated
            if version_file_path.exists():
                try:
                    with open(version_file_path, 'r') as f:
                        current_data = json.load(f)
                        new_check_time = current_data.get("last_check")
                        if new_check_time and new_check_time != old_check_time:
                            # Versions file was updated
                            break
                except Exception:
                    pass
        
        # Clean up signal file if it still exists
        try:
            signal_path.unlink(missing_ok=True)
        except Exception:
            pass
        
        # Read the versions file
        if version_file_path.exists():
            with open(version_file_path, 'r') as f:
                version_data = json.load(f)
                new_check_time = version_data.get("last_check")
                was_updated = new_check_time != old_check_time
                
                return {
                    "update_available": version_data.get("update_available", False),
                    "last_check": new_check_time,
                    "repositories": version_data.get("repositories", {}),
                    "fresh_check": was_updated
                }
        else:
            return {
                "update_available": False,
                "error": "Version file not found",
                "message": "No version information available"
            }
            
    except Exception as e:
        logger.error(
            f"Failed to check for updates: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        return {
            "update_available": False,
            "error": str(e),
            "message": "Failed to check for updates"
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
    
    This endpoint writes a timestamp to /app/.update-requested which is mounted
    from the host. The host's systemd/launchd service (rebuild-watcher) monitors this
    file and runs update.sh --auto when it changes, which pulls updates AND rebuilds.
    
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
        
        # Signal the host to perform the full update (git pull + rebuild)
        # This file is watched by systemd/launchd on the host (rebuild-watcher.sh)
        update_signal = Path("/app/.update-requested")
        
        # Write a timestamp to trigger the file change
        import time
        update_signal.write_text(f"update-requested:{time.time()}\n")
        
        logger.info(
            "Update triggered - signaled host via .update-requested",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": "Update triggered. The host will pull updates and restart containers."
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


@app.post("/api/restart")
async def restart_system(request: Request):
    """Restart all MeticAI containers.
    
    This endpoint writes a timestamp to /app/.restart-requested which is mounted
    from the host. The host's systemd/launchd service (rebuild-watcher) monitors this
    file and restarts all containers without pulling updates.
    
    Returns:
        - status: "success" or "error"
        - message: Description of what happened
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Triggering system restart via host signal",
            extra={"request_id": request_id, "endpoint": "/api/restart"}
        )
        
        # Signal the host to restart containers
        # This file is watched by systemd/launchd on the host (rebuild-watcher.sh)
        restart_signal = Path("/app/.restart-requested")
        
        # Write a timestamp to trigger the file change
        import time
        restart_signal.write_text(f"restart-requested:{time.time()}\n")
        
        logger.info(
            "Restart triggered - signaled host via .restart-requested",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": "Restart triggered. The system will restart momentarily."
        }
    except Exception as e:
        logger.error(
            f"Failed to trigger restart: {str(e)}",
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
                "message": "Failed to signal restart"
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
# Settings Management
# ============================================

SETTINGS_FILE = DATA_DIR / "settings.json"


def _ensure_settings_file():
    """Ensure the settings file and directory exist."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        default_settings = {
            "geminiApiKey": "",
            "meticulousIp": "",
            "serverIp": "",
            "authorName": ""
        }
        SETTINGS_FILE.write_text(json.dumps(default_settings, indent=2))


def _load_settings() -> dict:
    """Load settings from file."""
    _ensure_settings_file()
    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {
            "geminiApiKey": "",
            "meticulousIp": "",
            "serverIp": "",
            "authorName": ""
        }


def _save_settings(settings: dict):
    """Save settings to file."""
    _ensure_settings_file()
    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(settings, f, indent=2)


def get_author_name() -> str:
    """Get the configured author name, defaulting to 'MeticAI' if not set."""
    settings = _load_settings()
    author = settings.get("authorName", "").strip()
    return author if author else "MeticAI"


@app.get("/api/version")
async def get_version_info(request: Request):
    """Get version information for all MeticAI components.
    
    Returns version info for:
    - MeticAI (backend)
    - MeticAI-web (frontend)
    - MCP Server
    """
    request_id = request.state.request_id
    
    try:
        # Read MeticAI version from VERSION file
        meticai_version = "unknown"
        version_file = Path(__file__).parent.parent / "VERSION"
        if version_file.exists():
            meticai_version = version_file.read_text().strip()
        
        # Read MeticAI-web version from meticai-web/VERSION
        meticai_web_version = "unknown"
        web_version_file = Path(__file__).parent.parent / "meticai-web" / "VERSION"
        if web_version_file.exists():
            meticai_web_version = web_version_file.read_text().strip()
        
        # Read MCP server version and repo URL from meticulous-source
        mcp_version = "unknown"
        mcp_repo_url = "https://github.com/manonstreet/meticulous-mcp"  # Default fallback
        mcp_source_dir = Path(__file__).parent.parent / "meticulous-source"
        
        # Try to get repo URL from .versions.json first (mounted by docker-compose)
        versions_file = Path(__file__).parent.parent / ".versions.json"
        if versions_file.exists():
            try:
                versions_data = json.loads(versions_file.read_text())
                if "repositories" in versions_data and "meticulous-mcp" in versions_data["repositories"]:
                    repo_url_from_file = versions_data["repositories"]["meticulous-mcp"].get("repo_url")
                    if repo_url_from_file and repo_url_from_file != "unknown":
                        mcp_repo_url = repo_url_from_file
            except Exception as e:
                logger.debug(
                    f"Failed to read MCP repo URL from .versions.json: {str(e)}",
                    extra={"request_id": request_id}
                )
        
        # If not found in .versions.json, try git remote from meticulous-source
        if mcp_repo_url == "https://github.com/manonstreet/meticulous-mcp" and mcp_source_dir.exists():
            git_dir = mcp_source_dir / ".git"
            if git_dir.exists():
                try:
                    # Validate that mcp_source_dir is within expected bounds to prevent path traversal
                    base_dir = Path(__file__).parent.parent.resolve()
                    resolved_mcp_dir = mcp_source_dir.resolve()
                    if not str(resolved_mcp_dir).startswith(str(base_dir)):
                        # Security: Skip subprocess call if path is outside expected bounds
                        logger.warning(
                            f"Skipping git remote check: MCP source directory is outside base directory: {resolved_mcp_dir}",
                            extra={"request_id": request_id}
                        )
                        # Explicitly skip subprocess execution for security
                        pass
                    else:
                        result = subprocess.run(
                            ["git", "config", "--get", "remote.origin.url"],
                            cwd=resolved_mcp_dir,
                            capture_output=True,
                            text=True,
                            timeout=5
                        )
                        if result.returncode == 0 and result.stdout.strip():
                            mcp_repo_url = result.stdout.strip()
                except Exception as e:
                    logger.debug(
                        f"Failed to read MCP repo URL from git remote: {str(e)}",
                        extra={"request_id": request_id}
                    )
        
        # Get MCP version from pyproject.toml
        if mcp_source_dir.exists():
            # Try to get version from pyproject.toml or setup.py
            version_found = False
            pyproject = mcp_source_dir / "pyproject.toml"
            if pyproject.exists():
                try:
                    content = pyproject.read_text()
                    # Look for version = "x.y.z" pattern in pyproject.toml
                    version_match = VERSION_PATTERN.search(content)
                    if version_match:
                        mcp_version = version_match.group(1)
                        version_found = True
                except Exception as e:
                    logger.debug(
                        f"Failed to read version from pyproject.toml: {str(e)}",
                        extra={"request_id": request_id},
                        exc_info=True
                    )
            
            # Fallback to setup.py if version not found in pyproject.toml
            if not version_found:
                setup_py = mcp_source_dir / "setup.py"
                if setup_py.exists():
                    try:
                        content = setup_py.read_text()
                        # Look for version = "x.y.z" pattern in setup.py
                        version_match = VERSION_PATTERN.search(content)
                        if version_match:
                            mcp_version = version_match.group(1)
                        else:
                            # Fallback to line-by-line parsing if regex doesn't match
                            for line in content.split('\n'):
                                if 'version' in line.lower() and '=' in line:
                                    mcp_version = line.split('=')[1].strip().strip('"').strip("'")
                                    break
                    except Exception as e:
                        logger.debug(
                            f"Failed to read version from setup.py: {str(e)}",
                            extra={"request_id": request_id},
                            exc_info=True
                        )
        
        return {
            "meticai": meticai_version,
            "meticai_web": meticai_web_version,
            "mcp_server": mcp_version,
            "mcp_repo_url": mcp_repo_url
        }
    except Exception as e:
        logger.error(
            f"Failed to get version info: {str(e)}",
            extra={"request_id": request_id},
            exc_info=True
        )
        return {
            "meticai": "unknown",
            "meticai_web": "unknown", 
            "mcp_server": "unknown",
            "mcp_repo_url": "https://github.com/manonstreet/meticulous-mcp"
        }


@app.get("/api/settings")
async def get_settings(request: Request):
    """Get current settings.
    
    Returns settings with API key masked for security.
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching settings",
            extra={"request_id": request_id, "endpoint": "/api/settings"}
        )
        
        settings = _load_settings()
        
        # Read current values from environment
        env_api_key = os.environ.get("GEMINI_API_KEY", "")
        env_meticulous_ip = os.environ.get("METICULOUS_IP", "")
        env_server_ip = os.environ.get("PI_IP", "")
        
        # Always show API key as stars if set (never expose the actual key)
        if env_api_key:
            # Show stars to indicate a key is configured
            settings["geminiApiKey"] = "*" * min(len(env_api_key), 20)
            settings["geminiApiKeyMasked"] = True
            settings["geminiApiKeyConfigured"] = True
        else:
            settings["geminiApiKeyConfigured"] = False
        
        # Always show current IP values from environment (env takes precedence)
        if env_meticulous_ip:
            settings["meticulousIp"] = env_meticulous_ip
        
        if env_server_ip:
            settings["serverIp"] = env_server_ip
        
        return settings
        
    except Exception as e:
        logger.error(
            f"Failed to fetch settings: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch settings"}
        )


@app.post("/api/settings")
async def save_settings(request: Request):
    """Save settings.
    
    Updates the settings.json file and optionally updates the .env file
    for system-level settings (requires container restart to take effect).
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        
        logger.info(
            "Saving settings",
            extra={
                "request_id": request_id,
                "endpoint": "/api/settings",
                "has_api_key": bool(body.get("geminiApiKey")),
                "has_meticulous_ip": bool(body.get("meticulousIp")),
                "has_server_ip": bool(body.get("serverIp")),
                "has_author": bool(body.get("authorName"))
            }
        )
        
        # Load current settings
        current_settings = _load_settings()
        
        # Update only provided fields
        if "authorName" in body:
            current_settings["authorName"] = body["authorName"].strip()
        
        # For IP and API key changes, also update .env file
        env_updated = False
        env_path = Path("/app/.env")
        
        # Read current .env content
        env_content = ""
        if env_path.exists():
            env_content = env_path.read_text()
        
        # Handle API key update
        if body.get("geminiApiKey") and not body.get("geminiApiKeyMasked"):
            new_api_key = body["geminiApiKey"].strip()
            if new_api_key and "..." not in new_api_key:  # Not a masked value
                current_settings["geminiApiKey"] = new_api_key
                # Update .env file
                if "GEMINI_API_KEY=" in env_content:
                    import re
                    env_content = re.sub(
                        r'GEMINI_API_KEY=.*',
                        f'GEMINI_API_KEY={new_api_key}',
                        env_content
                    )
                else:
                    env_content += f"\nGEMINI_API_KEY={new_api_key}"
                env_updated = True
        
        # Handle Meticulous IP update
        if body.get("meticulousIp"):
            new_ip = body["meticulousIp"].strip()
            current_settings["meticulousIp"] = new_ip
            if "METICULOUS_IP=" in env_content:
                import re
                env_content = re.sub(
                    r'METICULOUS_IP=.*',
                    f'METICULOUS_IP={new_ip}',
                    env_content
                )
            else:
                env_content += f"\nMETICULOUS_IP={new_ip}"
            env_updated = True
        
        # Handle Server IP update
        if body.get("serverIp"):
            new_ip = body["serverIp"].strip()
            current_settings["serverIp"] = new_ip
            if "PI_IP=" in env_content:
                import re
                env_content = re.sub(
                    r'PI_IP=.*',
                    f'PI_IP={new_ip}',
                    env_content
                )
            else:
                env_content += f"\nPI_IP={new_ip}"
            env_updated = True
        
        # Save settings to JSON file
        _save_settings(current_settings)
        
        # Write .env file if updated (note: may fail if read-only mount)
        if env_updated:
            try:
                env_path.write_text(env_content)
                logger.info("Updated .env file", extra={"request_id": request_id})
            except PermissionError:
                logger.warning(
                    ".env file is read-only, changes saved to settings.json only",
                    extra={"request_id": request_id}
                )
        
        return {
            "status": "success",
            "message": "Settings saved successfully",
            "env_updated": env_updated
        }
        
    except Exception as e:
        logger.error(
            f"Failed to save settings: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to save settings"}
        )


# ============================================
# Profile History Management
# ============================================

HISTORY_FILE = DATA_DIR / "profile_history.json"


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
# LLM Analysis Cache Management  
# ============================================

LLM_CACHE_FILE = DATA_DIR / "llm_analysis_cache.json"
LLM_CACHE_TTL_SECONDS = 3 * 24 * 60 * 60  # 3 days


def _ensure_llm_cache_file():
    """Ensure the LLM cache file and directory exist."""
    LLM_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not LLM_CACHE_FILE.exists():
        LLM_CACHE_FILE.write_text("{}")


def _load_llm_cache() -> dict:
    """Load LLM analysis cache from file."""
    _ensure_llm_cache_file()
    try:
        return json.loads(LLM_CACHE_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        return {}


def _save_llm_cache(cache: dict):
    """Save LLM analysis cache to file."""
    _ensure_llm_cache_file()
    LLM_CACHE_FILE.write_text(json.dumps(cache, indent=2))


def _get_llm_cache_key(profile_name: str, shot_date: str, shot_filename: str) -> str:
    """Generate a cache key for LLM analysis."""
    return f"{profile_name}_{shot_date}_{shot_filename}"


def get_cached_llm_analysis(profile_name: str, shot_date: str, shot_filename: str) -> Optional[str]:
    """Get cached LLM analysis if it exists and is not expired."""
    cache = _load_llm_cache()
    key = _get_llm_cache_key(profile_name, shot_date, shot_filename)
    
    if key in cache:
        entry = cache[key]
        timestamp = entry.get("timestamp", 0)
        now = time.time()
        
        if now - timestamp < LLM_CACHE_TTL_SECONDS:
            return entry.get("analysis")
        else:
            # Expired - remove from cache
            del cache[key]
            _save_llm_cache(cache)
    
    return None


def save_llm_analysis_to_cache(profile_name: str, shot_date: str, shot_filename: str, analysis: str):
    """Save LLM analysis to cache."""
    cache = _load_llm_cache()
    key = _get_llm_cache_key(profile_name, shot_date, shot_filename)
    
    cache[key] = {
        "analysis": analysis,
        "timestamp": time.time(),
        "profile_name": profile_name,
        "shot_date": shot_date,
        "shot_filename": shot_filename
    }
    
    _save_llm_cache(cache)


# ============================================
# Shot History Cache Management
# ============================================

SHOT_CACHE_FILE = DATA_DIR / "shot_cache.json"
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

IMAGE_CACHE_DIR = DATA_DIR / "image_cache"


def _sanitize_profile_name_for_filename(profile_name: str) -> str:
    """Safely sanitize profile name for use in filenames.
    
    Args:
        profile_name: The profile name to sanitize
        
    Returns:
        A safe filename string
        
    Note:
        This prevents path traversal attacks by removing/replacing
        all potentially dangerous characters.
    """
    import re
    # Remove any path separators and parent directory references
    safe_name = profile_name.replace('/', '_').replace('\\', '_').replace('..', '_')
    # Keep only alphanumeric, spaces, hyphens, and underscores
    safe_name = re.sub(r'[^a-zA-Z0-9\s\-_]', '_', safe_name)
    # Replace spaces with underscores and convert to lowercase
    safe_name = safe_name.replace(' ', '_').lower()
    # Limit length to prevent filesystem issues
    return safe_name[:200]


def _ensure_image_cache_dir():
    """Ensure the image cache directory exists."""
    IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _get_cached_image(profile_name: str) -> Optional[bytes]:
    """Get cached image for a profile if it exists.
    
    Returns the image bytes or None if not cached.
    """
    _ensure_image_cache_dir()
    safe_name = _sanitize_profile_name_for_filename(profile_name)
    cache_file = IMAGE_CACHE_DIR / f"{safe_name}.png"
    
    # Security check: ensure the resolved path is still within IMAGE_CACHE_DIR
    try:
        cache_file_resolved = cache_file.resolve()
        if not str(cache_file_resolved).startswith(str(IMAGE_CACHE_DIR.resolve())):
            logger.warning(f"Path traversal attempt detected for profile: {profile_name}")
            return None
    except Exception as e:
        logger.warning(f"Failed to resolve cache path for {profile_name}: {e}")
        return None
    
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
    safe_name = _sanitize_profile_name_for_filename(profile_name)
    cache_file = IMAGE_CACHE_DIR / f"{safe_name}.png"
    
    # Security check: ensure the resolved path is still within IMAGE_CACHE_DIR
    try:
        cache_file_resolved = cache_file.resolve()
        if not str(cache_file_resolved).startswith(str(IMAGE_CACHE_DIR.resolve())):
            logger.warning(f"Path traversal attempt detected for profile: {profile_name}")
            return
    except Exception as e:
        logger.warning(f"Failed to resolve cache path for {profile_name}: {e}")
        return
    
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


@app.post("/api/profile/{profile_name:path}/image")
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
        
        # Read image data with size limit
        image_data = await file.read()
        
        # Validate file size
        if len(image_data) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"Image too large. Maximum size is {MAX_UPLOAD_SIZE / (1024*1024):.0f}MB"
            )
        
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


@app.post("/api/profile/{profile_name:path}/generate-image")
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
        
        # Validate prompt_result to avoid NoneType subscript errors
        if not prompt_result or not isinstance(prompt_result, dict):
            logger.error(
                "Failed to build image prompt - prompt_result is invalid",
                extra={
                    "request_id": request_id,
                    "prompt_result": prompt_result
                }
            )
            raise HTTPException(
                status_code=500,
                detail="Failed to build image generation prompt"
            )
        
        full_prompt = prompt_result.get("prompt", "")
        prompt_metadata = prompt_result.get("metadata", {})
        
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
        import shutil
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Execute image generation via gemini CLI
            # The prompt should ask to generate an image directly
            image_prompt = f"generate an image: {full_prompt}"
            result = subprocess.run(
                [
                    "docker", "exec", "-i", "gemini-client",
                    "gemini", "-y", image_prompt
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
            # nanobanana saves to /nanobanana-output/ (not /root/nanobanana-output/)
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
                    ["docker", "exec", "gemini-client", "ls", "-t", "/nanobanana-output/"],
                    capture_output=True,
                    text=True
                )
                if list_result.returncode == 0 and list_result.stdout.strip():
                    newest_file = list_result.stdout.strip().split('\n')[0]
                    image_path = f"/nanobanana-output/{newest_file}"
            
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


@app.post("/api/profile/{profile_name:path}/apply-image")
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
        from PIL import Image as PILImage
        try:
            # Format: data:image/png;base64,<data>
            header, b64_data = image_data_uri.split(',', 1)
            png_bytes = base64.b64decode(b64_data)
            
            # Validate decoded size
            if len(png_bytes) > MAX_UPLOAD_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail=f"Decoded image too large. Maximum size is {MAX_UPLOAD_SIZE / (1024*1024):.0f}MB"
                )
            
            # Validate it's actually a valid PNG image
            try:
                img = PILImage.open(io.BytesIO(png_bytes))
                img.verify()  # Verify it's a valid image
                # Re-open since verify() closes the file
                img = PILImage.open(io.BytesIO(png_bytes))
                if img.format != 'PNG':
                    raise HTTPException(
                        status_code=400,
                        detail=f"Expected PNG format, got {img.format}"
                    )
            except HTTPException:
                raise
            except Exception as img_err:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid image data: {str(img_err)}"
                )
            
            _set_cached_image(profile_name, png_bytes)
        except HTTPException:
            # Re-raise HTTP exceptions to preserve the status code and error message
            # that was specifically created for the API client
            raise
        except Exception as e:
            logger.warning(f"Failed to process/cache image from apply-image: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to decode image data: {str(e)}"
            )
        
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


def _resolve_variable(value, variables: list) -> tuple[any, str | None]:
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
    min_pressure = _safe_float(stage_data.get("min_pressure", 0))
    end_pressure = _safe_float(stage_data.get("end_pressure", 0))
    # Flow values for different comparison types
    max_flow = _safe_float(stage_data.get("max_flow", 0))
    min_flow = _safe_float(stage_data.get("min_flow", 0))
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


def _analyze_stage_execution(
    profile_stage: dict,
    shot_stage_data: dict | None,
    total_shot_duration: float,
    variables: list | None = None
) -> dict:
    """Analyze how a single stage executed compared to its profile definition."""
    variables = variables or []
    stage_name = profile_stage.get("name", "Unknown")
    stage_type = profile_stage.get("type", "unknown")
    stage_key = profile_stage.get("key", "")
    
    # Build profile target description
    dynamics_desc = _format_dynamics_description(profile_stage)
    exit_triggers = _format_exit_triggers(profile_stage.get("exit_triggers", []), variables)
    limits = _format_limits(profile_stage.get("limits", []), variables)
    
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
    duration = _safe_float(shot_stage_data.get("duration", 0))
    start_weight = _safe_float(shot_stage_data.get("start_weight", 0))
    end_weight = _safe_float(shot_stage_data.get("end_weight", 0))
    weight_gain = end_weight - start_weight
    start_pressure = _safe_float(shot_stage_data.get("start_pressure", 0))
    end_pressure = _safe_float(shot_stage_data.get("end_pressure", 0))
    avg_pressure = _safe_float(shot_stage_data.get("avg_pressure", 0))
    max_pressure = _safe_float(shot_stage_data.get("max_pressure", 0))
    min_pressure = _safe_float(shot_stage_data.get("min_pressure", 0))
    start_flow = _safe_float(shot_stage_data.get("start_flow", 0))
    end_flow = _safe_float(shot_stage_data.get("end_flow", 0))
    avg_flow = _safe_float(shot_stage_data.get("avg_flow", 0))
    max_flow = _safe_float(shot_stage_data.get("max_flow", 0))
    
    # Generate execution description based on what actually happened
    execution_description = _generate_execution_description(
        stage_type, duration, 
        start_pressure, end_pressure, max_pressure,
        start_flow, end_flow, max_flow,
        weight_gain
    )
    
    result["execution_data"] = {
        "duration": round(duration, 1),
        "weight_gain": round(weight_gain, 1),
        "start_weight": round(start_weight, 1),
        "end_weight": round(end_weight, 1),
        "start_pressure": round(start_pressure, 1),
        "end_pressure": round(end_pressure, 1),
        "avg_pressure": round(avg_pressure, 1),
        "max_pressure": round(max_pressure, 1),
        "min_pressure": round(min_pressure, 1),
        "start_flow": round(start_flow, 1),
        "end_flow": round(end_flow, 1),
        "avg_flow": round(avg_flow, 1),
        "max_flow": round(max_flow, 1),
        "description": execution_description
    }
    
    # Determine which exit trigger was hit
    if profile_stage.get("exit_triggers"):
        exit_result = _determine_exit_trigger_hit(
            shot_stage_data,
            profile_stage.get("exit_triggers", []),
            variables=variables
        )
        result["exit_trigger_result"] = exit_result
    
    # Check if any limits were hit
    stage_limits = profile_stage.get("limits", [])
    for limit in stage_limits:
        limit_type = limit.get("type", "")
        raw_limit_value = limit.get("value", 0)
        
        # Resolve variable reference if present
        resolved_limit_value, _ = _resolve_variable(raw_limit_value, variables)
        limit_value = _safe_float(resolved_limit_value)
        
        actual = 0.0
        if limit_type == "flow":
            actual = max_flow
        elif limit_type == "pressure":
            actual = max_pressure
        elif limit_type == "time":
            actual = duration
        elif limit_type == "weight":
            actual = end_weight
        
        # Check if limit was hit (within small tolerance)
        unit = {"time": "s", "weight": "g", "pressure": "bar", "flow": "ml/s"}.get(limit_type, "")
        if actual >= limit_value - 0.2:
            result["limit_hit"] = {
                "type": limit_type,
                "limit_value": limit_value,
                "actual_value": round(actual, 1),
                "description": f"Hit {limit_type} limit of {limit_value}{unit}"
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


# Shot stage status constants
STAGE_STATUS_RETRACTING = "retracting"


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


def _generate_profile_target_curves(profile_data: dict, shot_stage_times: dict, shot_data: dict) -> list[dict]:
    """Generate target curves for profile overlay on shot chart.
    
    Creates data points representing what the profile was targeting at each time point.
    Uses actual shot stage times to align the profile curves with the shot execution.
    Supports both time-based and weight-based dynamics.
    
    Args:
        profile_data: The profile configuration
        shot_stage_times: Dict mapping stage names to (start_time, end_time) tuples
        shot_data: The complete shot data including telemetry entries
        
    Returns:
        List of data points: [{time, target_pressure, target_flow, stage_name}, ...]
    """
    stages = profile_data.get("stages", [])
    variables = profile_data.get("variables", [])
    data_points = []
    
    # Build weight-to-time mappings for each stage from shot data
    # This enables weight-based dynamics interpolation
    stage_weight_to_time = {}
    data_entries = shot_data.get("data", [])
    
    for entry in data_entries:
        status = entry.get("status", "")
        if not status or status.lower().strip() == STAGE_STATUS_RETRACTING:
            continue
        
        time_sec = entry.get("time", 0) / 1000  # Convert to seconds
        weight = entry.get("shot", {}).get("weight", 0)
        
        # Normalize stage name for matching
        normalized_status = status.lower().strip()
        
        if normalized_status not in stage_weight_to_time:
            stage_weight_to_time[normalized_status] = []
        
        stage_weight_to_time[normalized_status].append((weight, time_sec))
    
    for stage in stages:
        stage_name = stage.get("name", "")
        stage_type = stage.get("type", "")  # pressure or flow
        dynamics_points = stage.get("dynamics_points", [])
        dynamics_over = stage.get("dynamics_over", "time")  # time or weight
        
        if not dynamics_points:
            continue
            
        # Get actual stage timing from shot
        # Match using either stage name or stage key (for consistency with main analysis)
        identifiers = set()
        if stage_name:
            identifiers.add(stage_name.lower().strip())
        stage_key_field = stage.get("key", "")
        if stage_key_field:
            identifiers.add(stage_key_field.lower().strip())

        stage_timing = None
        for shot_stage_name, timing in shot_stage_times.items():
            normalized_shot_stage_name = shot_stage_name.lower().strip()
            if normalized_shot_stage_name in identifiers:
                stage_timing = timing
                break
        
        if not stage_timing:
            continue
            
        stage_start, stage_end = stage_timing
        stage_duration = stage_end - stage_start
        
        if stage_duration <= 0:
            continue
        
        # Generate points along the stage duration
        # For time-based dynamics, interpolate directly
        if dynamics_over == "time":
            # Get the dynamics point times (x values) and target values (y values)
            if len(dynamics_points) == 1:
                # Constant value throughout stage
                value = dynamics_points[0][1] if len(dynamics_points[0]) > 1 else dynamics_points[0][0]
                # Resolve variable if needed
                if isinstance(value, str) and value.startswith('$'):
                    resolved, _ = _resolve_variable(value, variables)
                    value = _safe_float(resolved)
                else:
                    value = _safe_float(value)
                    
                # Add start and end points
                point_start = {"time": round(stage_start, 2), "stage_name": stage_name}
                point_end = {"time": round(stage_end, 2), "stage_name": stage_name}
                
                if stage_type == "pressure":
                    point_start["target_pressure"] = round(value, 1)
                    point_end["target_pressure"] = round(value, 1)
                elif stage_type == "flow":
                    point_start["target_flow"] = round(value, 1)
                    point_end["target_flow"] = round(value, 1)
                    
                data_points.append(point_start)
                data_points.append(point_end)
            else:
                # Multiple points - interpolate based on relative time within stage
                # dynamics_points format: [[time1, value1], [time2, value2], ...]
                max_dynamics_time = max(p[0] for p in dynamics_points)
                
                # Scale factor to map dynamics time to actual stage duration
                scale = stage_duration / max_dynamics_time if max_dynamics_time > 0 else 1
                
                for dp in dynamics_points:
                    dp_time = dp[0]
                    dp_value = dp[1] if len(dp) > 1 else dp[0]
                    
                    # Resolve variable if needed
                    if isinstance(dp_value, str) and dp_value.startswith('$'):
                        resolved, _ = _resolve_variable(dp_value, variables)
                        dp_value = _safe_float(resolved)
                    else:
                        dp_value = _safe_float(dp_value)
                    
                    actual_time = stage_start + (dp_time * scale)
                    
                    point = {"time": round(actual_time, 2), "stage_name": stage_name}
                    if stage_type == "pressure":
                        point["target_pressure"] = round(dp_value, 1)
                    elif stage_type == "flow":
                        point["target_flow"] = round(dp_value, 1)
                        
                    data_points.append(point)
        
        # For weight-based dynamics, map weight values to time using actual shot data
        elif dynamics_over == "weight":
            # Get weight-to-time mapping for this stage
            stage_key_normalized = None
            for identifier in identifiers:
                if identifier in stage_weight_to_time:
                    stage_key_normalized = identifier
                    break
            
            if not stage_key_normalized or not stage_weight_to_time[stage_key_normalized]:
                # No weight data available for this stage
                continue
            
            weight_time_pairs = stage_weight_to_time[stage_key_normalized]
            
            # Sort by weight to enable interpolation
            weight_time_pairs.sort(key=lambda x: x[0])
            
            if len(dynamics_points) == 1:
                # Constant value throughout stage
                value = dynamics_points[0][1] if len(dynamics_points[0]) > 1 else dynamics_points[0][0]
                
                # Resolve variable if needed
                if isinstance(value, str) and value.startswith('$'):
                    resolved, _ = _resolve_variable(value, variables)
                    value = _safe_float(resolved)
                else:
                    value = _safe_float(value)
                
                # Add start and end points
                point_start = {"time": round(stage_start, 2), "stage_name": stage_name}
                point_end = {"time": round(stage_end, 2), "stage_name": stage_name}
                
                if stage_type == "pressure":
                    point_start["target_pressure"] = round(value, 1)
                    point_end["target_pressure"] = round(value, 1)
                elif stage_type == "flow":
                    point_start["target_flow"] = round(value, 1)
                    point_end["target_flow"] = round(value, 1)
                
                data_points.append(point_start)
                data_points.append(point_end)
            else:
                # Multiple points - interpolate weight values to time
                # dynamics_points format: [[weight1, value1], [weight2, value2], ...]
                for dp in dynamics_points:
                    dp_weight = dp[0]
                    dp_value = dp[1] if len(dp) > 1 else dp[0]
                    
                    # Resolve variable if needed
                    if isinstance(dp_value, str) and dp_value.startswith('$'):
                        resolved, _ = _resolve_variable(dp_value, variables)
                        dp_value = _safe_float(resolved)
                    else:
                        dp_value = _safe_float(dp_value)
                    
                    # Find time corresponding to this weight using linear interpolation
                    actual_time = _interpolate_weight_to_time(dp_weight, weight_time_pairs)
                    
                    if actual_time is not None:
                        point = {"time": round(actual_time, 2), "stage_name": stage_name}
                        if stage_type == "pressure":
                            point["target_pressure"] = round(dp_value, 1)
                        elif stage_type == "flow":
                            point["target_flow"] = round(dp_value, 1)
                        
                        data_points.append(point)
    
    # Sort by time
    data_points.sort(key=lambda x: x["time"])
    
    return data_points


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
    
    # Build shot stage times for profile curve generation
    shot_stage_times = {}
    for stage_name, stage_data in shot_stages.items():
        start_time = stage_data.get("start_time", 0)
        end_time = stage_data.get("end_time", 0)
        shot_stage_times[stage_name] = (start_time, end_time)
    
    # Generate profile target curves for chart overlay
    profile_target_curves = _generate_profile_target_curves(profile_data, shot_stage_times, shot_data)
    
    # Profile stages
    profile_stages = profile_data.get("stages", [])
    profile_variables = profile_data.get("variables", [])
    
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
        
        analysis = _analyze_stage_execution(profile_stage, shot_stage_data, total_time, profile_variables)
        stage_analyses.append(analysis)
        
        # Track unreached
        if not analysis["executed"]:
            unreached_stages.append(stage_name)
        
        # Track preinfusion time
        name_lower = stage_name.lower()
        is_preinfusion = any(kw in name_lower for kw in PREINFUSION_KEYWORDS) or \
                         any(kw in stage_key for kw in ['preinfusion', 'bloom', 'soak', 'fill'])
        
        if is_preinfusion and shot_stage_data:
            preinfusion_time += _safe_float(shot_stage_data.get("duration", 0))
            preinfusion_stages.append({
                "name": stage_name,
                "duration": _safe_float(shot_stage_data.get("duration", 0)),
                "start_weight": _safe_float(shot_stage_data.get("start_weight", 0)),
                "end_weight": _safe_float(shot_stage_data.get("end_weight", 0)),
                "max_flow": _safe_float(shot_stage_data.get("max_flow", 0)),
                "avg_flow": _safe_float(shot_stage_data.get("avg_flow", 0)),
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
        },
        "profile_target_curves": profile_target_curves
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
                        "variables": [],
                        "stages": []
                    }
                    
                    # Extract variables if present
                    if hasattr(full_profile, 'variables') and full_profile.variables:
                        for var in full_profile.variables:
                            var_dict = {
                                "key": getattr(var, 'key', ''),
                                "name": getattr(var, 'name', ''),
                                "type": getattr(var, 'type', ''),
                                "value": getattr(var, 'value', 0)
                            }
                            profile_data["variables"].append(var_dict)
                    
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
# LLM Shot Analysis
# ============================================================================

# Espresso profiling knowledge for LLM context
PROFILING_KNOWLEDGE = """# Espresso Profiling Expert Knowledge

## Core Variables
- **Flow Rate (ml/s)**: Controls extraction speed. Higher = more acidity/clarity, Lower = more body/sweetness
- **Pressure (bar)**: Result of flow vs resistance. Creates texture and crema. 6-9 bar typical.
- **Temperature (°C)**: Lighter roasts need higher temps (92-96°C), darker need lower (82-90°C)

## Shot Phases
1. **Pre-infusion**: Gently saturate puck (2-4 ml/s, <2 bar). Prevents channeling.
2. **Bloom** (optional): Rest at low pressure to release CO2 (5-30s for fresh coffee)
3. **Infusion**: Main extraction (6-9 bar or 1.5-3 ml/s). Most critical for flavor.
4. **Taper**: Gradual decline to minimize bitterness (drop to 4-5 bar)

## Troubleshooting Guide
- **Sour/thin/acidic**: Under-extracted. Increase pressure, extend infusion, raise temp
- **Bitter/harsh/astringent**: Over-extracted. Lower pressure, taper earlier, lower temp
- **Gushing/fast shot**: Grind too coarse, or pre-infusion too aggressive
- **Choking/slow shot**: Grind too fine, add bloom phase, or increase initial pressure

## Equipment Factors
- **Grind setting**: Primary extraction control. Fine = slower, more extraction
- **Basket type**: VST/IMS precision baskets vs stock baskets affect flow distribution
- **Bottom filter**: Paper filters reduce sediment but also oils (cleaner but thinner)
- **Puck prep**: WDT, leveling, and tamp consistency affect channeling risk
"""


def _prepare_shot_summary_for_llm(shot_data: dict, profile_data: dict, local_analysis: dict) -> dict:
    """Prepare a token-efficient summary of shot data for LLM analysis.
    
    Extracts only key data points to minimize token usage while providing
    enough context for meaningful analysis.
    """
    # Basic shot metrics
    overall = local_analysis.get("overall_metrics", {})
    weight_analysis = local_analysis.get("weight_analysis", {})
    preinfusion = local_analysis.get("preinfusion_summary", {})
    
    # Stage summary (compact format)
    stage_summaries = []
    total_time = overall.get("total_time", 0)
    
    for stage in local_analysis.get("stage_analyses", []):
        exec_data = stage.get("execution_data")
        if exec_data:
            duration = exec_data.get("duration", 0)
            pct_of_shot = round((duration / total_time * 100) if total_time > 0 else 0, 1)
            # Safely extract exit trigger and limit hit descriptions
            exit_trigger_desc = None
            exit_trigger_result = stage.get("exit_trigger_result")
            if exit_trigger_result:
                triggered = exit_trigger_result.get("triggered")
                if triggered and isinstance(triggered, dict):
                    exit_trigger_desc = triggered.get("description")
            
            limit_hit_desc = None
            limit_hit = stage.get("limit_hit")
            if limit_hit and isinstance(limit_hit, dict):
                limit_hit_desc = limit_hit.get("description")
            
            stage_summaries.append({
                "name": stage.get("stage_name"),
                "duration_s": round(duration, 1),
                "percent_of_shot": pct_of_shot,
                "avg_pressure": exec_data.get("avg_pressure"),
                "avg_flow": exec_data.get("avg_flow"),
                "weight_gain": exec_data.get("weight_gain"),
                "cumulative_weight_at_end": exec_data.get("end_weight"),  # Added: cumulative weight when stage ended
                "exit_trigger": exit_trigger_desc,
                "limit_hit": limit_hit_desc
            })
        else:
            stage_summaries.append({
                "name": stage.get("stage_name"),
                "status": "NOT REACHED"
            })
    
    # Profile variables (resolved values)
    variables = []
    for var in profile_data.get("variables", []):
        variables.append({
            "name": var.get("name"),
            "type": var.get("type"),
            "value": var.get("value")
        })
    
    # Simplified graph data - sample key points from the shot
    data_entries = shot_data.get("data", [])
    graph_summary = []
    
    if data_entries:
        # Sample at key points: start, 25%, 50%, 75%, end, and any stage transitions
        sample_indices = [0]
        n = len(data_entries)
        for pct in [0.25, 0.5, 0.75]:
            idx = int(n * pct)
            if idx not in sample_indices:
                sample_indices.append(idx)
        sample_indices.append(n - 1)
        
        for idx in sorted(set(sample_indices)):
            entry = data_entries[idx]
            shot = entry.get("shot", {})
            graph_summary.append({
                "time_s": round(entry.get("time", 0) / 1000, 1),
                "pressure": round(shot.get("pressure", 0), 1),
                "flow": round(shot.get("flow", 0) or shot.get("gravimetric_flow", 0), 1),
                "weight": round(shot.get("weight", 0), 1),
                "stage": entry.get("status", "")
            })
    
    return {
        "shot_summary": {
            "total_time_s": overall.get("total_time"),
            "final_weight_g": weight_analysis.get("actual"),
            "target_weight_g": weight_analysis.get("target"),
            "weight_deviation_pct": weight_analysis.get("deviation_percent"),
            "max_pressure_bar": overall.get("max_pressure"),
            "max_flow_mls": overall.get("max_flow"),
            "temperature_c": profile_data.get("temperature")
        },
        "stages": stage_summaries,
        "unreached_stages": local_analysis.get("unreached_stages", []),
        "preinfusion": {
            "total_time_s": preinfusion.get("total_time"),
            "percent_of_shot": preinfusion.get("proportion_of_shot"),
            "weight_accumulated_g": preinfusion.get("weight_accumulated")
        },
        "variables": variables,
        "graph_samples": graph_summary
    }


def _prepare_profile_for_llm(profile_data: dict, description: str | None) -> dict:
    """Prepare profile data for LLM, removing image and limiting description."""
    # Build clean profile without image
    clean_profile = {
        "name": profile_data.get("name"),
        "temperature": profile_data.get("temperature"),
        "final_weight": profile_data.get("final_weight"),
        "variables": profile_data.get("variables", []),
        "stages": []
    }
    
    # Include stage structure but not full dynamics data
    for stage in profile_data.get("stages", []):
        clean_stage = {
            "name": stage.get("name"),
            "type": stage.get("type"),
            "exit_triggers": stage.get("exit_triggers", []),
            "limits": stage.get("limits", [])
        }
        # Add a summary of dynamics
        dynamics = stage.get("dynamics_points", [])
        if dynamics:
            if len(dynamics) == 1:
                clean_stage["target"] = f"Constant at {dynamics[0][1] if len(dynamics[0]) > 1 else dynamics[0][0]}"
            elif len(dynamics) >= 2:
                start = dynamics[0][1] if len(dynamics[0]) > 1 else dynamics[0][0]
                end = dynamics[-1][1] if len(dynamics[-1]) > 1 else dynamics[-1][0]
                clean_stage["target"] = f"{start} → {end}"
        clean_profile["stages"].append(clean_stage)
    
    return clean_profile


@app.get("/api/shots/llm-analysis-cache")
async def get_llm_analysis_cache(
    request: Request,
    profile_name: str,
    shot_date: str,
    shot_filename: str
):
    """Check if a cached LLM analysis exists for the given shot.
    
    Returns the cached analysis if it exists and is not expired,
    otherwise returns null.
    """
    request_id = request.state.request_id
    
    logger.info(
        "Checking LLM analysis cache",
        extra={
            "request_id": request_id,
            "profile_name": profile_name,
            "shot_date": shot_date,
            "shot_filename": shot_filename
        }
    )
    
    cached = get_cached_llm_analysis(profile_name, shot_date, shot_filename)
    
    if cached:
        logger.info(
            "LLM analysis cache hit",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return {
            "status": "success",
            "cached": True,
            "analysis": cached
        }
    else:
        logger.info(
            "LLM analysis cache miss",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return {
            "status": "success", 
            "cached": False,
            "analysis": None
        }


@app.post("/api/shots/analyze-llm")
async def analyze_shot_with_llm(
    request: Request,
    profile_name: str = Form(...),
    shot_date: str = Form(...),
    shot_filename: str = Form(...),
    profile_description: Optional[str] = Form(None),
    force_refresh: bool = Form(False)
):
    """Analyze a shot using LLM with expert profiling knowledge.
    
    This endpoint performs a deep analysis of shot execution, combining:
    - Local algorithmic analysis for data extraction
    - Expert espresso profiling knowledge
    - LLM reasoning for actionable recommendations
    
    Results are cached server-side for 3 days.
    Use force_refresh=True to bypass cache and regenerate analysis.
    
    Returns structured analysis answering:
    1. How did the shot go and why?
    2. What should change about the setup (grind, filter, basket, prep)?
    3. What should change about the profile?
    4. Any issues found in the profile design itself?
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Starting LLM shot analysis",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename,
                "force_refresh": force_refresh
            }
        )
        
        # Check cache first (unless force refresh)
        if not force_refresh:
            cached_analysis = get_cached_llm_analysis(profile_name, shot_date, shot_filename)
            if cached_analysis:
                logger.info(
                    "Returning cached LLM analysis",
                    extra={"request_id": request_id, "profile_name": profile_name}
                )
                return {
                    "status": "success",
                    "profile_name": profile_name,
                    "shot_date": shot_date,
                    "shot_filename": shot_filename,
                    "llm_analysis": cached_analysis,
                    "cached": True
                }
        
        # Fetch shot data
        shot_data = await fetch_shot_data(shot_date, shot_filename)
        
        # Fetch profile from machine (with variables)
        api = get_meticulous_api()
        profiles_result = api.list_profiles()
        
        profile_data = None
        for partial_profile in profiles_result:
            if partial_profile.name.lower() == profile_name.lower():
                full_profile = api.get_profile(partial_profile.id)
                if not (hasattr(full_profile, 'error') and full_profile.error):
                    profile_data = {
                        "name": full_profile.name,
                        "temperature": getattr(full_profile, 'temperature', None),
                        "final_weight": getattr(full_profile, 'final_weight', None),
                        "variables": [],
                        "stages": []
                    }
                    
                    # Extract variables
                    if hasattr(full_profile, 'variables') and full_profile.variables:
                        for var in full_profile.variables:
                            profile_data["variables"].append({
                                "key": getattr(var, 'key', ''),
                                "name": getattr(var, 'name', ''),
                                "type": getattr(var, 'type', ''),
                                "value": getattr(var, 'value', 0)
                            })
                    
                    # Extract stages with full details
                    if hasattr(full_profile, 'stages') and full_profile.stages:
                        for stage in full_profile.stages:
                            stage_dict = {
                                "name": getattr(stage, 'name', 'Unknown'),
                                "key": getattr(stage, 'key', ''),
                                "type": getattr(stage, 'type', 'unknown'),
                            }
                            for attr in ['dynamics_points', 'dynamics_over', 'dynamics_interpolation', 'exit_triggers', 'limits']:
                                val = getattr(stage, attr, None)
                                if val is not None:
                                    if isinstance(val, list):
                                        stage_dict[attr] = [dict(item) if hasattr(item, '__dict__') else item for item in val]
                                    else:
                                        stage_dict[attr] = val
                            profile_data["stages"].append(stage_dict)
                break
        
        if not profile_data:
            raise HTTPException(
                status_code=404,
                detail=f"Profile '{profile_name}' not found on machine"
            )
        
        # Run local analysis first to extract data
        local_analysis = _perform_local_shot_analysis(shot_data, profile_data)
        
        # Prepare profile data (clean, no image)
        clean_profile = _prepare_profile_for_llm(profile_data, profile_description)
        
        # Build the LLM prompt with FULL local analysis
        prompt = f"""You are an expert espresso barista and profiling specialist analyzing a shot from a Meticulous Espresso Machine.

## Expert Knowledge
{PROFILING_KNOWLEDGE}

## Profile Being Used
Name: {clean_profile['name']}
Temperature: {clean_profile.get('temperature', 'Not set')}°C
Target Weight: {clean_profile.get('final_weight', 'Not set')}g

### Profile Description
{profile_description or 'No description provided - analyze the profile structure to understand intent.'}

### Profile Variables
{json.dumps(clean_profile.get('variables', []), indent=2)}

### Profile Stages
{json.dumps(clean_profile.get('stages', []), indent=2)}

## Full Local Analysis
This is the complete algorithmic analysis of the shot. Use this data to inform your expert analysis.

IMPORTANT: Each stage includes 'cumulative_weight_at_end' which shows the total weight when that stage ended.
If a stage ended early but the cumulative weight was near the target weight, the shot likely terminated 
correctly due to reaching the final weight target - this is NORMAL and EXPECTED behavior.
A stage that appears "short" may simply mean the target yield was reached, which is the correct outcome.

{json.dumps(local_analysis, indent=2)}

---

Based on this data, provide a detailed expert analysis.

CRITICAL FORMATTING RULES:
1. You MUST use EXACTLY these 5 section headers with the exact format shown (## followed by number, period, space, then title)
2. Each section MUST have the subsection headers shown (bold text with colon, like **What Happened:**)
3. ALL content under subsections MUST be bullet points starting with "- "
4. Keep bullet points concise (1-2 sentences max per bullet)
5. Do NOT add extra sections or subsections beyond what's specified

## 1. Shot Performance

**What Happened:**
- [Stage-by-stage description of the extraction]
- [Notable events: pressure spikes, flow restrictions, early/late stage exits]
- [Final weight accuracy relative to target]

**Assessment:** [Choose exactly one: Good / Acceptable / Needs Improvement / Problematic]

## 2. Root Cause Analysis

**Primary Factors:**
- [Most likely cause with brief explanation]
- [Second most likely cause if applicable]

**Secondary Considerations:**
- [Other contributing factors]
- [Environmental or equipment factors if relevant]

## 3. Setup Recommendations

**Priority Changes:**
- [Most important change - be specific with numbers when possible]
- [Second priority change]

**Additional Suggestions:**
- [Other tweaks to consider]

## 4. Profile Recommendations

**Recommended Adjustments:**
- [Specific profile changes: timing, triggers, targets]
- [Variable value changes if applicable]

**Reasoning:**
- [Why these changes would improve the shot]

## 5. Profile Design Observations

**Strengths:**
- [Well-designed aspects of this profile]

**Potential Improvements:**
- [Exit trigger or safety limit suggestions]
- [Robustness improvements]

Focus on actionable insights. Be specific with numbers where possible (e.g., "grind 1-2 steps finer" not just "grind finer").
"""
        
        # Call LLM
        model = get_vision_model()
        response = model.generate_content(prompt)
        
        llm_analysis = response.text if response else "Analysis generation failed"
        
        # Save to cache
        save_llm_analysis_to_cache(profile_name, shot_date, shot_filename, llm_analysis)
        
        logger.info(
            "LLM shot analysis completed and cached",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "response_length": len(llm_analysis)
            }
        )
        
        return {
            "status": "success",
            "profile_name": profile_name,
            "shot_date": shot_date,
            "shot_filename": shot_filename,
            "llm_analysis": llm_analysis,
            "cached": False
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"LLM shot analysis failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "profile_name": profile_name
            }
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "LLM shot analysis failed"}
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
        created_at = datetime.now(timezone.utc).isoformat()
        
        new_entry = {
            "id": entry_id,
            "created_at": created_at,
            "profile_name": profile_name,
            "user_preferences": f"Imported from {source}",
            "reply": reply,
            "profile_json": deep_convert_to_dict(profile_json),
            "imported": True,
            "import_source": source
        }
        
        # Save to history using atomic write to prevent corruption
        if HISTORY_FILE.exists():
            with open(HISTORY_FILE, 'r') as f:
                history = json.load(f)
                # Ensure it's a list
                if not isinstance(history, list):
                    history = history.get("entries", [])
        else:
            history = []
        
        history.insert(0, new_entry)
        
        atomic_write_json(HISTORY_FILE, history)
        
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


@app.post("/api/profile/import-all")
async def import_all_profiles(request: Request):
    """Import all profiles from the Meticulous machine that aren't already in history.
    
    This is a long-running operation that imports profiles one at a time,
    generating descriptions for each. The response is streamed as newline-delimited JSON
    to provide progress updates.
    
    Returns:
        Streamed JSON with progress updates and final summary
    """
    from fastapi.responses import StreamingResponse
    
    request_id = request.state.request_id
    
    async def generate_import_stream():
        """Generator that yields progress updates as JSON lines."""
        imported = []
        skipped = []
        failed = []
        
        try:
            # Get list of machine profiles
            api = get_meticulous_api()
            profiles_result = api.list_profiles()
            
            if hasattr(profiles_result, 'error') and profiles_result.error:
                yield json.dumps({
                    "type": "error",
                    "message": f"Machine API error: {profiles_result.error}"
                }) + "\n"
                return
            
            # Get existing profile names from history
            existing_names = set()
            if HISTORY_FILE.exists():
                try:
                    with open(HISTORY_FILE, 'r') as f:
                        history = json.load(f)
                        entries = history if isinstance(history, list) else history.get("entries", [])
                        existing_names = {entry.get("profile_name") for entry in entries}
                except Exception:
                    pass
            
            # Filter profiles to import
            profiles_to_import = []
            for partial_profile in profiles_result:
                try:
                    full_profile = api.get_profile(partial_profile.id)
                    if hasattr(full_profile, 'error') and full_profile.error:
                        continue
                    if full_profile.name not in existing_names:
                        profiles_to_import.append(full_profile)
                    else:
                        skipped.append(full_profile.name)
                except Exception:
                    pass
            
            total_to_import = len(profiles_to_import)
            total_profiles = total_to_import + len(skipped)
            
            # Send initial status
            yield json.dumps({
                "type": "start",
                "total": total_profiles,
                "to_import": total_to_import,
                "already_imported": len(skipped),
                "message": f"Found {total_to_import} profiles to import ({len(skipped)} already in catalogue)"
            }) + "\n"
            
            if total_to_import == 0:
                yield json.dumps({
                    "type": "complete",
                    "imported": 0,
                    "skipped": len(skipped),
                    "failed": 0,
                    "message": "All profiles already in catalogue"
                }) + "\n"
                return
            
            # Import each profile
            for idx, profile in enumerate(profiles_to_import, 1):
                profile_name = profile.name
                
                yield json.dumps({
                    "type": "progress",
                    "current": idx,
                    "total": total_to_import,
                    "profile_name": profile_name,
                    "message": f"Importing {idx}/{total_to_import}: {profile_name}"
                }) + "\n"
                
                try:
                    # Convert profile to JSON dict using deep conversion
                    profile_json = deep_convert_to_dict(profile)
                    
                    # Generate description
                    reply = None
                    try:
                        reply = await _generate_profile_description(profile_json, request_id)
                    except Exception as e:
                        logger.warning(f"Failed to generate description for {profile_name}: {e}")
                        reply = "Profile imported from machine. Description generation failed."
                    
                    # Create history entry
                    entry_id = str(uuid.uuid4())
                    created_at = datetime.now(timezone.utc).isoformat()
                    
                    new_entry = {
                        "id": entry_id,
                        "created_at": created_at,
                        "profile_name": profile_name,
                        "user_preferences": "Imported from machine (bulk import)",
                        "reply": reply,
                        "profile_json": profile_json,
                        "imported": True,
                        "import_source": "machine_bulk"
                    }
                    
                    # Save to history using atomic write to prevent corruption
                    if HISTORY_FILE.exists():
                        with open(HISTORY_FILE, 'r') as f:
                            history = json.load(f)
                            if not isinstance(history, list):
                                history = history.get("entries", [])
                    else:
                        history = []
                    
                    history.insert(0, new_entry)
                    
                    atomic_write_json(HISTORY_FILE, history)
                    
                    imported.append(profile_name)
                    
                    yield json.dumps({
                        "type": "imported",
                        "current": idx,
                        "total": total_to_import,
                        "profile_name": profile_name,
                        "message": f"Imported: {profile_name}"
                    }) + "\n"
                    
                except Exception as e:
                    logger.error(f"Failed to import {profile_name}: {e}", exc_info=True)
                    failed.append({"name": profile_name, "error": str(e)})
                    
                    yield json.dumps({
                        "type": "failed",
                        "current": idx,
                        "total": total_to_import,
                        "profile_name": profile_name,
                        "error": str(e),
                        "message": f"Failed: {profile_name}"
                    }) + "\n"
            
            # Send completion summary
            yield json.dumps({
                "type": "complete",
                "imported": len(imported),
                "skipped": len(skipped),
                "failed": len(failed),
                "imported_profiles": imported,
                "skipped_profiles": skipped,
                "failed_profiles": failed,
                "message": f"Import complete: {len(imported)} imported, {len(skipped)} skipped, {len(failed)} failed"
            }) + "\n"
            
            logger.info(
                f"Bulk import completed: {len(imported)} imported, {len(skipped)} skipped, {len(failed)} failed",
                extra={"request_id": request_id}
            )
            
        except Exception as e:
            logger.error(f"Bulk import error: {e}", exc_info=True, extra={"request_id": request_id})
            yield json.dumps({
                "type": "error",
                "message": str(e)
            }) + "\n"
    
    return StreamingResponse(
        generate_import_stream(),
        media_type="application/x-ndjson"
    )


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


# ============================================================================
# Run Shot Endpoints
# ============================================================================

# Scheduled shots storage (in-memory for now, could be persisted)
_scheduled_shots: dict = {}
_scheduled_tasks: dict = {}

PREHEAT_DURATION_MINUTES = 10


@app.get("/api/machine/status")
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
        
        # Enable auto_preheat setting and trigger it
        # The Meticulous machine handles preheat via the settings
        try:
            from meticulous.api_types import PartialSettings
            settings = PartialSettings(auto_preheat=1)  # Enable preheat
            result = api.update_setting(settings)
            
            if hasattr(result, 'error') and result.error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to start preheat: {result.error}"
                )
        except ImportError:
            # Fallback: direct API call
            result = api.session.post(
                f"{api.base_url}/api/v1/settings",
                json={"auto_preheat": 1}
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


@app.post("/api/machine/run-profile/{profile_id}")
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


@app.post("/api/machine/schedule-shot")
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
                api = get_meticulous_api()
                
                # If preheat is enabled, start it 10 minutes before
                if preheat:
                    preheat_delay = shot_delay - (PREHEAT_DURATION_MINUTES * 60)
                    if preheat_delay > 0:
                        await asyncio.sleep(preheat_delay)
                        _scheduled_shots[schedule_id]["status"] = "preheating"
                        
                        # Start preheat
                        try:
                            from meticulous.api_types import PartialSettings
                            settings = PartialSettings(auto_preheat=1)
                            api.update_setting(settings)
                        except Exception as e:
                            logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                        
                        # Wait for remaining time until shot
                        await asyncio.sleep(PREHEAT_DURATION_MINUTES * 60)
                    else:
                        # Not enough time for full preheat, start immediately
                        _scheduled_shots[schedule_id]["status"] = "preheating"
                        try:
                            from meticulous.api_types import PartialSettings
                            settings = PartialSettings(auto_preheat=1)
                            api.update_setting(settings)
                        except Exception as e:
                            logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                        await asyncio.sleep(shot_delay)
                else:
                    await asyncio.sleep(shot_delay)
                
                _scheduled_shots[schedule_id]["status"] = "running"
                
                # Load and run the profile (if profile_id was provided)
                if profile_id:
                    load_result = api.load_profile_by_id(profile_id)
                    if not (hasattr(load_result, 'error') and load_result.error):
                        from meticulous.api_types import ActionType
                        api.execute_action(ActionType.START)
                        _scheduled_shots[schedule_id]["status"] = "completed"
                    else:
                        _scheduled_shots[schedule_id]["status"] = "failed"
                        _scheduled_shots[schedule_id]["error"] = load_result.error
                else:
                    # Preheat only mode - mark as completed
                    _scheduled_shots[schedule_id]["status"] = "completed"
                    
            except asyncio.CancelledError:
                _scheduled_shots[schedule_id]["status"] = "cancelled"
            except Exception as e:
                logger.error(f"Scheduled shot {schedule_id} failed: {e}")
                _scheduled_shots[schedule_id]["status"] = "failed"
                _scheduled_shots[schedule_id]["error"] = str(e)
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
