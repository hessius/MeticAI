"""Gemini service for AI model configuration and prompt building."""

import google.generativeai as genai
import os
import re
from typing import Optional
from services.settings_service import get_author_name
from logging_config import get_logger

logger = get_logger()

# Lazy-loaded vision model
_vision_model = None

# Lines the Gemini CLI may leak into stdout that are not part of the response
_GEMINI_NOISE_PREFIXES = (
    "YOLO mode is enabled",
    "Hook registry initialized",
    "Error executing tool ",
)

# ANSI escape code pattern
_ANSI_ESCAPE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]')


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
