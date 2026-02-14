"""Bridge service — monitors MQTT broker and meticulous-bridge health."""
import asyncio
import logging
import os
import subprocess
import tempfile
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

TEST_MODE = os.environ.get("TEST_MODE") == "true"


def _is_process_running(process_name: str) -> bool:
    """Check if a process is running by name (via pgrep)."""
    if TEST_MODE:
        return False
    try:
        result = subprocess.run(
            ["pgrep", "-f", process_name],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def _check_s6_service(service_name: str) -> str:
    """Check s6 service status. Returns 'running', 'down', or 'unknown'."""
    if TEST_MODE:
        return "unknown"
    service_path = f"/run/service/{service_name}"
    try:
        result = subprocess.run(
            ["s6-svstat", service_path],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            output = result.stdout.strip()
            if "up" in output:
                return "running"
            elif "down" in output:
                return "down"
        return "unknown"
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return "unknown"


def _check_mqtt_port(host: str = "127.0.0.1", port: int = 1883) -> bool:
    """Check if the MQTT broker port is accepting connections."""
    if TEST_MODE:
        return False
    import socket as sock
    try:
        with sock.create_connection((host, port), timeout=2):
            return True
    except (OSError, ConnectionRefusedError):
        return False


def get_bridge_status() -> Dict[str, Any]:
    """Get the full status of the MQTT bridge infrastructure.

    Returns a dict with:
    - mqtt_enabled: whether MQTT is configured to be enabled
    - mosquitto: status of the MQTT broker service
    - bridge: status of the meticulous-bridge service
    - mqtt_port_open: whether the MQTT port is accepting connections
    """
    mqtt_enabled = os.environ.get("MQTT_ENABLED", "true").lower() == "true"
    mqtt_host = os.environ.get("MQTT_HOST", "127.0.0.1")
    mqtt_port = int(os.environ.get("MQTT_PORT", "1883"))

    return {
        "mqtt_enabled": mqtt_enabled,
        "mosquitto": {
            "service": _check_s6_service("mosquitto"),
            "port_open": _check_mqtt_port(mqtt_host, mqtt_port),
            "host": mqtt_host,
            "port": mqtt_port,
        },
        "bridge": {
            "service": _check_s6_service("meticulous-bridge"),
        },
    }


def restart_bridge_service() -> bool:
    """Restart the meticulous-bridge s6 service.

    Returns True if the restart command succeeded.
    """
    if TEST_MODE:
        return True
    try:
        result = subprocess.run(
            ["s6-svc", "-r", "/run/service/meticulous-bridge"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False
