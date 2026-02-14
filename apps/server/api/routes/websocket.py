"""WebSocket endpoint for live machine telemetry.

Streams the latest MQTT sensor snapshot to connected browser clients
at a capped rate of ~10 frames per second to protect low-powered hosts
(e.g. Raspberry Pi).

Route: ws://host:3550/api/ws/live
"""

import asyncio
import json
import logging
import os
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.mqtt_service import get_mqtt_subscriber

router = APIRouter()
logger = logging.getLogger(__name__)

# Max update rate — 10 FPS → 100 ms between frames
FRAME_INTERVAL = 0.1  # seconds

TEST_MODE = os.environ.get("TEST_MODE") == "true"


@router.websocket("/api/ws/live")
async def live_telemetry(ws: WebSocket):
    """Stream live machine telemetry over WebSocket.

    Protocol (server → client):
      Each message is a JSON object with the full sensor snapshot,
      plus a `_ts` field (Unix epoch float) for client-side staleness
      detection.

    The server rate-limits to ~10 FPS. If no new data arrives from MQTT
    the connection stays open but silent (no empty keepalives).
    """
    await ws.accept()

    subscriber = get_mqtt_subscriber()
    ws_id = id(ws)
    subscriber.register_ws(ws_id)

    logger.info("WebSocket client connected (id=%d, total=%d)",
                ws_id, subscriber.ws_client_count)

    try:
        last_sent: dict = {}

        while True:
            # In TEST_MODE there's no MQTT data — just wait for the
            # client to close.  We use receive_text() which will raise
            # WebSocketDisconnect when the client closes the socket.
            if TEST_MODE or subscriber.data_event is None:
                try:
                    await asyncio.wait_for(ws.receive_text(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                except WebSocketDisconnect:
                    break
                continue

            # Wait for new data from the MQTT thread (or timeout)
            try:
                await asyncio.wait_for(subscriber.data_event.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                # No data in 5 s — send a heartbeat so the browser knows
                # the connection is still alive
                try:
                    await ws.send_json({"_heartbeat": True, "_ts": time.time()})
                except Exception:
                    break
                continue

            subscriber.data_event.clear()

            # Rate-limit: sleep until at least FRAME_INTERVAL since last send
            snapshot = subscriber.get_snapshot()
            if snapshot == last_sent:
                continue  # No actual change

            await asyncio.sleep(FRAME_INTERVAL)

            snapshot["_ts"] = time.time()
            try:
                await ws.send_json(snapshot)
            except Exception:
                break

            last_sent = {k: v for k, v in snapshot.items() if k != "_ts"}

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        subscriber.unregister_ws(ws_id)
        logger.info("WebSocket client disconnected (id=%d, remaining=%d)",
                    ws_id, subscriber.ws_client_count)
