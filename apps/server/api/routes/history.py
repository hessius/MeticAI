"""Profile history management endpoints."""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import logging

from services.history_service import load_history, save_history
from utils.sanitization import clean_profile_name

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/history")
async def get_history(
    request: Request,
    limit: int = 50,
    offset: int = 0
):
    """Get profile history.
    
    Args:
        limit: Maximum number of entries to return (default: 50)
        offset: Number of entries to skip (default: 0)
    
    Returns:
        - entries: List of history entries
        - total: Total number of entries
    """
    request_id = request.state.request_id
    
    try:
        logger.debug(
            "Fetching profile history",
            extra={"request_id": request_id, "limit": limit, "offset": offset}
        )
        
        history = load_history()
        total = len(history)
        
        # Apply pagination
        entries = history[offset:offset + limit]
        
        # Remove large fields from list view and ensure required fields exist
        sanitized_entries = []
        for entry in entries:
            entry_copy = dict(entry)  # avoid mutating cached history entries
            if "image_preview" in entry_copy:
                entry_copy["image_preview"] = None  # Remove for list view to save bandwidth
            # Ensure profile_name is always a string (defense against corrupt data)
            if not entry_copy.get("profile_name"):
                entry_copy["profile_name"] = entry_copy.get("profile_json", {}).get("name", "Untitled Profile") if isinstance(entry_copy.get("profile_json"), dict) else "Untitled Profile"
            sanitized_entries.append(entry_copy)
        
        return {
            "entries": sanitized_entries,
            "total": total,
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(
            f"Failed to retrieve history: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to retrieve history"}
        )


@router.get("/api/history/{entry_id}")
async def get_history_entry(request: Request, entry_id: str):
    """Get a specific history entry by ID.
    
    Args:
        entry_id: The unique ID of the history entry
    
    Returns:
        The full history entry including profile JSON
    """
    request_id = request.state.request_id
    
    try:
        logger.debug(
            "Fetching history entry",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        history = load_history()
        
        for entry in history:
            if entry.get("id") == entry_id:
                # Ensure profile_name is always a string
                if not entry.get("profile_name"):
                    pj = entry.get("profile_json")
                    entry["profile_name"] = pj.get("name", "Untitled Profile") if isinstance(pj, dict) else "Untitled Profile"
                return entry
        
        raise HTTPException(status_code=404, detail="History entry not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to retrieve history entry: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "entry_id": entry_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to retrieve history entry"}
        )


@router.delete("/api/history/{entry_id}")
async def delete_history_entry(request: Request, entry_id: str):
    """Delete a specific history entry.
    
    Args:
        entry_id: The unique ID of the history entry to delete
    
    Returns:
        Success status
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Deleting history entry",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        history = load_history()
        original_length = len(history)
        
        history = [entry for entry in history if entry.get("id") != entry_id]
        
        if len(history) == original_length:
            raise HTTPException(status_code=404, detail="History entry not found")
        
        save_history(history)
        
        return {"status": "success", "message": "History entry deleted"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to delete history entry: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "entry_id": entry_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to delete history entry"}
        )


@router.delete("/api/history")
async def clear_history(request: Request):
    """Clear all profile history.
    
    Returns:
        Success status
    """
    request_id = request.state.request_id
    
    try:
        logger.warning(
            "Clearing all history",
            extra={"request_id": request_id}
        )
        
        save_history([])
        
        return {"status": "success", "message": "All history cleared"}
        
    except Exception as e:
        logger.error(
            f"Failed to clear history: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to clear history"}
        )


@router.post("/api/history/migrate")
async def migrate_history_profile_names(request: Request):
    """Migrate history to clean up malformed profile names.
    
    This fixes profile names that have markdown artifacts like ** or *.
    
    Returns:
        Number of entries fixed
    """
    request_id = request.state.request_id
    
    try:
        history = load_history()
        fixed_count = 0
        
        for entry in history:
            old_name = entry.get("profile_name", "")
            new_name = clean_profile_name(old_name)
            
            if old_name != new_name:
                entry["profile_name"] = new_name
                fixed_count += 1
                logger.info(
                    f"Fixed profile name: '{old_name}' -> '{new_name}'",
                    extra={"request_id": request_id}
                )
        
        if fixed_count > 0:
            save_history(history)
        
        logger.info(
            f"Migration complete: {fixed_count} profile names fixed",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": f"Fixed {fixed_count} profile names",
            "fixed_count": fixed_count
        }
        
    except Exception as e:
        logger.error(
            f"Failed to migrate history: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to migrate history"}
        )


@router.get("/api/history/{entry_id}/json")
async def get_profile_json(request: Request, entry_id: str):
    """Get the profile JSON for download.
    
    Args:
        entry_id: The unique ID of the history entry
    
    Returns:
        The profile JSON with proper Content-Disposition header for download
    """
    request_id = request.state.request_id
    
    try:
        logger.debug(
            "Fetching profile JSON for download",
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        
        history = load_history()
        
        for entry in history:
            if entry.get("id") == entry_id:
                if not entry.get("profile_json"):
                    raise HTTPException(
                        status_code=404, 
                        detail="Profile JSON not available for this entry"
                    )
                
                # Create filename from profile name
                profile_name = entry.get("profile_name", "profile")
                safe_filename = "".join(
                    c if c.isalnum() or c in (' ', '-', '_') else ''
                    for c in profile_name
                ).strip().replace(' ', '-').lower()
                
                return JSONResponse(
                    content=entry["profile_json"],
                    headers={
                        "Content-Disposition": f'attachment; filename="{safe_filename}.json"'
                    }
                )
        
        raise HTTPException(status_code=404, detail="History entry not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get profile JSON: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "entry_id": entry_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to get profile JSON"}
        )


@router.get("/api/history/{entry_id}/notes")
async def get_history_notes(entry_id: str, request: Request):
    """Get notes for a history entry.
    
    Args:
        entry_id: The ID of the history entry.
    
    Returns:
        notes: The notes content (or null if none).
    """
    from services.history_service import get_entry_by_id
    
    entry = get_entry_by_id(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="History entry not found")
    
    return {
        "status": "success",
        "notes": entry.get("notes"),
        "notes_updated_at": entry.get("notes_updated_at"),
    }


@router.patch("/api/history/{entry_id}/notes")
async def update_history_notes(entry_id: str, request: Request):
    """Update notes for a history entry.
    
    Args:
        entry_id: The ID of the history entry.
    
    Body:
        notes: The new notes content (Markdown). Empty to clear.
    
    Returns:
        Updated notes information.
    """
    from services.history_service import update_entry_notes
    
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        notes_text = body.get("notes", "")
        
        updated_entry = update_entry_notes(entry_id, notes_text)
        
        if not updated_entry:
            raise HTTPException(status_code=404, detail="History entry not found")
        
        return {
            "status": "success",
            "notes": updated_entry.get("notes"),
            "notes_updated_at": updated_entry.get("notes_updated_at"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to update history notes: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "entry_id": entry_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )
