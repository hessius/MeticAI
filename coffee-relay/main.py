from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import google.generativeai as genai
from PIL import Image
import io
import os
import subprocess

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
                f"CONTEXT: You control a Meticulous Espresso Machine via local API.\n"
                f"User Instructions: '{user_prefs}'\n\n"
                "TASK: Create a sophisticated espresso profile based on the user's instructions.\n\n" +
                PROFILE_GUIDELINES +
                NAMING_CONVENTION +
                USER_SUMMARY_INSTRUCTIONS +
                OUTPUT_FORMAT
            )
        
        # Execute profile creation via docker
        result = subprocess.run(
            [
                "docker", "exec", "-i", "gemini-client", 
                "gemini", "prompt", 
                "--allowed-tools", "create_profile", "apply_profile",
                final_prompt
            ],
            input="y\n", 
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