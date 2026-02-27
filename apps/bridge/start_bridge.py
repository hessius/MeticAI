#!/usr/bin/env python3
"""
MeticAI Bridge Starter — Zero-fork adapter for @nickwilsonr/meticulous-addon.

This script bridges MeticAI's environment-variable configuration to the addon's
options.json format, then starts the addon without modifying upstream code.

The addon is cloned at Docker build time from:
  https://github.com/nickwilsonr/meticulous-addon

Configuration is derived from MeticAI environment variables:
  - METICULOUS_IP  → machine_ip
  - MQTT_HOST      → mqtt_host (default: 127.0.0.1 for local mosquitto)
  - MQTT_PORT      → mqtt_port (default: 1883)
  - BRIDGE_DEBUG   → debug logging toggle

Credit: @nickwilsonr for the excellent meticulous-addon.
License: MIT (same as upstream)
"""

import json
import logging
import os
import sys
import asyncio
from typing import Any, Optional

logger = logging.getLogger("meticai.bridge")


def _as_float(value: Any) -> Optional[float]:
    """Best-effort float conversion."""
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_value(container: Any, key: str) -> Any:
    """Get a value from dict/object containers."""
    if container is None:
        return None
    if isinstance(container, dict):
        return container.get(key)
    return getattr(container, key, None)


def _extract_power_value(payload: Any) -> Optional[float]:
    """Extract power percentage from status/actuator payloads.

    The upstream add-on defines a `power` sensor but does not consistently
    populate it in status callbacks. This helper probes common field names
    used by Socket.IO payload variants and returns the first numeric value.
    """
    power_keys = (
        "power",
        "motor_power",
        "motorPower",
        "heater_power",
        "heaterPower",
        "pwr",
        "pw",
        "mp",
    )

    nested_keys = (
        "sensors",
        "actuators",
        "motor",
        "heater",
    )

    containers = [payload]
    for nested in nested_keys:
        nested_obj = _extract_value(payload, nested)
        if nested_obj is not None:
            containers.append(nested_obj)

    for container in containers:
        for key in power_keys:
            value = _as_float(_extract_value(container, key))
            if value is not None:
                return max(0.0, min(100.0, value))
    return None


def _publish_power_if_available(addon: Any, payload: Any) -> None:
    """Publish power telemetry to MQTT if present in raw event payload."""
    power_value = _extract_power_value(payload)
    if power_value is None:
        return

    # Reuse add-on throttling so we don't spam MQTT updates.
    fields = addon._filter_throttled_fields({"power": round(power_value, 2)})
    if fields and getattr(addon, "loop", None):
        asyncio.run_coroutine_threadsafe(
            addon.publish_to_homeassistant(fields), addon.loop
        )


def _patch_addon_power_telemetry() -> None:
    """Monkey-patch upstream add-on to emit real-time power values.

    We patch runtime methods instead of forking upstream code. This keeps
    MeticAI's zero-fork bridge model intact while restoring power telemetry.
    """
    try:
        import run  # type: ignore
    except Exception as exc:
        logger.warning("Could not import add-on runtime for patching: %s", exc)
        return

    addon_cls = getattr(run, "MeticulousAddon", None)
    if addon_cls is None:
        logger.warning("MeticulousAddon class not found in add-on runtime")
        return

    original_init = addon_cls.__init__
    original_status_handler = addon_cls._handle_status_event
    original_actuators_handler = addon_cls._handle_actuators_event

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        try:
            # Ensure power participates in delta filtering.
            self.sensor_deltas["power"] = float(self.config.get("power_delta", 1.0))
        except Exception:
            self.sensor_deltas["power"] = 1.0

    def patched_status_handler(self, status):
        original_status_handler(self, status)
        try:
            _publish_power_if_available(self, status)
        except Exception as exc:
            logger.debug("Power patch status handler error: %s", exc)

    def patched_actuators_handler(self, actuators):
        original_actuators_handler(self, actuators)
        try:
            _publish_power_if_available(self, actuators)
        except Exception as exc:
            logger.debug("Power patch actuators handler error: %s", exc)

    addon_cls.__init__ = patched_init
    addon_cls._handle_status_event = patched_status_handler
    addon_cls._handle_actuators_event = patched_actuators_handler
    logger.info("Applied runtime power telemetry patch to meticulous-addon")


def _resolve_machine_ip() -> str:
    """Determine the Meticulous machine IP.

    Priority:
    1. ``METICULOUS_IP`` environment variable (set by s6 container env)
    2. ``meticulousIp`` field in ``/data/settings.json`` (persisted by the UI)
    3. ``meticulous.local`` (mDNS default)
    """
    # 1) Env var — preferred, set by s6-overlay container environment
    env_ip = os.environ.get("METICULOUS_IP", "").strip()
    if env_ip:
        return env_ip

    # 2) Persisted settings file (written by the web UI)
    settings_path = os.path.join(
        os.environ.get("DATA_DIR", "/data"), "settings.json"
    )
    try:
        with open(settings_path) as f:
            settings = json.load(f)
        saved_ip = (settings.get("meticulousIp") or "").strip()
        if saved_ip:
            logger.info("Using machine IP from settings.json: %s", saved_ip)
            return saved_ip
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass

    # 3) Default
    return "meticulous.local"


def build_config() -> dict:
    """Build addon config dict from MeticAI environment variables."""
    return {
        # Machine connection
        "machine_ip": _resolve_machine_ip(),

        # MQTT broker (local mosquitto inside the same container)
        "mqtt_enabled": os.environ.get("MQTT_ENABLED", "true").lower() == "true",
        "mqtt_host": os.environ.get("MQTT_HOST", "127.0.0.1"),
        "mqtt_port": int(os.environ.get("MQTT_PORT", "1883")),
        "mqtt_username": os.environ.get("MQTT_USERNAME", ""),
        "mqtt_password": os.environ.get("MQTT_PASSWORD", ""),

        # Delta filtering (sensible defaults — reduce MQTT noise)
        "enable_delta_filtering": True,
        "temperature_delta": float(os.environ.get("BRIDGE_TEMP_DELTA", "0.5")),
        "pressure_delta": float(os.environ.get("BRIDGE_PRESSURE_DELTA", "0.2")),
        "flow_delta": float(os.environ.get("BRIDGE_FLOW_DELTA", "0.1")),
        "weight_delta": float(os.environ.get("BRIDGE_WEIGHT_DELTA", "0.1")),
        "time_delta": float(os.environ.get("BRIDGE_TIME_DELTA", "0.1")),
        "voltage_delta": float(os.environ.get("BRIDGE_VOLTAGE_DELTA", "1.0")),
        "power_delta": float(os.environ.get("BRIDGE_POWER_DELTA", "1.0")),

        # Stale data refresh (hours)
        "stale_data_refresh_interval": int(
            os.environ.get("BRIDGE_STALE_REFRESH_HOURS", "24")
        ),

        # Debug logging
        "debug": os.environ.get("BRIDGE_DEBUG", "false").lower() == "true",
    }


def write_addon_config(config: dict) -> None:
    """Write config as /data/options.json (the format the addon expects)."""
    config_path = "/data/options.json"
    os.makedirs("/data", exist_ok=True)
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    logger.info("Wrote bridge config to %s", config_path)


def main():
    """Generate config and start the meticulous-addon bridge."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    config = build_config()

    if not config["mqtt_enabled"]:
        logger.info("MQTT bridge is disabled (MQTT_ENABLED=false). Exiting.")
        sys.exit(0)

    machine_ip = config["machine_ip"]
    logger.info(
        "Starting meticulous-addon bridge: machine=%s, mqtt=%s:%d",
        machine_ip,
        config["mqtt_host"],
        config["mqtt_port"],
    )

    # Write the config file the addon expects
    write_addon_config(config)

    # Add the addon source directory to Python path
    addon_src = "/app/meticulous-addon/rootfs/usr/bin"
    if addon_src not in sys.path:
        sys.path.insert(0, addon_src)

    # Patch upstream add-on runtime to publish real power telemetry.
    _patch_addon_power_telemetry()

    # Import and run the addon's main entry point
    try:
        from run import main as addon_main  # noqa: E402

        addon_main()
    except ImportError as e:
        logger.error(
            "Failed to import meticulous-addon. "
            "Ensure it is cloned at /app/meticulous-addon: %s",
            e,
        )
        sys.exit(1)
    except Exception as e:
        logger.error("Bridge crashed: %s", e, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
