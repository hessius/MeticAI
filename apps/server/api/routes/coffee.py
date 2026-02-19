"""Coffee analysis and profiling endpoints."""
from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from typing import Optional
from PIL import Image
import asyncio
import io
import os
import re
import subprocess
import time
import logging

# Register HEIC/HEIF support with Pillow
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass  # pillow-heif not installed; HEIC files will fail gracefully

from services.gemini_service import (
    parse_gemini_error,
    get_vision_model,
    get_author_instruction,
    build_advanced_customization_section,
    clean_gemini_output,
    PROFILING_KNOWLEDGE
)
from services.history_service import save_to_history

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Load OEPF RFC once at import time ──────────────────────────────────────────
# Embedding the RFC directly in the prompt eliminates a round-trip where the
# Gemini CLI would call the get_profiling_knowledge MCP tool, saving ~3-5s.
_OEPF_RFC: str = ""
try:
    # In Docker the schema repo is cloned to /app/espresso-profile-schema
    _rfc_paths = [
        "/app/espresso-profile-schema/rfc.md",
        os.path.join(os.path.dirname(__file__), "..", "..", "data", "oepf_rfc.md"),
    ]
    for _p in _rfc_paths:
        if os.path.isfile(_p):
            with open(_p, "r", encoding="utf-8") as _f:
                _OEPF_RFC = _f.read()
            break
except Exception as e:
    logger.warning(f"Failed to load OEPF RFC: {e}")  # Non-fatal

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
    "TIME VALUES (CRITICAL — ALWAYS USE RELATIVE):\n"
    "• ALL time-based exit triggers MUST use \"relative\": true\n"
    "• ALL dynamics_points x-axis values are ALWAYS relative to stage start (0 = stage start)\n"
    "• NEVER use \"relative\": false on time exit triggers — absolute time interpretation has known firmware issues\n"
    "• Example: {\"type\": \"time\", \"value\": 30, \"comparison\": \">=\", \"relative\": true} means 30s after stage starts\n\n"
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

VALIDATION_RULES = (
    "VALIDATION RULES (your profile WILL be rejected if these are violated):\n\n"
    "1. EXIT TRIGGER / STAGE TYPE PARADOX:\n"
    "   • A flow stage must NOT have a flow exit trigger\n"
    "   • A pressure stage must NOT have a pressure exit trigger\n"
    "   • Why: you're controlling that variable, so you can't reliably exit based on it\n"
    "   • Fix: use 'time', 'weight', or the opposite type (pressure trigger on flow stage, etc.)\n\n"
    "2. BACKUP EXIT TRIGGERS (failsafe):\n"
    "   • Every stage MUST have EITHER multiple exit triggers OR at least one time trigger\n"
    "   • A single non-time trigger (e.g. only weight) will be rejected — add a time failsafe\n"
    '   • Pattern: [{"type": "weight", ...}, {"type": "time", "value": 60, "comparison": ">=", "relative": true}]\n\n'
    "3. REQUIRED SAFETY LIMITS (cross-type):\n"
    "   • Flow stages MUST have a pressure limit (prevents pressure spike/stall)\n"
    "   • Pressure stages MUST have a flow limit (prevents channeling/gusher)\n"
    "   • A limit CANNOT have the same type as the stage (redundant — will be rejected)\n"
    "   • Correct: flow stage → pressure limit | pressure stage → flow limit\n\n"
    "4. INTERPOLATION:\n"
    "   • Only 'linear' and 'curve' are valid. 'none' is NOT supported and will stall the machine\n"
    "   • 'curve' requires at least 2 dynamics points\n\n"
    "5. DYNAMICS.OVER:\n"
    "   • Must be 'time', 'weight', or 'piston_position'. No other values\n\n"
    "6. STAGE TYPES:\n"
    "   • Must be 'power', 'flow', or 'pressure'. No other values\n\n"
    "7. EXIT TRIGGER TYPES:\n"
    "   • Must be: 'weight', 'pressure', 'flow', 'time', 'piston_position', 'power', or 'user_interaction'\n"
    "   • Comparison must be '>=' or '<='\n\n"
    "8. PRESSURE LIMITS:\n"
    "   • Max 15 bar in dynamics points and exit triggers. No negative values\n\n"
    "9. ABSOLUTE WEIGHT TRIGGERS:\n"
    "   • If using absolute weight triggers (relative: false), values MUST be strictly increasing across stages\n"
    "   • Otherwise the next stage's trigger fires immediately. Prefer 'relative: true' for weight triggers\n\n"
    "10. VARIABLES:\n"
    "   • Info variables (adjustable: false / key starts with 'info_'): name MUST start with emoji\n"
    "   • Adjustable variables: name must NOT start with emoji\n"
    "   • Every adjustable variable MUST be referenced in at least one stage's dynamics ($key)\n\n"
    "QUICK REFERENCE — VALID STAGE PATTERNS:\n"
    "• Flow stage: limits=[{pressure}], exit_triggers=[{weight, ...}, {time, ...}] ✅\n"
    "• Pressure stage: limits=[{flow}], exit_triggers=[{weight, ...}, {time, ...}] ✅\n"
    "• Flow stage with flow exit trigger: ❌ PARADOX\n"
    "• Pressure stage with pressure exit trigger: ❌ PARADOX\n"
    "• Any stage with single non-time trigger and no backup: ❌ NO FAILSAFE\n"
    "• Flow stage without pressure limit: ❌ UNSAFE\n"
    "• Pressure stage without flow limit: ❌ UNSAFE\n\n"
)

ERROR_RECOVERY = (
    "ERROR RECOVERY (if create_profile fails):\n"
    "• Read ALL validation errors carefully before making changes\n"
    "• Fix ALL errors in a SINGLE retry — do not fix one at a time\n"
    "• Common trap: fixing one error can introduce another (e.g., changing a trigger type may create a paradox)\n"
    "• Before resubmitting, mentally verify each stage against the validation rules above\n"
    "• If you get conflicting errors, simplify the profile: fewer stages, standard patterns\n"
    "• NEVER give up — always attempt at least 3 retries with different approaches\n"
    "• If a complex design keeps failing, fall back to a simpler but still excellent profile\n\n"
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
    "1. Use the OEPF Reference and Profiling Guide below to inform your stage design, dynamics, exit triggers, and limits.\n"
    "2. Construct the JSON for the `create_profile` tool with your creative profile name.\n"
    "3. EXECUTE the tool immediately.\n"
    "4. After successful creation, provide a user summary with:\n"
    "   • Profile Name & Brief Description: What was created\n"
    "   • Preparation Instructions: How it should be prepared (dose, temp, timing)\n"
    "   • Design Rationale: Why the recipe/profile is designed this way\n"
    "   • Special Requirements: Any special gear needed (bottom filter, specific dosage, unique prep steps)\n\n"
)

# Build the reference sections once
_PROFILING_GUIDE = (
    f"ESPRESSO PROFILING GUIDE:\n"
    f"Use this expert knowledge to design profiles with proper phase structure, "
    f"dynamics, troubleshooting awareness, and best practices.\n\n"
    f"{PROFILING_KNOWLEDGE}\n\n"
)

_OEPF_REFERENCE = (
    f"OPEN ESPRESSO PROFILE FORMAT (OEPF) REFERENCE:\n"
    f"Use the following specification to ensure your profile JSON is valid and well-structured.\n\n"
    f"{_OEPF_RFC}\n\n"
) if _OEPF_RFC else ""


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
        
        # Offload CPU-bound PIL ops to a thread
        def _open_image(data: bytes):
            img = Image.open(io.BytesIO(data))
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
            return img
        
        loop = asyncio.get_event_loop()
        image = await loop.run_in_executor(None, _open_image, contents)
        
        logger.debug(
            "Image loaded successfully",
            extra={
                "request_id": request_id,
                "image_size": f"{image.width}x{image.height}",
                "image_format": image.format
            }
        )
        
        response = await get_vision_model().async_generate_content([
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
            
            # Offload CPU-bound PIL ops to a thread
            def _open_image(data: bytes):
                img = Image.open(io.BytesIO(data))
                if img.mode not in ('RGB', 'L'):
                    img = img.convert('RGB')
                return img
            
            loop = asyncio.get_event_loop()
            image = await loop.run_in_executor(None, _open_image, contents)
            
            # Analyze the coffee bag
            analysis_start = time.monotonic()
            analysis_response = await get_vision_model().async_generate_content([
                "Analyze this coffee bag. Extract: Roaster, Origin, Roast Level, and Flavor Notes. "
                "Return ONLY a single concise sentence describing the coffee.", 
                image
            ])
            coffee_analysis = analysis_response.text.strip()
            analysis_elapsed = time.monotonic() - analysis_start
            
            logger.info(
                "Coffee analysis completed",
                extra={
                    "request_id": request_id,
                    "analysis": coffee_analysis,
                    "analysis_seconds": round(analysis_elapsed, 1),
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
                VALIDATION_RULES +
                ERROR_RECOVERY +
                NAMING_CONVENTION +
                author_instruction +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT +
                _PROFILING_GUIDE +
                _OEPF_REFERENCE
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
                VALIDATION_RULES +
                ERROR_RECOVERY +
                NAMING_CONVENTION +
                author_instruction +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT +
                _PROFILING_GUIDE +
                _OEPF_REFERENCE
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
                VALIDATION_RULES +
                ERROR_RECOVERY +
                NAMING_CONVENTION +
                author_instruction +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT +
                _PROFILING_GUIDE +
                _OEPF_REFERENCE
            )
        
        logger.debug(
            "Executing profile creation via Gemini",
            extra={
                "request_id": request_id,
                "prompt_length": len(final_prompt)
            }
        )
        
        # Execute profile creation via Gemini CLI
        # Note: Using -y (yolo mode) to auto-approve tool calls.
        # The --allowed-tools flag doesn't work with MCP-provided tools.
        # Security is maintained because the MCP server only exposes safe tools.
        cli_start = time.monotonic()
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "gemini", "-y",
                final_prompt
            ],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout to prevent hanging forever
        )
        cli_elapsed = time.monotonic() - cli_start
        logger.info(
            "Gemini CLI completed",
            extra={
                "request_id": request_id,
                "cli_seconds": round(cli_elapsed, 1),
                "returncode": result.returncode,
            }
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
        
        # Clean up Gemini CLI noise from the output
        reply = clean_gemini_output(result.stdout)
        
        # Log stderr even on success — captures MCP validation errors
        # that the LLM saw but we otherwise can't observe
        stderr_text = result.stderr if isinstance(result.stderr, str) else ""
        if stderr_text.strip():
            logger.warning(
                "Gemini CLI stderr (exit 0)",
                extra={
                    "request_id": request_id,
                    "stderr": stderr_text[:2000],
                }
            )
        
        # Detect silent failure: Gemini returns exit code 0 but the LLM
        # couldn't actually create a profile (e.g. MCP validation errors
        # that the LLM gave up trying to fix).
        from services.history_service import _extract_profile_json
        profile_json_check = _extract_profile_json(reply)
        has_profile_created_header = bool(
            re.search(r'(?:\*\*)?Profile Created:(?:\*\*)?', reply, re.IGNORECASE)
        )
        
        if not profile_json_check and not has_profile_created_header:
            logger.error(
                "Gemini CLI exited 0 but no profile was created (LLM failure)",
                extra={
                    "request_id": request_id,
                    "reply_preview": reply[:500],
                    "stderr": stderr_text[:1000],
                }
            )
            # Still save to history so user can see what happened
            history_entry = save_to_history(
                coffee_analysis=coffee_analysis,
                user_prefs=user_prefs,
                reply=reply
            )
            return {
                "status": "error",
                "analysis": coffee_analysis,
                "reply": reply,
                "message": (
                    "The AI attempted to create a profile but encountered "
                    "validation errors it couldn't resolve. Please try again — "
                    "the AI will often succeed on a second attempt with a "
                    "different approach."
                ),
                "history_id": history_entry.get("id")
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
            reply=reply
        )
            
        return {
            "status": "success",
            "analysis": coffee_analysis,
            "reply": reply,
            "history_id": history_entry.get("id")
        }

    except subprocess.TimeoutExpired:
        logger.error(
            "Gemini CLI timed out after 300s",
            extra={
                "request_id": request_id,
                "endpoint": "/analyze_and_profile",
                "coffee_analysis": coffee_analysis
            }
        )
        raise HTTPException(
            status_code=504,
            detail={
                "status": "error",
                "analysis": coffee_analysis if coffee_analysis else None,
                "message": "Profile creation timed out. The AI took too long to respond. Please try again."
            }
        )
    except HTTPException:
        raise
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
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "analysis": coffee_analysis if coffee_analysis else None,
                "message": str(e)
            }
        )
