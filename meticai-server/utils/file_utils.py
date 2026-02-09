"""File utility functions for MeticAI server."""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def deep_convert_to_dict(obj: Any) -> Any:
    """Recursively convert an object with __dict__ to a JSON-serializable dict.
    
    Handles nested objects, lists, and special types that can't be directly serialized.
    
    Args:
        obj: The object to convert
        
    Returns:
        A JSON-serializable representation of the object
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


def atomic_write_json(filepath: Path, data: Any, indent: int = 2) -> None:
    """Write JSON data to a file atomically to prevent corruption.
    
    Writes to a temporary file first, then renames it to the target path.
    This ensures the file is never left in a partially-written state.
    
    Args:
        filepath: Path to the target file
        data: Data to write (must be JSON-serializable)
        indent: Number of spaces for JSON indentation
        
    Raises:
        Exception: If the write operation fails
    """
    # Serialize the data first to catch any serialization errors before writing
    json_str = json.dumps(data, indent=indent, default=str)
    
    # Write to a temporary file in the same directory
    temp_fd, temp_path = tempfile.mkstemp(
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
            # Ignore errors during cleanup (temp file may already be deleted)
            pass
        raise
