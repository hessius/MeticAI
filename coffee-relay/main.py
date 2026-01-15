from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import google.generativeai as genai
from PIL import Image
import io
import os
import subprocess
import json
from pathlib import Path

app = FastAPI()

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
    "Special Notes: [Any equipment or technique requirements, or 'None' if standard setup]"
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
async def analyze_coffee(file: UploadFile = File(...)):
    """Phase 1: Look at the bag."""
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        response = get_vision_model().generate_content([
            "Analyze this coffee bag. Extract: Roaster, Origin, Roast Level, and Flavor Notes. "
            "Return ONLY a single concise sentence describing the coffee.", 
            image
        ])
        return {"analysis": response.text.strip()}
    except Exception as e:
        return {"error": str(e)}

@app.post("/analyze_and_profile")
async def analyze_and_profile(
    file: Optional[UploadFile] = File(None),
    user_prefs: Optional[str] = Form(None)
):
    """Unified endpoint: Analyze coffee bag and generate profile in a single LLM pass.
    
    Requires at least one of:
    - file: Image of the coffee bag
    - user_prefs: User preferences or specific instructions
    """
    
    # Validate that at least one input is provided
    if not file and not user_prefs:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'file' (image) or 'user_prefs' (preferences) must be provided"
        )
    
    coffee_analysis = None
    
    try:
        # If image is provided, analyze it first
        if file:
            contents = await file.read()
            image = Image.open(io.BytesIO(contents))
            
            # Analyze the coffee bag
            analysis_response = get_vision_model().generate_content([
                "Analyze this coffee bag. Extract: Roaster, Origin, Roast Level, and Flavor Notes. "
                "Return ONLY a single concise sentence describing the coffee.", 
                image
            ])
            coffee_analysis = analysis_response.text.strip()
        
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
            return {
                "status": "error", 
                "analysis": coffee_analysis,
                "message": result.stderr
            }
            
        return {
            "status": "success",
            "analysis": coffee_analysis,
            "reply": result.stdout
        }

    except Exception as e:
        return {
            "status": "error",
            "analysis": coffee_analysis if coffee_analysis else None,
            "message": str(e)
        }

@app.get("/status")
async def get_status():
    """Get system status including update availability.
    
    Returns:
        - update_available: Whether updates are available for any component
        - last_check: Timestamp of last update check
        - repositories: Status of each repository (main, mcp, web)
    """
    try:
        # Run update check script
        result = subprocess.run(
            ["bash", "/app/../update.sh", "--check-only"],
            capture_output=True,
            text=True,
            cwd="/app/.."
        )
        
        # Read version file to get detailed status
        version_file_path = Path("/app/../.versions.json")
        update_status = {
            "update_available": False,
            "last_check": None,
            "repositories": {}
        }
        
        if version_file_path.exists():
            with open(version_file_path, 'r') as f:
                version_data = json.load(f)
                update_status["last_check"] = version_data.get("last_check")
                update_status["repositories"] = version_data.get("repositories", {})
        
        # Check if updates are mentioned in output
        if "Update available" in result.stdout or "⚠" in result.stdout:
            update_status["update_available"] = True
        
        # Check individual repositories by examining output
        if "Not installed" in result.stdout or "✗" in result.stdout:
            update_status["update_available"] = True
        
        return update_status
        
    except Exception as e:
        return {
            "update_available": False,
            "error": str(e),
            "message": "Could not check for updates"
        }

@app.post("/api/trigger-update")
async def trigger_update():
    """Trigger the backend update process by running update.sh --auto.
    
    This endpoint executes the update script in non-interactive mode.
    No authentication is required - restrict API access at the network level if needed.
    
    Returns:
        - status: "success" or "error"
        - output: stdout from the update script
        - error: stderr from the update script (if any)
    """
    try:
        # Construct and resolve the absolute path to the update script
        # The script is in the parent directory of the coffee-relay app
        script_path = (Path(__file__).parent.parent / "update.sh").resolve()
        
        # Run update script with --auto flag for non-interactive mode
        # Timeout set to 10 minutes to prevent hanging processes
        result = subprocess.run(
            ["bash", str(script_path), "--auto"],
            capture_output=True,
            text=True,
            cwd=script_path.parent,
            timeout=600  # 10 minutes timeout
        )
        
        if result.returncode == 0:
            return {
                "status": "success",
                "output": result.stdout,
                "message": "Update script completed successfully"
            }
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "status": "error",
                    "output": result.stdout,
                    "error": result.stderr,
                    "message": "Update script failed"
                }
            )
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": "Update script timed out after 10 minutes",
                "message": "Update script execution exceeded timeout"
            }
        )
    except subprocess.SubprocessError as e:
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "Failed to execute update script"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "An unexpected error occurred"
            }
        )