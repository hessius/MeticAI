from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from typing import Optional
import google.generativeai as genai
from PIL import Image
import io
import os
import subprocess

app = FastAPI()

# 1. Setup "The Eye"
genai.configure(api_key=os.environ["GEMINI_API_KEY"])
vision_model = genai.GenerativeModel('gemini-2.0-flash')

@app.post("/analyze_coffee")
async def analyze_coffee(file: UploadFile = File(...)):
    """Phase 1: Look at the bag."""
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        response = vision_model.generate_content([
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
    
    try:
        coffee_analysis = None
        
        # If image is provided, analyze it first
        if file:
            contents = await file.read()
            image = Image.open(io.BytesIO(contents))
            
            # Analyze the coffee bag
            analysis_response = vision_model.generate_content([
                "Analyze this coffee bag. Extract: Roaster, Origin, Roast Level, and Flavor Notes. "
                "Return ONLY a single concise sentence describing the coffee.", 
                image
            ])
            coffee_analysis = analysis_response.text.strip()
        
        # Construct the profile creation prompt
        if coffee_analysis and user_prefs:
            # Both image and preferences provided
            final_prompt = (
                f"Context: You are an automated Coffee Agent controlling a Meticulous Machine via local API. "
                f"Coffee Analysis: '{coffee_analysis}' "
                f"User Preferences: '{user_prefs}' "
                f"Task: Create an espresso profile based on the coffee analysis and user preferences. "
                
                "INSTRUCTIONS:"
                "1. Construct the JSON for the `create_profile` tool."
                "2. EXECUTE the tool immediately."
                "3. If successful, simply output 'Profile uploaded'."
            )
        elif coffee_analysis:
            # Only image provided
            final_prompt = (
                f"Context: You are an automated Coffee Agent controlling a Meticulous Machine via local API. "
                f"Task: Create an espresso profile for '{coffee_analysis}'. "
                
                "INSTRUCTIONS:"
                "1. Construct the JSON for the `create_profile` tool."
                "2. EXECUTE the tool immediately."
                "3. If successful, simply output 'Profile uploaded'."
            )
        else:
            # Only user preferences provided
            final_prompt = (
                f"Context: You are an automated Coffee Agent controlling a Meticulous Machine via local API. "
                f"User Instructions: '{user_prefs}' "
                f"Task: Create an espresso profile based on the user's instructions. "
                
                "INSTRUCTIONS:"
                "1. Construct the JSON for the `create_profile` tool."
                "2. EXECUTE the tool immediately."
                "3. If successful, simply output 'Profile uploaded'."
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
