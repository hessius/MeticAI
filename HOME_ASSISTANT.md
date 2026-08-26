# 🏠 Home Assistant Integration

> **⚠️ Removed in 3.0.0.** The MQTT bridge (Mosquitto broker + the
> [meticulous-addon](https://github.com/nickwilsonr/meticulous-addon) by
> @nickwilsonr) and Home Assistant MQTT auto-discovery were removed when the
> legacy Python backend was replaced by the unified Bun server. Metic no longer
> ships an MQTT broker, no longer exposes port 1883, and no longer publishes
> auto-discovery topics.

## What changed

Earlier 2.x releases ran an internal Mosquitto broker and a Socket.IO → MQTT
bridge so Home Assistant could subscribe to live machine telemetry. In 3.0.0 the
whole stack collapsed into a single Bun process. Live telemetry now streams
directly to the Metic web UI over the built-in `/api/ws/live` WebSocket, so there
is no broker for Home Assistant to connect to.

Live telemetry and machine control remain fully functional **inside Metic** — only
the Home Assistant MQTT integration was removed.

## If you rely on Home Assistant

You have a few options:

- **Stay on 2.x** if the MQTT bridge is essential to your setup. The 2.x images
  (`ghcr.io/hessius/meticai:2`) still include the broker and this integration.
  The setup instructions for 2.x are preserved in the Git history of this file.
- **Consume the WebSocket directly.** The live telemetry stream is available at
  `ws://<SERVER_IP>:3550/api/ws/live` and emits JSON sensor updates (pressure,
  flow, weight, temperature, machine state). A small custom script or add-on can
  bridge this into Home Assistant if you need it.
- **Use the machine's own API.** Metic transparently proxies the Meticulous
  machine API under `/api/v1/*` (see [API.md](API.md)), which you can poll from
  Home Assistant automations.

## Want it back?

If native Home Assistant support (without the old MQTT broker) is important to
you, please open or upvote an issue at
<https://github.com/hessius/MeticAI/issues> so it can be prioritised.
