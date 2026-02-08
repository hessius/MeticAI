"""Meticulous service for espresso machine API and shot data management."""

import subprocess
import json
import zstandard
import httpx
import asyncio
import os
from pathlib import Path
from typing import Optional, Any
from datetime import datetime
from logging_config import get_logger

logger = get_logger()

# Lazy-loaded Meticulous API client
_meticulous_api = None


def get_meticulous_api():
    """Lazily initialize and return the Meticulous API client."""
    global _meticulous_api
    if _meticulous_api is None:
        from meticulous.api import Api
        meticulous_ip = os.environ.get("METICULOUS_IP", "meticulousmodelalmondmilklatte.local")
        # Ensure we use http:// prefix
        if not meticulous_ip.startswith("http"):
            meticulous_ip = f"http://{meticulous_ip}"
        _meticulous_api = Api(base_url=meticulous_ip)
    return _meticulous_api


async def execute_scheduled_shot(
    schedule_id: str,
    shot_delay: float,
    preheat: bool,
    profile_id: Optional[str],
    scheduled_shots_dict: dict,
    scheduled_tasks_dict: dict,
    preheat_duration_minutes: int = 10
):
    """Execute a scheduled shot with optional preheating.
    
    Args:
        schedule_id: Unique identifier for this scheduled shot
        shot_delay: Seconds to wait before executing the shot
        preheat: Whether to preheat before the shot
        profile_id: The profile ID to run (optional, can be None for preheat-only)
        scheduled_shots_dict: Reference to the global scheduled shots dictionary
        scheduled_tasks_dict: Reference to the global scheduled tasks dictionary
        preheat_duration_minutes: Minutes to preheat (default: 10)
    """
    from meticulous.api_types import ActionType
    
    try:
        api = get_meticulous_api()
        
        # If preheat is enabled, start it before the scheduled time
        if preheat:
            preheat_delay = shot_delay - (preheat_duration_minutes * 60)
            if preheat_delay > 0:
                await asyncio.sleep(preheat_delay)
                scheduled_shots_dict[schedule_id]["status"] = "preheating"
                
                # Start preheat using ActionType.PREHEAT
                try:
                    api.execute_action(ActionType.PREHEAT)
                except Exception as e:
                    logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                
                # Wait for remaining time until shot
                await asyncio.sleep(preheat_duration_minutes * 60)
            else:
                # Not enough time for full preheat, start immediately
                scheduled_shots_dict[schedule_id]["status"] = "preheating"
                try:
                    api.execute_action(ActionType.PREHEAT)
                except Exception as e:
                    logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                await asyncio.sleep(shot_delay)
        else:
            await asyncio.sleep(shot_delay)
        
        scheduled_shots_dict[schedule_id]["status"] = "running"
        
        # Load and run the profile (if profile_id was provided)
        if profile_id:
            load_result = api.load_profile_by_id(profile_id)
            if not (hasattr(load_result, 'error') and load_result.error):
                api.execute_action(ActionType.START)
                scheduled_shots_dict[schedule_id]["status"] = "completed"
            else:
                scheduled_shots_dict[schedule_id]["status"] = "failed"
                scheduled_shots_dict[schedule_id]["error"] = load_result.error
        else:
            # Preheat only mode - mark as completed
            scheduled_shots_dict[schedule_id]["status"] = "completed"
            
    except asyncio.CancelledError:
        scheduled_shots_dict[schedule_id]["status"] = "cancelled"
    except Exception as e:
        logger.error(f"Scheduled shot {schedule_id} failed: {e}")
        scheduled_shots_dict[schedule_id]["status"] = "failed"
        scheduled_shots_dict[schedule_id]["error"] = str(e)
    finally:
        # Clean up task reference
        if schedule_id in scheduled_tasks_dict:
            del scheduled_tasks_dict[schedule_id]


def decompress_shot_data(compressed_data: bytes) -> dict:
    """Decompress zstandard-compressed shot data."""
    dctx = zstandard.ZstdDecompressor()
    decompressed = dctx.decompress(compressed_data)
    return json.loads(decompressed.decode('utf-8'))


async def fetch_shot_data(date_str: str, filename: str) -> dict:
    """Fetch and decompress shot data from the Meticulous machine."""
    api = get_meticulous_api()
    url = f"{api.base_url}/api/v1/history/files/{date_str}/{filename}"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        
        # Check if it's compressed (zstd)
        if filename.endswith('.zst'):
            return decompress_shot_data(response.content)
        else:
            return response.json()
