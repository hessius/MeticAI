"""Gemini service for AI model configuration and prompt building."""

from google import genai
import asyncio
import os
import re
from typing import Optional
from services.settings_service import get_author_name
from logging_config import get_logger

logger = get_logger()

# Lazy-loaded Gemini client
_gemini_client: Optional[genai.Client] = None
_MODEL_NAME = "gemini-2.0-flash"

# Lines the Gemini CLI may leak into stdout that are not part of the response
_GEMINI_NOISE_PREFIXES = (
    "YOLO mode is enabled",
    "Hook registry initialized",
    "Error executing tool ",
)

# ANSI escape code pattern
_ANSI_ESCAPE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]')

# Shared espresso profiling knowledge for LLM context.
# Used by shot analysis, profile description generation, and description conversion.
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


def clean_gemini_output(text: str) -> str:
    """Strip Gemini CLI noise lines and ANSI codes from output.
    
    The Gemini CLI sometimes leaks diagnostic lines (YOLO mode, hook registry,
    MCP tool error retries) into stdout. This function removes them so only
    the actual LLM response is returned to the user.
    
    Args:
        text: Raw stdout from the Gemini CLI
        
    Returns:
        Cleaned text with only the LLM response
    """
    if not text:
        return text
    
    # Strip ANSI escape codes
    text = _ANSI_ESCAPE.sub('', text)
    
    # Filter out noise lines
    lines = text.split('\n')
    clean_lines = [
        line for line in lines
        if not any(line.strip().startswith(prefix) for prefix in _GEMINI_NOISE_PREFIXES)
    ]
    
    return '\n'.join(clean_lines).strip()


def parse_gemini_error(error_text: str) -> str:
    """Parse Gemini CLI error output and return a user-friendly message.
    
    The Gemini CLI often returns verbose stack traces. This function extracts
    the meaningful error message for display to end users.
    
    Args:
        error_text: Raw stderr output from the Gemini CLI
        
    Returns:
        A clean, user-friendly error message
    """
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


def reset_vision_model():
    """Reset the cached Gemini client.
    
    Call this when the GEMINI_API_KEY changes so the next call to
    get_gemini_client() will re-create with the new key.
    """
    global _gemini_client
    _gemini_client = None


def get_gemini_client() -> genai.Client:
    """Lazily initialize and return the Gemini client."""
    global _gemini_client
    if _gemini_client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY environment variable is required but not set. "
                "Please set it before starting the server."
            )
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def get_vision_model():
    """Return a wrapper that provides the old model.generate_content() interface.
    
    This exists for backward compatibility. Callers can do:
        model = get_vision_model()
        response = model.generate_content([prompt, image])
        text = response.text
    """
    return _GeminiModelWrapper(get_gemini_client())


class _GeminiModelWrapper:
    """Thin wrapper around google.genai.Client to provide the old GenerativeModel interface."""
    
    def __init__(self, client: genai.Client):
        self._client = client
    
    def generate_content(self, contents):
        """Call generate_content on the Gemini API (synchronous).
        
        Args:
            contents: A string, list of strings, PIL images, or mixed list
                     (same format accepted by both old and new SDK).
        
        Returns:
            GenerateContentResponse with .text attribute.
        """
        return self._client.models.generate_content(
            model=_MODEL_NAME,
            contents=contents,
        )

    async def async_generate_content(self, contents):
        """Non-blocking wrapper around generate_content.
        
        Runs the synchronous Gemini SDK call in a thread pool executor
        so it doesn't block the asyncio event loop.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.generate_content, contents
        )


def get_author_instruction() -> str:
    """Get the author instruction for profile creation prompts."""
    author = get_author_name()
    return (
        f"AUTHOR:\n"
        f"• Set the 'author' field in the profile JSON to: \"{author}\"\n"
        f"• This name will appear as the profile creator on the Meticulous device\n\n"
    )


def build_advanced_customization_section(advanced_customization: Optional[str]) -> str:
    """Build the advanced customization section for the prompt.
    
    These are MANDATORY equipment and extraction parameters that MUST be followed.
    """
    if not advanced_customization:
        return ""
    
    return (
        f"⚠️ MANDATORY EQUIPMENT & EXTRACTION PARAMETERS (MUST BE USED EXACTLY):\n"
        f"{advanced_customization}\n\n"
        f"CRITICAL: You MUST configure the profile to use these EXACT values. "
        f"These are non-negotiable hardware/extraction constraints:\n"
        f"• If a temperature is specified, set the profile temperature to that EXACT value\n"
        f"• If a dose is specified, the profile MUST be designed for that EXACT dose\n"
        f"• If max pressure/flow is specified, NO stage should exceed those limits\n"
        f"• If basket size/type is specified, account for it in your dose and extraction design\n"
        f"• If bottom filter is specified, mention it in preparation notes\n\n"
    )
