"""Machine command endpoints — publish MQTT commands to the Meticulous machine.

Each endpoint publishes a message to the appropriate MQTT topic via the local
Mosquitto broker.  The frontend never connects to MQTT directly; the FastAPI
server is the single gateway.
"""

import logging
import os
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.mqtt_service import get_mqtt_subscriber

router = APIRouter()
logger = logging.getLogger(__name__)

TEST_MODE = os.environ.get("TEST_MODE") == "true"

# ---------------------------------------------------------------------------
# MQTT publishing helper
# ---------------------------------------------------------------------------

MQTT_TOPIC_PREFIX = "meticulous_espresso/command/"


def _publish_command(topic: str, payload: str = "") -> bool:
    """Publish a single message to the local MQTT broker.

    Uses paho-mqtt's ``publish.single()`` (fire-and-forget).
    Returns True on success, False on failure.
    """
    if TEST_MODE:
        logger.info("TEST_MODE: would publish %s → %r", topic, payload)
        return True

    mqtt_host = os.environ.get("MQTT_HOST", "127.0.0.1")
    mqtt_port = int(os.environ.get("MQTT_PORT", "1883"))

    try:
        import paho.mqtt.publish as publish

        publish.single(
            topic,
            payload=payload or None,
            hostname=mqtt_host,
            port=mqtt_port,
            client_id=f"meticai-cmd-{uuid.uuid4().hex[:8]}",
            qos=1,
        )
        return True
    except Exception as exc:
        logger.error("MQTT publish failed for %s: %s", topic, exc)
        return False


# ---------------------------------------------------------------------------
# Precondition helpers
# ---------------------------------------------------------------------------


def _get_snapshot() -> dict:
    """Return the current MQTT sensor snapshot (may be empty)."""
    sub = get_mqtt_subscriber()
    return sub.get_snapshot()


def _require_connected(snapshot: dict) -> None:
    availability = snapshot.get("availability")
    connected = snapshot.get("connected")
    if availability == "offline" or connected is False:
        raise HTTPException(status_code=409, detail="Machine is offline")


def _require_idle(snapshot: dict) -> None:
    _require_connected(snapshot)
    if snapshot.get("brewing"):
        raise HTTPException(
            status_code=409, detail="Cannot perform action: a shot is running"
        )


def _require_brewing(snapshot: dict) -> None:
    _require_connected(snapshot)
    if not snapshot.get("brewing"):
        raise HTTPException(
            status_code=409, detail="No shot is currently running"
        )


def _do_publish(action: str, payload: str = "") -> dict:
    """Publish and return a standard response."""
    topic = f"{MQTT_TOPIC_PREFIX}{action}"
    ok = _publish_command(topic, payload)
    if not ok:
        raise HTTPException(
            status_code=503, detail="Failed to publish MQTT command"
        )
    return {"success": True, "status": "ok", "command": action}


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class LoadProfileRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Profile name to load on the machine")


class BrightnessRequest(BaseModel):
    value: int = Field(..., ge=0, le=100, description="Brightness 0–100")


class SoundsRequest(BaseModel):
    enabled: bool = Field(..., description="Enable or disable sounds")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/api/machine/command/start")
async def command_start():
    """Start a shot (load & execute the active profile)."""
    snapshot = _get_snapshot()
    _require_idle(snapshot)
    return _do_publish("start_shot")


@router.post("/api/machine/command/stop")
async def command_stop():
    """Stop the plunger immediately mid-shot."""
    snapshot = _get_snapshot()
    _require_brewing(snapshot)
    return _do_publish("stop_shot")


@router.post("/api/machine/command/abort")
async def command_abort():
    """Abort the current shot or preheat and retract the plunger."""
    snapshot = _get_snapshot()
    _require_connected(snapshot)
    # Abort is allowed during brewing OR preheating
    return _do_publish("abort_shot")


@router.post("/api/machine/command/continue")
async def command_continue():
    """Resume a paused shot."""
    return _do_publish("continue_shot")


@router.post("/api/machine/command/preheat")
async def command_preheat():
    """Preheat the water in the chamber.

    Also acts as a toggle: sending preheat while already preheating
    will cancel the preheat cycle.
    """
    snapshot = _get_snapshot()
    _require_connected(snapshot)
    # Allow during idle (start preheat) AND preheating (cancel preheat)
    state = (snapshot.get("state") or "").lower()
    if snapshot.get("brewing"):
        raise HTTPException(
            status_code=409, detail="Cannot preheat while brewing"
        )
    if state not in ("idle", "preheating", "click to start"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot preheat in current state: {snapshot.get('state')}",
        )
    return _do_publish("preheat")


@router.post("/api/machine/command/tare")
async def command_tare():
    """Zero the scale."""
    snapshot = _get_snapshot()
    _require_connected(snapshot)
    return _do_publish("tare_scale")


@router.post("/api/machine/command/home-plunger")
async def command_home_plunger():
    """Reset plunger to home position."""
    snapshot = _get_snapshot()
    _require_idle(snapshot)
    return _do_publish("home_plunger")


@router.post("/api/machine/command/purge")
async def command_purge():
    """Flush water through the group head."""
    snapshot = _get_snapshot()
    _require_idle(snapshot)
    return _do_publish("purge")


@router.post("/api/machine/command/load-profile")
async def command_load_profile(body: LoadProfileRequest):
    """Switch the machine to a different profile.

    Sends select_profile (to set the active profile on the bridge)
    followed by run_profile (to actually load it on the machine).
    """
    snapshot = _get_snapshot()
    _require_connected(snapshot)
    # Step 1: select the profile by name (sets bridge state + hovers on machine)
    result = _do_publish("select_profile", body.name)
    # Step 2: load/run the selected profile on the machine
    _do_publish("run_profile")
    return result


@router.post("/api/machine/command/brightness")
async def command_brightness(body: BrightnessRequest):
    """Adjust the display brightness (0–100)."""
    snapshot = _get_snapshot()
    _require_connected(snapshot)
    return _do_publish("set_brightness", str(body.value))


@router.post("/api/machine/command/sounds")
async def command_sounds(body: SoundsRequest):
    """Toggle machine sound effects."""
    snapshot = _get_snapshot()
    _require_connected(snapshot)
    return _do_publish("enable_sounds", str(body.enabled).lower())
