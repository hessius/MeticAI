"""Machine status endpoints — proxy to meticulous-watcher and machine API."""

from fastapi import APIRouter
from services.meticulous_service import _resolve_meticulous_base_url
import httpx
from logging_config import get_logger

logger = get_logger()
router = APIRouter()


@router.get("/api/machine/status/health")
async def get_machine_status():
    """Proxy to meticulous-watcher service for health status."""
    machine_url = _resolve_meticulous_base_url()
    # Watcher runs on port 3000
    watcher_url = machine_url.replace(":8080", ":3000").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{watcher_url}/status")
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.warning(f"Watcher service unreachable: {e}")
        return {"error": "Watcher service unavailable", "services": [], "system": None}


@router.get("/api/machine/system-info")
async def get_machine_system_info():
    """Aggregate system info from machine API."""
    machine_url = _resolve_meticulous_base_url()
    base = machine_url.rstrip("/")
    info: dict = {"firmware": None, "network": None, "hostname": None}
    async with httpx.AsyncClient(timeout=5.0) as client:
        for key, path in [
            ("firmware", "/api/v1/system/firmware"),
            ("network", "/api/v1/wifi/status"),
            ("hostname", "/api/v1/wifi/hostname"),
        ]:
            try:
                resp = await client.get(f"{base}{path}")
                if resp.status_code == 200:
                    info[key] = resp.json()
            except Exception:
                pass  # key already initialized to None
    return info
