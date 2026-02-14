"""Bridge and MQTT status endpoints for the Control Center."""
from fastapi import APIRouter, HTTPException
import logging

from services.bridge_service import get_bridge_status, restart_bridge_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/bridge/status")
async def bridge_status():
    """Get MQTT broker and bridge service status.

    Returns the health of the mosquitto MQTT broker and the
    meticulous-bridge service that relays real-time machine
    telemetry via Socket.IO → MQTT.
    """
    status = get_bridge_status()
    return status


@router.post("/api/bridge/restart")
async def bridge_restart():
    """Restart the meticulous-bridge s6 service.

    Useful when the machine IP changes or the bridge needs
    to reconnect after a configuration change.
    """
    success = restart_bridge_service()
    if not success:
        raise HTTPException(
            status_code=500,
            detail="Failed to restart bridge service",
        )
    return {"status": "restarting", "message": "Bridge service restart initiated"}
