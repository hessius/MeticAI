"""Meticulous service for espresso machine API and shot data management."""

import json
import time
import zstandard
import httpx
import asyncio
import os
from typing import Optional
from logging_config import get_logger

logger = get_logger()

# Lazy-loaded Meticulous API client
_meticulous_api = None

# Singleton httpx.AsyncClient — reused across all shot data fetches
_http_client: Optional[httpx.AsyncClient] = None

# Short-lived profile list cache (avoids repeated blocking calls to the machine)
_PROFILE_CACHE_TTL = 10  # seconds
_profile_list_cache: Optional[list] = None
_profile_list_cache_time: float = 0.0


def _get_http_client() -> httpx.AsyncClient:
    """Return the singleton httpx.AsyncClient, creating it if needed."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


async def close_http_client():
    """Close the singleton httpx.AsyncClient (call during app shutdown)."""
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


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


def reset_meticulous_api():
    """Reset the cached API client so the next call picks up new settings.
    
    Called when METICULOUS_IP is changed via the settings UI.
    """
    global _meticulous_api
    _meticulous_api = None
    invalidate_profile_list_cache()
    logger.info("Meticulous API client reset — will reinitialize on next request")


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
    
    loop = asyncio.get_event_loop()
    
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
                    await loop.run_in_executor(None, api.execute_action, ActionType.PREHEAT)
                except Exception as e:
                    logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                
                # Wait for remaining time until shot
                await asyncio.sleep(preheat_duration_minutes * 60)
            else:
                # Not enough time for full preheat, start immediately
                scheduled_shots_dict[schedule_id]["status"] = "preheating"
                try:
                    await loop.run_in_executor(None, api.execute_action, ActionType.PREHEAT)
                except Exception as e:
                    logger.warning(f"Preheat failed for scheduled shot {schedule_id}: {e}")
                await asyncio.sleep(shot_delay)
        else:
            await asyncio.sleep(shot_delay)
        
        scheduled_shots_dict[schedule_id]["status"] = "running"
        
        # Load and run the profile (if profile_id was provided)
        if profile_id:
            load_result = await loop.run_in_executor(None, api.load_profile_by_id, profile_id)
            if not (hasattr(load_result, 'error') and load_result.error):
                await loop.run_in_executor(None, api.execute_action, ActionType.START)
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
    
    client = _get_http_client()
    response = await client.get(url)
    response.raise_for_status()
    
    # Check if it's compressed (zstd)
    if filename.endswith('.zst'):
        return decompress_shot_data(response.content)
    else:
        return response.json()


# ============================================
# Async wrappers for synchronous pyMeticulous API calls
# ============================================
# The pyMeticulous library is fully synchronous. These helpers offload each
# blocking call to a thread-pool executor so the FastAPI event loop stays free.

async def async_list_profiles():
    """list_profiles() offloaded to a thread, with short-lived TTL cache."""
    global _profile_list_cache, _profile_list_cache_time
    now = time.monotonic()
    if _profile_list_cache is not None and (now - _profile_list_cache_time) < _PROFILE_CACHE_TTL:
        return _profile_list_cache
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, api.list_profiles)
    _profile_list_cache = result
    _profile_list_cache_time = now
    return result


def invalidate_profile_list_cache():
    """Clear the profile list cache (call after create / update / delete)."""
    global _profile_list_cache, _profile_list_cache_time
    _profile_list_cache = None
    _profile_list_cache_time = 0.0


async def async_load_profile_by_id(profile_id: str):
    """load_profile_by_id() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, api.load_profile_by_id, profile_id)


async def async_create_profile(profile_json):
    """create_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, api.create_profile, profile_json)
    invalidate_profile_list_cache()
    return result


async def async_delete_profile(profile_id: str):
    """delete_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, api.delete_profile, profile_id)
    invalidate_profile_list_cache()
    return result


async def async_get_last_profile():
    """get_last_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, api.get_last_profile)


async def async_get_settings():
    """get_settings() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, api.get_settings)


async def async_execute_action(action_type):
    """execute_action() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, api.execute_action, action_type)


async def async_session_get(path: str):
    """api.session.get() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    url = f"{api.base_url}{path}"
    return await loop.run_in_executor(None, api.session.get, url)


async def async_session_post(path: str, json_body: dict = None):
    """api.session.post() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    url = f"{api.base_url}{path}"
    import functools
    fn = functools.partial(api.session.post, url, json=json_body)
    return await loop.run_in_executor(None, fn)


async def async_get_history_dates():
    """get_history_dates() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, api.get_history_dates)


async def async_get_shot_files(date: str):
    """get_shot_files() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, api.get_shot_files, date)


async def async_get_profile(profile_id: str):
    """get_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, api.get_profile, profile_id)


async def async_save_profile(profile):
    """save_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, api.save_profile, profile)
    invalidate_profile_list_cache()
    return result
