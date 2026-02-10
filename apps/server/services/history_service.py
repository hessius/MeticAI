"""History service for managing profile creation history."""

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from logging_config import get_logger
from config import DATA_DIR
from utils.file_utils import atomic_write_json
from utils.sanitization import clean_profile_name

logger = get_logger()

HISTORY_FILE = DATA_DIR / "profile_history.json"


def ensure_history_file():
    """Ensure the history file and directory exist."""
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not HISTORY_FILE.exists():
        HISTORY_FILE.write_text("[]")


def load_history() -> list:
    """Load history from file."""
    ensure_history_file()
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def save_history(history: list):
    """Save history to file atomically to prevent corruption."""
    ensure_history_file()
    atomic_write_json(HISTORY_FILE, history)


def _extract_profile_json(reply: str) -> Optional[dict]:
    """Extract the profile JSON from the LLM reply.
    
    Searches for JSON blocks in the reply, trying different patterns.
    """
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
    # Handle both **Profile Created:** and Profile Created: formats, with 0 or 2 asterisks
    match = re.search(r'(?:\*\*)?Profile Created:(?:\*\*)?\s*(.+?)(?:\n|$)', reply, re.IGNORECASE)
    if match:
        return clean_profile_name(match.group(1))
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
    history = load_history()
    
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
    
    save_history(history)
    
    logger.info(
        f"Saved profile to history: {profile_name}",
        extra={"entry_id": entry_id, "has_json": profile_json is not None}
    )
    
    return entry
