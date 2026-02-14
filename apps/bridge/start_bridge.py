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

logger = logging.getLogger("meticai.bridge")


def build_config() -> dict:
    """Build addon config dict from MeticAI environment variables."""
    return {
        # Machine connection
        "machine_ip": os.environ.get("METICULOUS_IP", "meticulous.local"),

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
