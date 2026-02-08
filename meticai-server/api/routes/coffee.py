"""Coffee analysis and profiling endpoints."""
from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from typing import Optional
from PIL import Image
import io
import subprocess
import logging

from services.gemini_service import (
    parse_gemini_error,
    get_vision_model,
    get_author_instruction,
    build_advanced_customization_section
)
from services.history_service import save_to_history

router = APIRouter()
logger = logging.getLogger(__name__)

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


@router.post("/analyze_coffee")
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

@router.post("/analyze_and_profile")
async def analyze_and_profile(
    request: Request,
    file: Optional[UploadFile] = File(None),
    user_prefs: Optional[str] = Form(None),
    advanced_customization: Optional[str] = Form(None)
):
    """Unified endpoint: Analyze coffee bag and generate profile in a single LLM pass.
    
    Requires at least one of:
    - file: Image of the coffee bag
    - user_prefs: User preferences or specific instructions
    
    Optional:
    - advanced_customization: Advanced equipment/extraction settings (basket, temp, dose, etc.)
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
                "has_advanced_customization": advanced_customization is not None,
                "upload_filename": file.filename if file else None,
                "preferences_preview": user_prefs[:100] if user_prefs and len(user_prefs) > 100 else user_prefs,
                "advanced_customization_preview": (
                    advanced_customization[:100]
                    if advanced_customization and len(advanced_customization) > 100
                    else advanced_customization
                )
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
        
        # Build advanced customization section if provided
        advanced_section = build_advanced_customization_section(advanced_customization)
        
        # Construct the profile creation prompt
        if coffee_analysis and user_prefs:
            # Both image and preferences provided
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n"
                f"Coffee Analysis: '{coffee_analysis}'\n\n" +
                advanced_section +
                f"⚠️ MANDATORY USER REQUIREMENTS (MUST BE FOLLOWED EXACTLY):\n"
                f"'{user_prefs}'\n"
                f"You MUST honor ALL parameters specified above. If the user requests a specific dose, temperature, ratio, or any other value, use EXACTLY that value in your profile. Do NOT substitute with defaults.\n\n"
                f"TASK: Create a sophisticated espresso profile based on the coffee analysis while strictly adhering to the user's requirements and equipment parameters above.\n\n" +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                author_instruction +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT
            )
        elif coffee_analysis:
            # Only image provided (may still have advanced customization)
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n"
                f"Coffee Analysis: '{coffee_analysis}'\n\n" +
                advanced_section +
                f"TASK: Create a sophisticated espresso profile for this coffee" +
                (", strictly adhering to the equipment parameters above.\n\n" if advanced_section else ".\n\n") +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                author_instruction +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT
            )
        else:
            # Only user preferences provided (may still have advanced customization)
            final_prompt = (
                BARISTA_PERSONA +
                SAFETY_RULES +
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n\n" +
                advanced_section +
                f"⚠️ MANDATORY USER REQUIREMENTS (MUST BE FOLLOWED EXACTLY):\n"
                f"'{user_prefs}'\n"
                f"You MUST honor ALL parameters specified above. If the user requests a specific dose, temperature, ratio, or any other value, use EXACTLY that value in your profile. Do NOT substitute with defaults.\n\n"
                "TASK: Create a sophisticated espresso profile while strictly adhering to the user's requirements and equipment parameters above.\n\n" +
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
