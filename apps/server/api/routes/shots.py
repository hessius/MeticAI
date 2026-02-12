"""Shot history and analysis endpoints."""
from fastapi import APIRouter, Request, Form, HTTPException
from typing import Optional
import asyncio
import json
import re
import time
import logging

from services.meticulous_service import (
    fetch_shot_data,
    async_list_profiles, async_get_history_dates,
    async_get_shot_files, async_get_profile
)
from services.cache_service import (
    get_cached_llm_analysis, save_llm_analysis_to_cache,
    _get_cached_shots, _set_cached_shots
)
from services.analysis_service import _perform_local_shot_analysis
from services.gemini_service import get_vision_model, PROFILING_KNOWLEDGE

router = APIRouter()
logger = logging.getLogger(__name__)


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
    force_refresh: bool = Form(False)
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
    
    try:
        logger.info(
            "Starting LLM shot analysis",
            extra={
                "request_id": request_id,
                "profile_name": profile_name,
                "shot_date": shot_date,
                "shot_filename": shot_filename,
                "force_refresh": force_refresh
            }
        )
        
        # Check cache first (unless force refresh)
        if not force_refresh:
            cached_analysis = get_cached_llm_analysis(profile_name, shot_date, shot_filename)
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

---

Based on this data, provide a detailed expert analysis.

CRITICAL FORMATTING RULES:
1. You MUST use EXACTLY these 5 section headers with the exact format shown (## followed by number, period, space, then title)
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
"""
        
        # Call LLM
        model = get_vision_model()
        response = await model.async_generate_content(prompt)
        
        llm_analysis = response.text if response else "Analysis generation failed"
        
        # Save to cache
        save_llm_analysis_to_cache(profile_name, shot_date, shot_filename, llm_analysis)
        
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
