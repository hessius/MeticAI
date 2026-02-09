"""Input sanitization functions for MeticAI server."""

import re


def sanitize_profile_name_for_filename(profile_name: str) -> str:
    """Safely sanitize profile name for use in filenames.
    
    Args:
        profile_name: The profile name to sanitize
        
    Returns:
        A safe filename string
        
    Note:
        This prevents path traversal attacks by removing/replacing
        all potentially dangerous characters.
    """
    # Remove any path separators and parent directory references
    safe_name = profile_name.replace('/', '_').replace('\\', '_').replace('..', '_')
    # Keep only alphanumeric, spaces, hyphens, and underscores
    safe_name = re.sub(r'[^a-zA-Z0-9\s\-_]', '_', safe_name)
    # Replace spaces with underscores and convert to lowercase
    safe_name = safe_name.replace(' ', '_').lower()
    # Limit length to prevent filesystem issues
    return safe_name[:200]


def clean_profile_name(name: str) -> str:
    """Clean markdown artifacts from profile name.
    
    Args:
        name: The profile name to clean
        
    Returns:
        Cleaned profile name without markdown formatting
    """
    # Remove leading/trailing ** or *
    cleaned = re.sub(r'^[\*]+\s*', '', name)
    cleaned = re.sub(r'\s*[\*]+$', '', cleaned)
    # Remove any remaining ** pairs
    cleaned = cleaned.replace('**', '')
    return cleaned.strip()
