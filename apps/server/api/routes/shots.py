"""Shot history and analysis endpoints."""
from fastapi import APIRouter, Request, Form, HTTPException
from typing import Optional
import asyncio
import json
import re
import time
import logging
import httpx
import requests

from services.meticulous_service import (
    fetch_shot_data,
    async_list_profiles, async_get_history_dates,
    async_get_shot_files, async_get_profile,
    MachineUnreachableError,
)
from services.cache_service import (
    get_cached_llm_analysis, save_llm_analysis_to_cache,
    _get_cached_shots, _set_cached_shots
)
from services.analysis_service import _perform_local_shot_analysis
from services.gemini_service import get_vision_model, PROFILING_KNOWLEDGE, compute_taste_hash
from prompt_builder import build_taste_context

router = APIRouter()
logger = logging.getLogger(__name__)


def _safe_float(val, default=0.0):
    """Convert a value to float safely, returning default on failure."""
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


@router.get("/api/last-shot")
async def get_last_shot(request: Request):
    """Return metadata for the most recent shot without loading full telemetry.

    This powers the "Analyze your last shot?" banner on the home screen.
    Returns 404 if no shots exist.
    """
    request_id = request.state.request_id
    try:
        dates_result = await async_get_history_dates()
        if hasattr(dates_result, "error") and dates_result.error:
            raise HTTPException(status_code=502, detail=f"Machine API error: {dates_result.error}")

        dates = sorted([d.name for d in dates_result], reverse=True) if dates_result else []
        if not dates:
            raise HTTPException(status_code=404, detail="No shots found")

        # Walk dates newest-first until we find a file
        for date in dates:
            files_result = await async_get_shot_files(date)
            if hasattr(files_result, "error") and files_result.error:
                continue
            files = sorted([f.name for f in files_result], reverse=True) if files_result else []
            if not files:
                continue

            filename = files[0]
            shot_data = await fetch_shot_data(date, filename)

            profile_name = shot_data.get("profile_name", "")
            if not profile_name and isinstance(shot_data.get("profile"), dict):
                profile_name = shot_data["profile"].get("name", "")

            data_entries = shot_data.get("data", [])
            final_weight = None
            total_time_ms = None
            if data_entries:
                last_entry = data_entries[-1]
                if isinstance(last_entry.get("shot"), dict):
                    final_weight = last_entry["shot"].get("weight")
                total_time_ms = last_entry.get("time")

            return {
                "profile_name": profile_name,
                "date": date,
                "filename": filename,
                "timestamp": shot_data.get("time"),
                "final_weight": final_weight,
                "total_time": total_time_ms / 1000 if total_time_ms else None,
            }

        raise HTTPException(status_code=404, detail="No shots found")

    except MachineUnreachableError:
        raise
    except (requests.exceptions.ConnectionError, httpx.ConnectError, httpx.ConnectTimeout) as e:
        logger.warning(
            f"Machine unreachable while fetching last shot: {e}",
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Espresso machine is unreachable. Check that the machine is powered on "
                "and METICULOUS_IP is correct in Settings."
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get last shot: {e}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=500, detail=str(e))


def _prepare_profile_for_llm(profile_data: dict, description: str | None) -> dict:
    """Prepare profile data for LLM, removing image and limiting description."""
    # Build clean profile without image
    clean_profile = {
        "name": profile_data.get("name"),
        "temperature": profile_data.get("temperature"),
        "final_weight": profile_data.get("final_weight"),
        "variables": profile_data.get("variables", []),
        "stages": []
    }
    
    # Include stage structure but not full dynamics data
    for stage in profile_data.get("stages", []):
        clean_stage = {
            "name": stage.get("name"),
            "type": stage.get("type"),
            "exit_triggers": stage.get("exit_triggers", []),
            "limits": stage.get("limits", [])
        }
        # Add a summary of dynamics
        dynamics = stage.get("dynamics_points", [])
        if dynamics:
            if len(dynamics) == 1:
                clean_stage["target"] = f"Constant at {dynamics[0][1] if len(dynamics[0]) > 1 else dynamics[0][0]}"
            elif len(dynamics) >= 2:
                start = dynamics[0][1] if len(dynamics[0]) > 1 else dynamics[0][0]
                end = dynamics[-1][1] if len(dynamics[-1]) > 1 else dynamics[-1][0]
                clean_stage["target"] = f"{start} → {end}"
        clean_profile["stages"].append(clean_stage)
    
    return clean_profile


@router.get("/api/shots/dates")
async def get_shot_dates(request: Request):
    """Get all available shot dates from the machine.
    
    Returns:
        List of dates with available shot history
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching shot history dates",
            extra={"request_id": request_id}
        )
        
        result = await async_get_history_dates()
        
        # Check for API error
        if hasattr(result, 'error') and result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {result.error}"
            )
        
        # Extract date names
        dates = [d.name for d in result] if result else []
        
        return {"dates": sorted(dates, reverse=True)}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to fetch shot dates: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch shot dates from machine"}
        )


@router.get("/api/shots/files/{date}")
async def get_shot_files(request: Request, date: str):
    """Get shot files for a specific date.
    
    Args:
        date: Date in YYYY-MM-DD format
        
    Returns:
        List of shot filenames for that date
    """
    # Validate date format to prevent path traversal
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date):
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")
    
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching shot files for date",
            extra={"request_id": request_id, "date": date}
        )
        
        result = await async_get_shot_files(date)
        
        # Check for API error
        if hasattr(result, 'error') and result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {result.error}"
            )
        
        # Extract filenames
        files = [f.name for f in result] if result else []
        
        return {"date": date, "files": files}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to fetch shot files: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "date": date, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch shot files from machine"}
        )


@router.get("/api/shots/data/{date}/{filename:path}")
async def get_shot_data(request: Request, date: str, filename: str):
    """Get the actual shot data for a specific shot.
    
    Args:
        date: Date in YYYY-MM-DD format
        filename: Shot filename (e.g., HH:MM:SS.shot.json.zst)
        
    Returns:
        Decompressed shot data with telemetry
    """
    # Validate inputs to prevent path traversal / SSRF
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date):
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")
    if '..' in filename or filename.startswith('/'):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching shot data",
            extra={"request_id": request_id, "date": date, "shot_file": filename}
        )
        
        shot_data = await fetch_shot_data(date, filename)
        
        return {
            "date": date,
            "filename": filename,
            "data": shot_data
        }
        
    except Exception as e:
        logger.error(
            f"Failed to fetch shot data: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "date": date, "shot_file": filename, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch shot data from machine"}
        )


@router.get("/api/shots/by-profile/{profile_name}")
async def get_shots_by_profile(
    request: Request, 
    profile_name: str,
    limit: int = 20,
    include_data: bool = False,
    force_refresh: bool = False
):
    """Get all shots that used a specific profile.
    
    This endpoint scans shot history to find all shots that match the given profile name.
    Results are cached server-side indefinitely, but marked stale after 60 minutes.
    When stale, cached data is still returned with is_stale=true so client can show it
    while fetching fresh data in the background.
    
    Args:
        profile_name: Name of the profile to search for
        limit: Maximum number of shots to return (default: 20)
        include_data: Whether to include full telemetry data (default: False for performance)
        force_refresh: Skip cache and fetch fresh data (default: False)
        
    Returns:
        List of shots matching the profile, with cache metadata (cached_at, is_stale)
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Searching for shots by profile",
            extra={"request_id": request_id, "profile_name": profile_name, "limit": limit, "force_refresh": force_refresh}
        )
        
        # Check server-side cache first (unless forcing refresh or requesting data)
        if not force_refresh and not include_data:
            cached_data, is_stale, cached_at = _get_cached_shots(profile_name, limit)
            if cached_data:
                logger.info(
                    f"Returning cached shots for profile '{profile_name}' (stale={is_stale})",
                    extra={"request_id": request_id, "count": cached_data.get("count", 0), "from_cache": True, "is_stale": is_stale}
                )
                # Add cache metadata to response
                cached_data["cached_at"] = cached_at
                cached_data["is_stale"] = is_stale
                return cached_data
        
        # Get all available dates
        dates_result = await async_get_history_dates()
        if hasattr(dates_result, 'error') and dates_result.error:
            raise HTTPException(
                status_code=502,
                detail=f"Machine API error: {dates_result.error}"
            )
        
        dates = [d.name for d in dates_result] if dates_result else []
        matching_shots = []
        
        # Concurrency limiter — avoid overwhelming the machine with requests
        sem = asyncio.Semaphore(6)
        
        async def _fetch_and_match(date: str, filename: str):
            """Fetch a single shot and return info dict if it matches, else None."""
            async with sem:
                try:
                    shot_data = await fetch_shot_data(date, filename)
                except Exception as e:
                    logger.warning(
                        f"Could not process shot {date}/{filename}: {str(e)}",
                        extra={"request_id": request_id}
                    )
                    return None
                
                # Extract profile name from shot data
                shot_profile_name = shot_data.get("profile_name", "")
                if not shot_profile_name and isinstance(shot_data.get("profile"), dict):
                    shot_profile_name = shot_data.get("profile", {}).get("name", "")
                
                if shot_profile_name.lower() != profile_name.lower():
                    return None
                
                data_entries = shot_data.get("data", [])
                final_weight = None
                total_time_ms = None
                
                if data_entries:
                    last_entry = data_entries[-1]
                    if isinstance(last_entry.get("shot"), dict):
                        final_weight = last_entry["shot"].get("weight")
                    total_time_ms = last_entry.get("time")
                
                shot_info = {
                    "date": date,
                    "filename": filename,
                    "timestamp": shot_data.get("time"),
                    "profile_name": shot_profile_name,
                    "final_weight": final_weight,
                    "total_time": total_time_ms / 1000 if total_time_ms else None,
                }
                
                if include_data:
                    shot_info["data"] = shot_data
                
                return shot_info
        
        # Search through dates (most recent first), fetch files concurrently per date
        for date in sorted(dates, reverse=True):
            if len(matching_shots) >= limit:
                break
                
            # Get file listing for this date (lightweight, sequential is fine)
            files_result = await async_get_shot_files(date)
            if hasattr(files_result, 'error') and files_result.error:
                logger.warning(f"Could not get files for {date}: {files_result.error}")
                continue
            
            files = [f.name for f in files_result] if files_result else []
            if not files:
                continue
            
            # Fire off all shot fetches for this date concurrently
            tasks = [_fetch_and_match(date, fn) for fn in files]
            results = await asyncio.gather(*tasks)
            
            # Collect matches (preserve chronological order)
            for result in results:
                if result is not None:
                    matching_shots.append(result)
                    if len(matching_shots) >= limit:
                        break
        
        logger.info(
            f"Found {len(matching_shots)} shots for profile '{profile_name}'",
            extra={"request_id": request_id, "count": len(matching_shots)}
        )
        
        current_time = time.time()
        response_data = {
            "profile_name": profile_name,
            "shots": matching_shots,
            "count": len(matching_shots),
            "limit": limit,
            "cached_at": current_time,
            "is_stale": False
        }
        
        # Cache the result (only if not including full data, which is too large)
        if not include_data:
            _set_cached_shots(profile_name, response_data, limit)
        
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to search shots by profile: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "profile_name": profile_name, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to search shots by profile"}
        )


@router.post("/api/shots/analyze")
async def analyze_shot(
    request: Request,
    profile_name: str = Form(...),
    shot_date: str = Form(...),
    shot_filename: str = Form(...),
    profile_description: Optional[str] = Form(None)
):
    """Analyze a shot against its profile using local algorithmic analysis.
    
    This endpoint fetches the shot data and profile information, then performs
    a detailed comparison of actual execution vs profile intent.
    
    Args:
        profile_name: Name of the profile used for the shot
        shot_date: Date of the shot (YYYY-MM-DD)
        shot_filename: Filename of the shot
        profile_description: Optional description of the profile's intent (for future AI use)
        
    Returns:
        Detailed analysis of shot performance against profile
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Starting shot analysis",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename
            }
        )
        
        # Fetch shot data
        shot_data = await fetch_shot_data(shot_date, shot_filename)
        
        # Fetch profile from machine
        profiles_result = await async_list_profiles()
        
        logger.debug(f"Looking for profile '{profile_name}' in {len(profiles_result)} profiles")
        
        profile_data = None
        for partial_profile in profiles_result:
            # Compare ignoring case and whitespace
            if partial_profile.name.lower().strip() == profile_name.lower().strip():
                logger.debug(f"Found matching profile: {partial_profile.name} (id={partial_profile.id})")
                full_profile = await async_get_profile(partial_profile.id)
                if not (hasattr(full_profile, 'error') and full_profile.error):
                    # Convert profile object to dict
                    profile_data = {
                        "name": full_profile.name,
                        "temperature": getattr(full_profile, 'temperature', None),
                        "final_weight": getattr(full_profile, 'final_weight', None),
                        "variables": [],
                        "stages": []
                    }
                    
                    # Extract variables if present
                    if hasattr(full_profile, 'variables') and full_profile.variables:
                        for var in full_profile.variables:
                            var_dict = {
                                "key": getattr(var, 'key', ''),
                                "name": getattr(var, 'name', ''),
                                "type": getattr(var, 'type', ''),
                                "value": getattr(var, 'value', 0)
                            }
                            profile_data["variables"].append(var_dict)
                    
                    # Extract full stage data including dynamics and triggers
                    if hasattr(full_profile, 'stages') and full_profile.stages:
                        for stage in full_profile.stages:
                            stage_dict = {
                                "name": getattr(stage, 'name', 'Unknown'),
                                "key": getattr(stage, 'key', ''),
                                "type": getattr(stage, 'type', 'unknown'),
                            }
                            # Add dynamics - handle both direct attributes and dynamics object
                            if hasattr(stage, 'dynamics') and stage.dynamics is not None:
                                dynamics = stage.dynamics
                                if hasattr(dynamics, 'points') and dynamics.points:
                                    stage_dict['dynamics_points'] = dynamics.points
                                if hasattr(dynamics, 'over'):
                                    stage_dict['dynamics_over'] = dynamics.over
                                if hasattr(dynamics, 'interpolation'):
                                    stage_dict['dynamics_interpolation'] = dynamics.interpolation
                            else:
                                # Fallback: check for direct attributes
                                for attr in ['dynamics_points', 'dynamics_over', 'dynamics_interpolation']:
                                    val = getattr(stage, attr, None)
                                    if val is not None:
                                        stage_dict[attr] = val
                            # Add exit triggers and limits
                            for attr in ['exit_triggers', 'limits']:
                                val = getattr(stage, attr, None)
                                if val is not None:
                                    # Convert to list of dicts if needed
                                    if isinstance(val, list):
                                        stage_dict[attr] = [
                                            dict(item) if hasattr(item, '__dict__') else item
                                            for item in val
                                        ]
                                    else:
                                        stage_dict[attr] = val
                            profile_data["stages"].append(stage_dict)
                break
        
        if not profile_data:
            # Fallback: try to get profile from shot data itself
            shot_profile = shot_data.get("profile", {})
            if shot_profile:
                profile_data = shot_profile
            else:
                raise HTTPException(
                    status_code=404,
                    detail=f"Profile '{profile_name}' not found on machine or in shot data"
                )
        
        # Perform local analysis
        analysis = _perform_local_shot_analysis(shot_data, profile_data)
        
        logger.info(
            "Shot analysis completed successfully",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "stages_analyzed": len(analysis.get("stage_analyses", [])),
                "unreached_stages": len(analysis.get("unreached_stages", []))
            }
        )
        
        return {
            "status": "success",
            "analysis": analysis
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Shot analysis failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename,
                "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Shot analysis failed"}
        )


@router.get("/api/shots/llm-analysis-cache")
async def get_llm_analysis_cache(
    request: Request,
    profile_name: str,
    shot_date: str,
    shot_filename: str
):
    """Check if a cached LLM analysis exists for the given shot.
    
    Returns the cached analysis if it exists and is not expired,
    otherwise returns null.
    """
    request_id = request.state.request_id
    
    logger.info(
        "Checking LLM analysis cache",
        extra={
            "request_id": request_id,
            "profile_name": profile_name,
            "shot_date": shot_date,
            "shot_filename": shot_filename
        }
    )
    
    cached = get_cached_llm_analysis(profile_name, shot_date, shot_filename)
    
    if cached:
        logger.info(
            "LLM analysis cache hit",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return {
            "status": "success",
            "cached": True,
            "analysis": cached
        }
    else:
        logger.info(
            "LLM analysis cache miss",
            extra={"request_id": request_id, "profile_name": profile_name}
        )
        return {
            "status": "success", 
            "cached": False,
            "analysis": None
        }


@router.post("/api/shots/analyze-llm")
async def analyze_shot_with_llm(
    request: Request,
    profile_name: str = Form(...),
    shot_date: str = Form(...),
    shot_filename: str = Form(...),
    profile_description: Optional[str] = Form(None),
    force_refresh: bool = Form(False),
    taste_x: Optional[float] = Form(None),
    taste_y: Optional[float] = Form(None),
    taste_descriptors: Optional[str] = Form(None),
):
    """Analyze a shot using LLM with expert profiling knowledge.
    
    This endpoint performs a deep analysis of shot execution, combining:
    - Local algorithmic analysis for data extraction
    - Expert espresso profiling knowledge
    - LLM reasoning for actionable recommendations
    
    Results are cached server-side for 3 days.
    Use force_refresh=True to bypass cache and regenerate analysis.
    
    Returns structured analysis answering:
    1. How did the shot go and why?
    2. What should change about the setup (grind, filter, basket, prep)?
    3. What should change about the profile?
    4. Any issues found in the profile design itself?
    """
    request_id = request.state.request_id

    # Validate taste coordinate bounds
    if taste_x is not None and not (-1.0 <= taste_x <= 1.0):
        raise HTTPException(status_code=422, detail="taste_x must be between -1 and 1")
    if taste_y is not None and not (-1.0 <= taste_y <= 1.0):
        raise HTTPException(status_code=422, detail="taste_y must be between -1 and 1")

    # Parse and validate taste descriptors from comma-separated string
    _VALID_DESCRIPTORS = {
        "sweet", "clean", "complex", "juicy", "smooth", "balanced", "floral", "fruity",
        "astringent", "muddy", "flat", "chalky", "harsh", "watery", "burnt", "grassy",
    }
    parsed_descriptors: list[str] | None = None
    if taste_descriptors:
        parsed_descriptors = [
            d.strip().lower()
            for d in taste_descriptors.split(",")
            if d.strip() and d.strip().lower() in _VALID_DESCRIPTORS
        ] or None

    # Compute taste hash for cache differentiation
    taste_hash = compute_taste_hash(taste_x, taste_y, parsed_descriptors)
    cache_filename = f"{shot_filename}_taste_{taste_hash}" if taste_hash else shot_filename
    
    try:
        logger.info(
            "Starting LLM shot analysis",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename,
                "force_refresh": force_refresh,
                "has_taste_data": taste_hash is not None,
            }
        )
        
        # Check cache first (unless force refresh)
        if not force_refresh:
            cached_analysis = get_cached_llm_analysis(profile_name, shot_date, cache_filename)
            if cached_analysis:
                logger.info(
                    "Returning cached LLM analysis",
                    extra={"request_id": request_id, "profile_name": profile_name}
                )
                return {
                    "status": "success",
                    "profile_name": profile_name,
                    "shot_date": shot_date,
                    "shot_filename": shot_filename,
                    "llm_analysis": cached_analysis,
                    "cached": True
                }
        
        # Fetch shot data
        shot_data = await fetch_shot_data(shot_date, shot_filename)
        
        # Fetch profile from machine (with variables)
        profiles_result = await async_list_profiles()
        
        profile_data = None
        for partial_profile in profiles_result:
            if partial_profile.name.lower() == profile_name.lower():
                full_profile = await async_get_profile(partial_profile.id)
                if not (hasattr(full_profile, 'error') and full_profile.error):
                    profile_data = {
                        "name": full_profile.name,
                        "temperature": getattr(full_profile, 'temperature', None),
                        "final_weight": getattr(full_profile, 'final_weight', None),
                        "variables": [],
                        "stages": []
                    }
                    
                    # Extract variables
                    if hasattr(full_profile, 'variables') and full_profile.variables:
                        for var in full_profile.variables:
                            profile_data["variables"].append({
                                "key": getattr(var, 'key', ''),
                                "name": getattr(var, 'name', ''),
                                "type": getattr(var, 'type', ''),
                                "value": getattr(var, 'value', 0)
                            })
                    
                    # Extract stages with full details
                    if hasattr(full_profile, 'stages') and full_profile.stages:
                        for stage in full_profile.stages:
                            stage_dict = {
                                "name": getattr(stage, 'name', 'Unknown'),
                                "key": getattr(stage, 'key', ''),
                                "type": getattr(stage, 'type', 'unknown'),
                            }
                            for attr in ['dynamics_points', 'dynamics_over', 'dynamics_interpolation', 'exit_triggers', 'limits']:
                                val = getattr(stage, attr, None)
                                if val is not None:
                                    if isinstance(val, list):
                                        stage_dict[attr] = [dict(item) if hasattr(item, '__dict__') else item for item in val]
                                    else:
                                        stage_dict[attr] = val
                            profile_data["stages"].append(stage_dict)
                break
        
        if not profile_data:
            raise HTTPException(
                status_code=404,
                detail=f"Profile '{profile_name}' not found on machine"
            )
        
        # Run local analysis first to extract data
        local_analysis = _perform_local_shot_analysis(shot_data, profile_data)
        
        # Prepare profile data (clean, no image)
        clean_profile = _prepare_profile_for_llm(profile_data, profile_description)
        
        # Build the LLM prompt with FULL local analysis
        taste_context = build_taste_context(taste_x, taste_y, parsed_descriptors)
        has_taste = bool(taste_context)

        # Adjust section count and formatting rules based on taste data
        section_count = "6" if has_taste else "5"
        taste_section_template = ""
        if has_taste:
            taste_section_template = """

## 6. Taste-Based Recommendations

**Taste-Extraction Correlation:**
- [How the reported taste aligns with extraction data]
- [Whether the data supports or contradicts the taste perception]

**Recommended Adjustments:**
- [Specific changes to address the taste issues — grind, dose, temp, time]
- [Expected taste impact of each change]

**Coffee Science:**
- [Brief explanation of why these adjustments should work]
"""

        prompt = f"""You are an expert espresso barista and profiling specialist analyzing a shot from a Meticulous Espresso Machine.

## Expert Knowledge
{PROFILING_KNOWLEDGE}

## Profile Being Used
Name: {clean_profile['name']}
Temperature: {clean_profile.get('temperature', 'Not set')}°C
Target Weight: {clean_profile.get('final_weight', 'Not set')}g

### Profile Description
{profile_description or 'No description provided - analyze the profile structure to understand intent.'}

### Profile Variables
{json.dumps(clean_profile.get('variables', []), indent=2)}

### Profile Stages
{json.dumps(clean_profile.get('stages', []), indent=2)}

## Full Local Analysis
This is the complete algorithmic analysis of the shot. Use this data to inform your expert analysis.

IMPORTANT: Each stage includes 'cumulative_weight_at_end' which shows the total weight when that stage ended.
If a stage ended early but the cumulative weight was near the target weight, the shot likely terminated 
correctly due to reaching the final weight target - this is NORMAL and EXPECTED behavior.
A stage that appears "short" may simply mean the target yield was reached, which is the correct outcome.

{json.dumps(local_analysis, indent=2)}
{taste_context}

---

Based on this data, provide a detailed expert analysis.

CRITICAL FORMATTING RULES:
1. You MUST use EXACTLY these {section_count} section headers with the exact format shown (## followed by number, period, space, then title)
2. Each section MUST have the subsection headers shown (bold text with colon, like **What Happened:**)
3. ALL content under subsections MUST be bullet points starting with "- "
4. Keep bullet points concise (1-2 sentences max per bullet)
5. Do NOT add extra sections or subsections beyond what's specified

## 1. Shot Performance

**What Happened:**
- [Stage-by-stage description of the extraction]
- [Notable events: pressure spikes, flow restrictions, early/late stage exits]
- [Final weight accuracy relative to target]

**Assessment:** [Choose exactly one: Good / Acceptable / Needs Improvement / Problematic]

## 2. Root Cause Analysis

**Primary Factors:**
- [Most likely cause with brief explanation]
- [Second most likely cause if applicable]

**Secondary Considerations:**
- [Other contributing factors]
- [Environmental or equipment factors if relevant]

## 3. Setup Recommendations

**Priority Changes:**
- [Most important change - be specific with numbers when possible]
- [Second priority change]

**Additional Suggestions:**
- [Other tweaks to consider]

## 4. Profile Recommendations

**Recommended Adjustments:**
- [Specific profile changes: timing, triggers, targets]
- [Variable value changes if applicable]

**Reasoning:**
- [Why these changes would improve the shot]

## 5. Profile Design Observations

**Strengths:**
- [Well-designed aspects of this profile]

**Potential Improvements:**
- [Exit trigger or safety limit suggestions]
- [Robustness improvements]

Focus on actionable insights. Be specific with numbers where possible (e.g., "grind 1-2 steps finer" not just "grind finer").
{taste_section_template}
## Structured Recommendations (MANDATORY)

After your analysis sections, you MUST output a structured JSON block with specific, actionable profile variable recommendations.
Use EXACTLY this format — the markers are parsed programmatically:

RECOMMENDATIONS_JSON:
[
  {{
    "variable": "<variable key from the profile, e.g. 'pressure', 'temperature'>",
    "current_value": <current numeric value>,
    "recommended_value": <suggested numeric value>,
    "stage": "<stage name this applies to, or 'global' for top-level settings>",
    "confidence": "<high|medium|low>",
    "reason": "<one-sentence explanation>"
  }}
]
END_RECOMMENDATIONS_JSON

Rules for recommendations:
- Only include recommendations where you have a SPECIFIC numeric change to suggest
- Use actual variable keys from the Profile Variables section above
- For top-level settings (temperature, final_weight), use stage="global"
- For stage-specific changes, use the stage name from Profile Stages
- confidence: "high" = strong evidence from data, "medium" = likely beneficial, "low" = worth trying
- If no recommendations apply, output an empty array: RECOMMENDATIONS_JSON:\n[]\nEND_RECOMMENDATIONS_JSON
"""
        
        # Call LLM
        try:
            model = get_vision_model()
        except ValueError as e:
            raise HTTPException(
                status_code=503,
                detail={
                    "status": "error",
                    "message": str(e),
                    "error": "AI features are unavailable until GEMINI_API_KEY is configured"
                }
            ) from e
        response = await model.async_generate_content(prompt)
        
        llm_analysis = response.text if response else "Analysis generation failed"
        
        # Save to cache
        save_llm_analysis_to_cache(profile_name, shot_date, cache_filename, llm_analysis)
        
        logger.info(
            "LLM shot analysis completed and cached",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "response_length": len(llm_analysis)
            }
        )
        
        return {
            "status": "success",
            "profile_name": profile_name,
            "shot_date": shot_date,
            "shot_filename": shot_filename,
            "llm_analysis": llm_analysis,
            "cached": False
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"LLM shot analysis failed: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "profile_name": profile_name
            }
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "LLM shot analysis failed"}
        )


# ============================================================================
# Recent Shots (cross-profile)
# ============================================================================

# In-memory cache for recent shots
_recent_shots_cache: dict = {}
_RECENT_SHOTS_TTL = 30  # seconds
_RECENT_SHOTS_MAX_ENTRIES = 50


def _cache_recent_shots(key: str, data: dict) -> None:
    """Insert into the recent-shots cache with bounded size."""
    if len(_recent_shots_cache) > _RECENT_SHOTS_MAX_ENTRIES:
        now = time.time()
        expired = [k for k, v in _recent_shots_cache.items() if now - v["ts"] >= _RECENT_SHOTS_TTL]
        for k in expired:
            del _recent_shots_cache[k]
        if len(_recent_shots_cache) > _RECENT_SHOTS_MAX_ENTRIES:
            _recent_shots_cache.clear()
    _recent_shots_cache[key] = {"data": data, "ts": time.time()}


@router.get("/shots/recent")
@router.get("/api/shots/recent")
async def get_recent_shots(request: Request, limit: int = 50, offset: int = 0):
    """Return recent shots across ALL profiles, sorted chronologically (latest first).

    Query params:
        limit:  max items to return (default 50)
        offset: pagination offset (default 0)
    """
    request_id = request.state.request_id
    cache_key = f"recent:{min(limit, 100)}:{min(offset, 10000)}"
    now = time.time()

    # Check cache
    cached = _recent_shots_cache.get(cache_key)
    if cached and (now - cached["ts"]) < _RECENT_SHOTS_TTL:
        return cached["data"]

    try:
        from services.shot_annotations_service import get_annotation

        dates_result = await async_get_history_dates()
        if hasattr(dates_result, "error") and dates_result.error:
            raise HTTPException(status_code=502, detail=f"Machine API error: {dates_result.error}")

        dates = sorted([d.name for d in dates_result], reverse=True) if dates_result else []

        all_shots: list[dict] = []
        sem = asyncio.Semaphore(6)

        async def _fetch_shot_info(date: str, filename: str):
            async with sem:
                try:
                    shot_data = await fetch_shot_data(date, filename)
                except Exception:
                    return None

                profile_name = shot_data.get("profile_name", "")
                if not profile_name and isinstance(shot_data.get("profile"), dict):
                    profile_name = shot_data["profile"].get("name", "")

                profile_id = ""
                if isinstance(shot_data.get("profile"), dict):
                    profile_id = shot_data["profile"].get("id", "")

                data_entries = shot_data.get("data", [])
                final_weight = None
                total_time_ms = None
                if data_entries:
                    last_entry = data_entries[-1]
                    if isinstance(last_entry.get("shot"), dict):
                        final_weight = last_entry["shot"].get("weight")
                    total_time_ms = last_entry.get("time")

                timestamp = shot_data.get("time")
                annotation = get_annotation(date, filename)

                return {
                    "profile_name": profile_name,
                    "profile_id": profile_id,
                    "date": date,
                    "filename": filename,
                    "timestamp": timestamp,
                    "final_weight": final_weight,
                    "total_time": total_time_ms / 1000 if total_time_ms else None,
                    "has_annotation": annotation is not None,
                }

        # We need enough shots for offset + limit; collect greedily
        needed = offset + limit
        for date in dates:
            if len(all_shots) >= needed:
                break

            files_result = await async_get_shot_files(date)
            if hasattr(files_result, "error") and files_result.error:
                continue
            files = sorted([f.name for f in files_result], reverse=True) if files_result else []
            if not files:
                continue

            remaining = needed - len(all_shots)
            tasks = [_fetch_shot_info(date, fn) for fn in files[:remaining]]
            results = await asyncio.gather(*tasks)
            for r in results:
                if r is not None:
                    all_shots.append(r)

        # Sort by timestamp descending (handle None timestamps)
        all_shots.sort(
            key=lambda s: _safe_float(s["timestamp"]),
            reverse=True,
        )

        page = all_shots[offset : offset + limit]

        response_data = {"shots": page}
        _cache_recent_shots(cache_key, response_data)
        return response_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to fetch recent shots: {e}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/shots/recent/by-profile")
@router.get("/api/shots/recent/by-profile")
async def get_recent_shots_by_profile(request: Request, limit: int = 50, offset: int = 0):
    """Same data as /shots/recent but grouped by profile.

    Response: { profiles: [{ profile_name, profile_id, shots: [...], shot_count }] }
    """
    request_id = request.state.request_id
    cache_key = f"recent_by_profile:{min(limit, 100)}:{min(offset, 10000)}"
    now = time.time()

    cached = _recent_shots_cache.get(cache_key)
    if cached and (now - cached["ts"]) < _RECENT_SHOTS_TTL:
        return cached["data"]

    try:
        # Reuse the flat recent-shots logic
        flat_response = await get_recent_shots(request, limit=limit + offset, offset=0)
        flat_shots = flat_response["shots"][offset:offset + limit]

        # Group by profile_name
        grouped: dict[str, dict] = {}
        for shot in flat_shots:
            pname = shot.get("profile_name") or "Unknown"
            if pname not in grouped:
                grouped[pname] = {
                    "profile_name": pname,
                    "profile_id": shot.get("profile_id", ""),
                    "shots": [],
                    "shot_count": 0,
                }
            grouped[pname]["shots"].append(shot)
            grouped[pname]["shot_count"] += 1

        profiles = sorted(grouped.values(), key=lambda g: g["shot_count"], reverse=True)

        response_data = {"profiles": profiles}
        _cache_recent_shots(cache_key, response_data)
        return response_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to fetch recent shots by profile: {e}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Shot Annotations
# ============================================================================


@router.get("/api/shots/{date}/{filename}/annotation")
async def get_shot_annotation(date: str, filename: str, request: Request):
    """Get the user annotation for a specific shot.
    
    Args:
        date: Shot date (e.g., "2024-01-15")
        filename: Shot filename (e.g., "shot_001.json")
    
    Returns:
        Annotation text, rating, and updated_at if exists, null otherwise.
    """
    from services.shot_annotations_service import get_annotation
    
    entry = get_annotation(date, filename)
    return {
        "status": "success",
        "annotation": entry.get("annotation") if entry else None,
        "rating": entry.get("rating") if entry else None,
        "updated_at": entry.get("updated_at") if entry else None,
    }


@router.patch("/api/shots/{date}/{filename}/annotation")
async def update_shot_annotation(date: str, filename: str, request: Request):
    """Update the user annotation for a specific shot.
    
    Args:
        date: Shot date (e.g., "2024-01-15")
        filename: Shot filename (e.g., "shot_001.json")
        
    Body:
        annotation: Markdown text for the annotation (empty to clear)
        rating: Star rating 1-5 (null to leave unchanged, explicit null/0 to clear)
    
    Returns:
        Updated annotation entry.
    """
    from services.shot_annotations_service import set_annotation, set_rating
    
    request_id = request.state.request_id
    
    try:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(status_code=400, detail={"status": "error", "error": "Invalid JSON body"})

        # If only rating is provided (no annotation key), update just the rating
        if "rating" in body and "annotation" not in body:
            result = set_rating(date, filename, body.get("rating"))
        else:
            annotation_text = body.get("annotation", "")
            rating = body.get("rating")
            result = set_annotation(date, filename, annotation_text, rating)
        
        return {
            "status": "success",
            "annotation": result.get("annotation"),
            "rating": result.get("rating"),
            "updated_at": result.get("updated_at"),
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"status": "error", "error": str(e)})
    except Exception as e:
        logger.error(
            f"Failed to update shot annotation: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.delete("/api/shots/{date}/{filename}/annotation")
async def delete_shot_annotation(date: str, filename: str, request: Request):
    """Delete the annotation for a specific shot.
    
    Args:
        date: Shot date (e.g., "2024-01-15")
        filename: Shot filename (e.g., "shot_001.json")
    
    Returns:
        Success status.
    """
    from services.shot_annotations_service import delete_annotation
    
    request_id = request.state.request_id
    
    try:
        deleted = delete_annotation(date, filename)
        return {
            "status": "success",
            "deleted": deleted,
        }
    except Exception as e:
        logger.error(
            f"Failed to delete shot annotation: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.get("/api/shots/annotations")
async def get_all_shot_annotations(request: Request):
    """Get all shot annotations (for shot list indicators).
    
    Returns:
        Dict mapping shot keys to annotation summaries.
    """
    from services.shot_annotations_service import get_all_annotations
    
    annotations = get_all_annotations()
    # Return lightweight summaries for the shot list
    summaries = {}
    for key, entry in annotations.items():
        if isinstance(entry, dict):
            summaries[key] = {
                "has_annotation": bool(entry.get("annotation")),
                "rating": entry.get("rating"),
            }
    return {
        "status": "success",
        "annotations": summaries,
    }


# ============================================================================
# Recommendation Extraction
# ============================================================================

def _parse_recommendations_json(analysis_text: str) -> list[dict]:
    """Extract and parse the RECOMMENDATIONS_JSON block from analysis text."""
    match = re.search(
        r"RECOMMENDATIONS_JSON:\s*\n\s*(\[.*?\])\s*\n\s*END_RECOMMENDATIONS_JSON",
        analysis_text,
        re.DOTALL,
    )
    if not match:
        return []
    try:
        recs = json.loads(match.group(1))
        if not isinstance(recs, list):
            return []
        return recs
    except (json.JSONDecodeError, TypeError):
        return []


def _classify_recommendation_patchable(rec: dict, profile_variables: list[dict]) -> bool:
    """Determine if a recommendation targets a patchable (adjustable) variable.

    A variable is patchable when:
    - Its key does NOT start with 'info_'
    - It is not marked adjustable=false
    - OR the recommendation targets a global setting (temperature, final_weight)
    """
    variable = rec.get("variable", "")
    stage = rec.get("stage", "")

    # Global top-level settings are always patchable
    if stage == "global" and variable in ("temperature", "final_weight"):
        return True

    # Check against profile variables
    for var in profile_variables:
        var_key = var.get("key", "")
        if var_key == variable:
            if var_key.startswith("info_"):
                return False
            if var.get("adjustable") is False:
                return False
            return True

    # Variable not found in profile — not patchable
    return False


@router.post("/shots/analyze-recommendations")
@router.post("/api/shots/analyze-recommendations")
async def analyze_recommendations(
    request: Request,
    profile_name: str = Form(...),
    shot_filename: str = Form(...),
    force_refresh: bool = Form(default=False),
):
    """Extract structured recommendations from an existing analysis.

    Returns the RECOMMENDATIONS_JSON block parsed as a list of dicts,
    each annotated with ``is_patchable``.
    """
    request_id = request.state.request_id

    try:
        logger.info(
            "Extracting recommendations from analysis",
            extra={"request_id": request_id, "profile_name": profile_name},
        )

        # Try to find existing cached analysis for any date
        # We search the cache by profile + filename
        from services.cache_service import get_cached_llm_analysis

        # Derive shot_date from filename (format: YYYY-MM-DDTHH:MM:SS.json typically)
        shot_date_match = re.match(r"(\d{4}-\d{2}-\d{2})", shot_filename)
        shot_date = shot_date_match.group(1) if shot_date_match else ""

        cached_analysis = get_cached_llm_analysis(profile_name, shot_date, shot_filename)

        if not cached_analysis:
            raise HTTPException(
                status_code=404,
                detail={
                    "status": "no_analysis",
                    "message": "No cached analysis found. Run a full analysis first.",
                },
            )

        if force_refresh:
            # Re-parse the cached text to get fresh structured data
            logger.info(
                "Force refresh requested, re-parsing cached analysis",
                extra={"request_id": request_id},
            )

        # Parse recommendations from analysis text
        recs = _parse_recommendations_json(cached_analysis)

        # Fetch profile to classify patchability
        profile_variables: list[dict] = []
        try:
            profiles_result = await async_list_profiles()
            for p in profiles_result:
                if p.name.lower() == profile_name.lower():
                    full_profile = await async_get_profile(p.id)
                    if hasattr(full_profile, "variables") and full_profile.variables:
                        for var in full_profile.variables:
                            profile_variables.append({
                                "key": getattr(var, "key", ""),
                                "name": getattr(var, "name", ""),
                                "type": getattr(var, "type", ""),
                                "value": getattr(var, "value", 0),
                                "adjustable": getattr(var, "adjustable", None),
                            })
                    break
        except Exception:
            logger.warning("Could not fetch profile for patchability check", exc_info=True)

        # Annotate each recommendation
        for rec in recs:
            rec["is_patchable"] = _classify_recommendation_patchable(rec, profile_variables)

        return {
            "status": "success",
            "profile_name": profile_name,
            "recommendations": recs,
            "total": len(recs),
            "patchable_count": sum(1 for r in recs if r.get("is_patchable")),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to extract recommendations: {e}",
            exc_info=True,
            extra={"request_id": request_id},
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)},
        )
