"""MQTT subscriber service — receives telemetry from mosquitto and exposes it
to WebSocket clients.

Architecture:
  mosquitto (:1883) ← meticulous-bridge (Socket.IO → MQTT)
  FastAPI server subscribes to `meticulous_espresso/sensor/#`
  WebSocket endpoint reads latest state dict and pushes to clients at ≤10 FPS.

The subscriber runs in a background *thread* (paho-mqtt v1 uses its own
network loop) and bridges into asyncio via an `asyncio.Event` that is set
whenever new data arrives.
"""

import asyncio
import json
import logging
import os
import threading
import time
from typing import Any, Callable, Dict, Optional, Set

logger = logging.getLogger(__name__)

TEST_MODE = os.environ.get("TEST_MODE") == "true"

# ---------------------------------------------------------------------------
# Topic prefix published by the meticulous-addon bridge
# ---------------------------------------------------------------------------
TOPIC_PREFIX = "meticulous_espresso/sensor/"
AVAILABILITY_TOPIC = "meticulous_espresso/availability"
HEALTH_TOPIC = "meticulous_espresso/health"

# ---------------------------------------------------------------------------
# Sensor key → value type coercion
# ---------------------------------------------------------------------------
_FLOAT_SENSORS = frozenset({
    "boiler_temperature", "brew_head_temperature",
    "external_temp_1", "external_temp_2",
    "pressure", "flow_rate", "shot_weight", "shot_timer",
    "preheat_countdown", "target_temperature", "target_weight",
})

_BOOL_SENSORS = frozenset({
    "brewing", "connected",
})

_INT_SENSORS = frozenset({
    "total_shots", "voltage",
})


def _coerce_value(sensor_key: str, raw: str) -> Any:
    """Convert a raw MQTT string payload to its appropriate Python type."""
    if sensor_key in _FLOAT_SENSORS:
        try:
            return round(float(raw), 2)
        except (ValueError, TypeError):
            return raw
    if sensor_key in _BOOL_SENSORS:
        return raw.lower() in ("true", "1", "on")
    if sensor_key in _INT_SENSORS:
        try:
            return int(float(raw))
        except (ValueError, TypeError):
            return raw
    return raw


# ============================================================================
# MQTTSubscriber — singleton
# ============================================================================

class MQTTSubscriber:
    """Thread-safe MQTT subscriber that keeps the latest sensor snapshot.

    Call `start()` during FastAPI lifespan startup and `stop()` on shutdown.
    WebSocket handlers read `self.snapshot` and wait on `self.data_event`.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ws_lock = threading.Lock()
        self.snapshot: Dict[str, Any] = {}
        self._availability: Optional[str] = None
        self._health: Optional[dict] = None
        self._client: Any = None  # paho.mqtt.client.Client
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.data_event: Optional[asyncio.Event] = None
        self._connected_ws: Set[int] = set()  # track WebSocket client count

    # -- lifecycle -----------------------------------------------------------

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Connect to mosquitto in a background thread."""
        if TEST_MODE:
            logger.info("MQTT subscriber skipped (TEST_MODE)")
            return

        mqtt_enabled = os.environ.get("MQTT_ENABLED", "true").lower() == "true"
        if not mqtt_enabled:
            logger.info("MQTT subscriber disabled (MQTT_ENABLED=false)")
            return

        self._loop = loop
        self.data_event = asyncio.Event()

        mqtt_host = os.environ.get("MQTT_HOST", "127.0.0.1")
        mqtt_port = int(os.environ.get("MQTT_PORT", "1883"))

        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            logger.warning("paho-mqtt not installed — MQTT subscriber disabled")
            return

        self._client = mqtt.Client(client_id="meticai-server", clean_session=True)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message
        self._client.on_disconnect = self._on_disconnect

        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop,
            args=(mqtt_host, mqtt_port),
            daemon=True,
            name="mqtt-subscriber",
        )
        self._thread.start()
        logger.info("MQTT subscriber started → %s:%d", mqtt_host, mqtt_port)

    def stop(self) -> None:
        """Disconnect and join the background thread."""
        self._running = False
        if self._client is not None:
            try:
                self._client.loop_stop(force=True)
            except Exception:
                pass
            try:
                self._client.disconnect()
            except Exception:
                pass
        if self._thread is not None:
            self._thread.join(timeout=5)
            if self._thread.is_alive():
                logger.warning("MQTT subscriber thread did not exit within 5 s")
            self._thread = None
        logger.info("MQTT subscriber stopped")

    # -- paho callbacks (run in the background thread) -----------------------

    def _run_loop(self, host: str, port: int) -> None:
        """Blocking loop with auto-reconnect."""
        while self._running:
            try:
                self._client.connect(host, port, keepalive=60)
                self._client.loop_forever()
            except Exception as exc:
                logger.warning("MQTT connection failed: %s — retrying in 5s", exc)
                time.sleep(5)

    def _on_connect(self, client: Any, userdata: Any, flags: Any, rc: int) -> None:
        if rc == 0:
            logger.info("MQTT connected, subscribing to telemetry topics")
            client.subscribe(f"{TOPIC_PREFIX}#", qos=1)
            client.subscribe(AVAILABILITY_TOPIC, qos=1)
            client.subscribe(HEALTH_TOPIC, qos=1)
        else:
            logger.warning("MQTT connect failed rc=%d", rc)

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        topic: str = msg.topic
        payload = msg.payload.decode("utf-8", errors="replace")

        if topic == AVAILABILITY_TOPIC:
            with self._lock:
                self._availability = payload
                self.snapshot["availability"] = payload
            self._signal_update()
            return

        if topic == HEALTH_TOPIC:
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                data = payload
            with self._lock:
                self._health = data
                self.snapshot["health"] = data
            self._signal_update()
            return

        # Sensor topics: meticulous_espresso/sensor/{key}/state
        if topic.startswith(TOPIC_PREFIX) and topic.endswith("/state"):
            sensor_key = topic[len(TOPIC_PREFIX):-len("/state")]
            value = _coerce_value(sensor_key, payload)
            with self._lock:
                self.snapshot[sensor_key] = value
            self._signal_update()

    def _on_disconnect(self, client: Any, userdata: Any, rc: int) -> None:
        if rc != 0:
            logger.warning("MQTT disconnected unexpectedly rc=%d, will reconnect", rc)

    # -- helpers -------------------------------------------------------------

    def _signal_update(self) -> None:
        """Thread-safe: set the asyncio Event from the paho thread."""
        if self._loop and self.data_event:
            self._loop.call_soon_threadsafe(self.data_event.set)

    def get_snapshot(self) -> Dict[str, Any]:
        """Return a copy of the current sensor snapshot."""
        with self._lock:
            return dict(self.snapshot)

    @property
    def ws_client_count(self) -> int:
        with self._ws_lock:
            return len(self._connected_ws)

    def register_ws(self, ws_id: int) -> None:
        with self._ws_lock:
            self._connected_ws.add(ws_id)

    def unregister_ws(self, ws_id: int) -> None:
        with self._ws_lock:
            self._connected_ws.discard(ws_id)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_subscriber: Optional[MQTTSubscriber] = None
_subscriber_lock = threading.Lock()


def get_mqtt_subscriber() -> MQTTSubscriber:
    """Return the global MQTTSubscriber (lazy-created, thread-safe)."""
    global _subscriber
    if _subscriber is None:
        with _subscriber_lock:
            if _subscriber is None:
                _subscriber = MQTTSubscriber()
    return _subscriber


def reset_mqtt_subscriber() -> None:
    """Stop and discard the current subscriber (for hot-reload)."""
    global _subscriber
    with _subscriber_lock:
        if _subscriber is not None:
            _subscriber.stop()
            _subscriber = None
