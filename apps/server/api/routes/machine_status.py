"""Machine status endpoints — proxy to meticulous-watcher and machine API."""

import re
from fastapi import APIRouter
from services.meticulous_service import _resolve_meticulous_base_url
import httpx
from logging_config import get_logger

logger = get_logger()
router = APIRouter()


def _parse_size_to_mb(size_str: str) -> float:
    """Parse a human-readable size string (e.g. '1.93 GB', '700.91 MB') to MB."""
    match = re.match(r'([\d.]+)\s*(GB|MB|KB|TB)', size_str, re.IGNORECASE)
    if not match:
        return 0.0
    value = float(match.group(1))
    unit = match.group(2).upper()
    if unit == 'TB':
        return value * 1024 * 1024
    if unit == 'GB':
        return value * 1024
    if unit == 'KB':
        return value / 1024
    return value  # MB


def _parse_uptime_to_seconds(uptime_str: str) -> int:
    """Parse watcher uptime string like '0 days, 0 hours 41 minutes 35 seconds' to seconds."""
    total = 0
    for match in re.finditer(r'(\d+)\s*(days?|hours?|minutes?|seconds?)', uptime_str):
        val = int(match.group(1))
        unit = match.group(2).lower()
        if unit.startswith('day'):
            total += val * 86400
        elif unit.startswith('hour'):
            total += val * 3600
        elif unit.startswith('minute'):
            total += val * 60
        else:
            total += val
    return total


def _transform_watcher_response(raw: dict) -> dict:
    """Transform raw watcher /status response into the shape the frontend expects."""
    # Services: object → array
    raw_services = raw.get("services", {})
    services = []
    if isinstance(raw_services, dict):
        for name, info in raw_services.items():
            services.append({
                "name": name,
                "status": info.get("status", "unknown") if isinstance(info, dict) else "unknown",
                "uptime": None,
            })
    elif isinstance(raw_services, list):
        services = raw_services  # already in expected format

    # System metrics
    system = None
    mem = raw.get("memoryUsage", {})
    discs = raw.get("discs", [])
    uptime_str = raw.get("uptime", "")

    mem_total = _parse_size_to_mb(mem.get("total", "")) if isinstance(mem, dict) else 0
    mem_used = _parse_size_to_mb(mem.get("used", "")) if isinstance(mem, dict) else 0

    # Use the root filesystem disc for disk metrics
    disk_total = 0.0
    disk_used = 0.0
    if isinstance(discs, list):
        for disc in discs:
            mp = disc.get("mountpoint", "")
            if mp == "/":
                usage = disc.get("usage", {})
                disk_total = _parse_size_to_mb(usage.get("total", "")) / 1024  # GB
                disk_used = _parse_size_to_mb(usage.get("used", "")) / 1024  # GB
                break

    uptime_secs = _parse_uptime_to_seconds(uptime_str) if uptime_str else None

    if mem_total or disk_total or uptime_secs:
        system = {
            "memory_total": round(mem_total) if mem_total else None,
            "memory_used": round(mem_used) if mem_used else None,
            "disk_total": round(disk_total, 2) if disk_total else None,
            "disk_used": round(disk_used, 2) if disk_used else None,
            "cpu_temperature": None,  # watcher doesn't expose this
            "uptime": uptime_secs,
        }

    return {"services": services, "system": system}


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
            return _transform_watcher_response(resp.json())
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
