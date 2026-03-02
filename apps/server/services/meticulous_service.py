"""Meticulous service for espresso machine API and shot data management."""

import json
import re
import time
import uuid
import zstandard
import httpx
import asyncio
import os
import functools
import requests.exceptions
from typing import Any, Dict, Optional
from fastapi import HTTPException
from logging_config import get_logger
from services.settings_service import load_settings

logger = get_logger()


class MachineUnreachableError(HTTPException):
    """Raised when the Meticulous espresso machine cannot be reached.

    Extends HTTPException so that routes with ``except HTTPException: raise``
    guards automatically propagate it as a 503 instead of wrapping it in a
    generic 500.
    """

    def __init__(self, original: Exception | None = None):
        detail = (
            "Espresso machine is unreachable. "
            "Check that the machine is powered on and METICULOUS_IP is correct in Settings."
        )
        super().__init__(status_code=503, detail=detail)
        self.__cause__ = original


# Connection-error types that indicate the machine is down
_MACHINE_CONNECTION_ERRORS = (
    requests.exceptions.ConnectionError,
    httpx.ConnectError,
    httpx.ConnectTimeout,
)


def _wrap_machine_call(fn):
    """Decorator that converts connection errors into MachineUnreachableError."""

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except _MACHINE_CONNECTION_ERRORS as exc:
            logger.warning("Machine unreachable in %s: %s", fn.__name__, exc)
            raise MachineUnreachableError(exc) from exc

    return wrapper

# Lazy-loaded Meticulous API client
_meticulous_api = None

# Singleton httpx.AsyncClient — reused across all shot data fetches
_http_client: Optional[httpx.AsyncClient] = None

# Short-lived profile list cache (avoids repeated blocking calls to the machine)
_PROFILE_CACHE_TTL = 10  # seconds
_profile_list_cache: Optional[list] = None
_profile_list_cache_time: float = 0.0


def _resolve_meticulous_base_url() -> str:
    """Resolve the machine base URL from environment/settings with safe defaults."""
    meticulous_ip = os.environ.get("METICULOUS_IP", "").strip()

    if not meticulous_ip:
        try:
            settings = load_settings()
            meticulous_ip = (settings.get("meticulousIp") or "").strip()
        except Exception:
            meticulous_ip = ""

    if not meticulous_ip:
        meticulous_ip = "meticulous.local"

    if not meticulous_ip.startswith("http"):
        meticulous_ip = f"http://{meticulous_ip}"

    return meticulous_ip.rstrip("/")


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
    desired_base_url = _resolve_meticulous_base_url()

    if _meticulous_api is None:
        from meticulous.api import Api
        _meticulous_api = Api(base_url=desired_base_url)
        return _meticulous_api

    current_base_url = str(getattr(_meticulous_api, "base_url", "")).rstrip("/")
    if current_base_url != desired_base_url:
        from meticulous.api import Api
        logger.info(
            "Meticulous API target changed, reinitializing client",
            extra={
                "from_base_url": current_base_url,
                "to_base_url": desired_base_url,
            },
        )
        _meticulous_api = Api(base_url=desired_base_url)

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
    
    loop = asyncio.get_running_loop()
    
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


@_wrap_machine_call
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

@_wrap_machine_call
async def async_list_profiles():
    """list_profiles() offloaded to a thread, with short-lived TTL cache."""
    global _profile_list_cache, _profile_list_cache_time
    now = time.monotonic()
    if _profile_list_cache is not None and (now - _profile_list_cache_time) < _PROFILE_CACHE_TTL:
        return _profile_list_cache
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, api.list_profiles)
    _profile_list_cache = result
    _profile_list_cache_time = now
    return result


def invalidate_profile_list_cache():
    """Clear the profile list cache (call after create / update / delete)."""
    global _profile_list_cache, _profile_list_cache_time
    _profile_list_cache = None
    _profile_list_cache_time = 0.0


@_wrap_machine_call
async def async_load_profile_by_id(profile_id: str):
    """load_profile_by_id() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, api.load_profile_by_id, profile_id)


def _normalize_profile_for_machine(profile_json: Dict[str, Any]) -> Dict[str, Any]:
    """Enrich and normalize espresso-profile-schema JSON for the machine REST API.

    The AI model produces JSON conforming to the OEPF espresso-profile-schema,
    but the Meticulous machine's ``/api/v1/profile/save`` endpoint requires
    several additional fields.  This function — borrowing the same conventions
    used by the MCP server's ``create_profile`` tool — fills in the gaps so the
    profile can be saved directly.

    Added / defaulted fields:
        - ``id`` — random UUID if missing
        - ``author`` / ``author_id`` — ``"MeticAI"`` + random UUID
        - ``temperature`` — defaults to 90.0 °C
        - ``final_weight`` — defaults to 40.0 g
        - ``variables`` — always present (empty list if missing)
        - ``previous_authors`` — always present (empty list if missing)
        - Per-stage ``key`` — auto-generated from type + index if missing
        - Per-stage ``limits`` — always an array (never None / absent)
        - ``dynamics.interpolation`` — defaults to ``"linear"``
        - ``dynamics.points`` — each point coerced to ``[x, y]`` list form
        - Exit-trigger ``relative`` — defaults to ``True`` for time, ``False``
          otherwise (matches MCP profile_builder behaviour)
        - Exit-trigger ``comparison`` — defaults to ``">="``
    """
    data = dict(profile_json)  # shallow copy

    # ── Top-level identity & metadata ────────────────────────────────────
    if "id" not in data or not data["id"]:
        data["id"] = str(uuid.uuid4())
    data.setdefault("author", "MeticAI")
    if "author_id" not in data or not data["author_id"]:
        data["author_id"] = str(uuid.uuid4())
    data.setdefault("temperature", 90.0)
    data.setdefault("final_weight", 40.0)
    # The Meticulous app crashes if variables array is absent
    if "variables" not in data or data.get("variables") is None:
        data["variables"] = []
    data.setdefault("previous_authors", [])

    # ── Info variable emoji normalization ────────────────────────────────
    # Info variables (key starts with "info_") MUST have an emoji prefix in name.
    # This distinguishes them from adjustable variables (no emoji, used in stages).
    emoji_pattern = re.compile(
        r'^[\U0001F300-\U0001F9FF'   # Supplemental Symbols and Pictographs
        r'\U0001F600-\U0001F64F'      # Emoticons
        r'\U0001F680-\U0001F6FF'      # Transport and Map Symbols  
        r'\U00002600-\U000026FF'      # Misc symbols
        r'\U00002700-\U000027BF]'     # Dingbats
    )
    for var in data.get("variables") or []:
        key = var.get("key", "")
        name = var.get("name", "")
        is_info = key.startswith("info_") or var.get("adjustable") is False
        # If it's an info variable and name doesn't start with emoji, add default ℹ️
        if is_info and not emoji_pattern.match(name):
            var["name"] = f"ℹ️ {name}" if name else "ℹ️ Info"

    # ── Display metadata ─────────────────────────────────────────────────
    # The OEPF schema supports display.description / display.shortDescription
    # which the Meticulous app stores alongside the profile.
    display = data.get("display") or {}
    if not isinstance(display, dict):
        display = {}
    # Preserve any existing description; normalise structure
    data["display"] = display

    # ── Per-stage normalisation ──────────────────────────────────────────
    for idx, stage in enumerate(data.get("stages") or []):
        # type — default to "flow" if missing
        stage.setdefault("type", "flow")
        stage_type = stage["type"]

        # name — required, default to "Stage N" if missing
        stage.setdefault("name", f"Stage {idx + 1}")

        # key — unique string identifier
        if "key" not in stage or not stage["key"]:
            stage["key"] = f"{stage_type}_{idx}"

        # exit_triggers — required, must be a list
        if "exit_triggers" not in stage or stage.get("exit_triggers") is None:
            stage["exit_triggers"] = []

        # limits — must always be a list
        if "limits" not in stage or stage.get("limits") is None:
            stage["limits"] = []

        # dynamics — required; ensure it exists with all required sub-fields
        dynamics = stage.get("dynamics") or {}
        dynamics.setdefault("interpolation", "linear")
        dynamics.setdefault("over", "time")
        dynamics.setdefault("points", [])

        # dynamics.points — coerce dicts like {"value": 2} to [0, 2]
        raw_points = dynamics.get("points") or []
        normalised_points = []
        for pt in raw_points:
            if isinstance(pt, dict):
                # Single-value shorthand {"value": v} → [0, v]
                normalised_points.append([0.0, pt.get("value", 0)])
            elif isinstance(pt, (list, tuple)):
                normalised_points.append(list(pt))
            else:
                normalised_points.append([0.0, float(pt)])
        dynamics["points"] = normalised_points
        stage["dynamics"] = dynamics

        # exit_triggers — ensure relative & comparison are present
        for trigger in stage.get("exit_triggers") or []:
            if "relative" not in trigger or trigger.get("relative") is None:
                trigger["relative"] = trigger.get("type") == "time"
            trigger.setdefault("comparison", ">=")

    return data


@_wrap_machine_call
async def async_create_profile(profile_json):
    """Upload a profile to the machine via its REST API.

    Normalises the espresso-profile-schema JSON (as produced by the AI model)
    into the machine-compatible format and POSTs it to ``/api/v1/profile/save``,
    following the same approach used by the MCP server's ``create_profile`` tool.
    """
    normalised = _normalize_profile_for_machine(profile_json)
    base_url = _resolve_meticulous_base_url()
    client = _get_http_client()
    response = await client.post(
        f"{base_url}/api/v1/profile/save",
        json=normalised,
        timeout=30.0,
    )
    if response.status_code != 200:
        body = response.text
        logger.error(
            "Machine rejected profile save: %s",
            body[:1000],
            extra={
                "status": response.status_code,
                "profile_name": normalised.get("name"),
                "profile_keys": list(normalised.keys()),
                "stage_count": len(normalised.get("stages", [])),
                "stage_keys": [s.get("key") for s in normalised.get("stages", [])],
            }
        )
    response.raise_for_status()
    invalidate_profile_list_cache()
    return response.json()


@_wrap_machine_call
async def async_delete_profile(profile_id: str):
    """delete_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, api.delete_profile, profile_id)
    invalidate_profile_list_cache()
    return result


@_wrap_machine_call
async def async_get_last_profile():
    """get_last_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, api.get_last_profile)


@_wrap_machine_call
async def async_get_settings():
    """get_settings() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, api.get_settings)


@_wrap_machine_call
async def async_execute_action(action_type):
    """execute_action() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, api.execute_action, action_type)


@_wrap_machine_call
async def async_session_get(path: str):
    """api.session.get() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    url = f"{api.base_url}{path}"
    return await loop.run_in_executor(None, api.session.get, url)


@_wrap_machine_call
async def async_session_post(path: str, json_body: dict = None):
    """api.session.post() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    url = f"{api.base_url}{path}"
    fn = functools.partial(api.session.post, url, json=json_body)
    return await loop.run_in_executor(None, fn)


@_wrap_machine_call
async def async_get_history_dates():
    """get_history_dates() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, api.get_history_dates)


@_wrap_machine_call
async def async_get_shot_files(date: str):
    """get_shot_files() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, api.get_shot_files, date)


@_wrap_machine_call
async def async_get_profile(profile_id: str):
    """get_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, api.get_profile, profile_id)


@_wrap_machine_call
async def async_save_profile(profile):
    """save_profile() offloaded to a thread."""
    api = get_meticulous_api()
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, api.save_profile, profile)
    invalidate_profile_list_cache()
    return result
