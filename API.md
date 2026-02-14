# MeticAI v2.0 — API Reference

## Base URL

```
http://<SERVER_IP>:3550/api
```

All endpoints are served via nginx on port **3550**. The `/api` prefix is required.
Container name: `meticai`. Interactive docs: `http://<SERVER_IP>:3550/api/docs`

---

## Coffee Analysis

### Analyze & Create Profile *(recommended)*
`POST /analyze_and_profile`

Analyzes a coffee bag image and creates a machine profile in one pass.
Requires at least one of `file` (image) or `user_prefs` (text).

```bash
curl -X POST http://<SERVER_IP>:3550/api/analyze_and_profile \
  -F "file=@coffee_bag.jpg" \
  -F "user_prefs=Balanced extraction"
```

### Analyze Coffee Only
`POST /analyze_coffee`

Image analysis without profile creation. Requires `file`.

```bash
curl -X POST http://<SERVER_IP>:3550/api/analyze_coffee \
  -F "file=@coffee_bag.jpg"
```

---

## Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/profiles` | List all profiles on machine |
| GET | `/api/machine/profiles/count` | Profile count |
| GET | `/api/machine/profile/{profile_id}/json` | Profile JSON data |
| GET | `/api/profile/{name}` | Profile details by name |
| GET | `/api/profile/{name}/image-proxy` | Proxy profile image |
| POST | `/api/profile/{name}/image` | Upload profile image |
| POST | `/api/profile/{name}/generate-image` | AI-generate profile image |
| POST | `/api/profile/{name}/apply-image` | Apply generated image |
| POST | `/api/profile/import` | Import a single profile |
| POST | `/api/profile/import-all` | Import all profiles |
| POST | `/api/profile/convert-description` | Convert description to profile |

---

## Shots

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shots/dates` | List available shot dates |
| GET | `/api/shots/files/{date}` | Shot files for a date |
| GET | `/api/shots/data/{date}/{filename}` | Shot data file |
| GET | `/api/shots/by-profile/{profile_name}` | Shots filtered by profile |
| GET | `/api/shots/llm-analysis-cache` | Cached LLM analyses |
| GET | `/api/last-shot` | Most recent shot metadata (powers the "Analyze your last shot?" banner) |
| POST | `/api/shots/analyze` | Analyze shot data |
| POST | `/api/shots/analyze-llm` | LLM-powered shot analysis |

---

## Machine Control

### Get Machine Status
`GET /api/machine/status`

```bash
curl http://<SERVER_IP>:3550/api/machine/status
```

### Preheat Machine
`POST /api/machine/preheat`

```bash
curl -X POST http://<SERVER_IP>:3550/api/machine/preheat
```

### Run Profile Immediately
`POST /api/machine/run-profile/{profile_id}`

```bash
curl -X POST http://<SERVER_IP>:3550/api/machine/run-profile/my-profile-id
```

---

## MQTT Bridge & Control Center

### Bridge Status
`GET /api/bridge/status`

Returns MQTT broker and bridge service health.

```bash
curl http://<SERVER_IP>:3550/api/bridge/status
```

### Restart Bridge
`POST /api/bridge/restart`

Restarts the meticulous-bridge s6 service.

```bash
curl -X POST http://<SERVER_IP>:3550/api/bridge/restart
```

### Live Telemetry WebSocket
`WS /api/ws/live`

WebSocket endpoint for real-time machine telemetry. Subscribes to MQTT topics and forwards sensor updates (pressure, flow, weight, temperature, machine state) to the browser.

```javascript
const ws = new WebSocket('ws://<SERVER_IP>:3550/api/ws/live')
ws.onmessage = (event) => console.log(JSON.parse(event.data))
```

### Machine Commands (via MQTT)

All commands are fire-and-forget — they publish to the MQTT broker which forwards to the machine.

| Method | Endpoint | Description | Precondition |
|--------|----------|-------------|--------------|
| POST | `/api/machine/command/start` | Start a shot | Machine idle |
| POST | `/api/machine/command/stop` | Gracefully stop current shot | Shot running |
| POST | `/api/machine/command/abort` | Immediately abort shot (retracts plunger) | Shot running |
| POST | `/api/machine/command/continue` | Resume a paused shot | — |
| POST | `/api/machine/command/preheat` | Start machine preheat | Machine idle |
| POST | `/api/machine/command/tare` | Tare (zero) the scale | Machine connected |
| POST | `/api/machine/command/home-plunger` | Home the plunger | Machine idle |
| POST | `/api/machine/command/purge` | Run a purge cycle | Machine idle |
| POST | `/api/machine/command/load-profile` | Load a profile (`{ "name": "..." }`) | Machine connected |
| POST | `/api/machine/command/brightness` | Set display brightness (`{ "value": 0-100 }`) | Machine connected |
| POST | `/api/machine/command/sounds` | Enable/disable sounds (`{ "enabled": true }`) | Machine connected |

**Error responses:**
- `409 Conflict` — precondition not met (machine offline, brewing, or idle depending on command)
- `422 Unprocessable Entity` — invalid request body (e.g. brightness > 100, empty profile name)
- `503 Service Unavailable` — MQTT publish failed

---

## Scheduling

### Schedule a Shot
`POST /api/machine/schedule-shot`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profile_id` | string | no | Profile to run |
| `scheduled_time` | ISO 8601 | yes | When to run |
| `preheat` | bool | no | Preheat 10 min before (default: false) |

At least one of `profile_id` or `preheat` must be provided.

```bash
curl -X POST http://<SERVER_IP>:3550/api/machine/schedule-shot \
  -H "Content-Type: application/json" \
  -d '{"profile_id":"morning-blend","scheduled_time":"2026-02-02T07:00:00Z","preheat":true}'
```

### List Scheduled Shots
`GET /api/machine/scheduled-shots`

### Cancel Scheduled Shot
`DELETE /api/machine/schedule-shot/{schedule_id}`

```bash
curl -X DELETE http://<SERVER_IP>:3550/api/machine/schedule-shot/<schedule_id>
```

### Recurring Schedules

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/recurring-schedules` | List recurring schedules |
| POST | `/api/machine/recurring-schedules` | Create recurring schedule |
| PUT | `/api/machine/recurring-schedules/{id}` | Update recurring schedule |
| DELETE | `/api/machine/recurring-schedules/{id}` | Delete recurring schedule |

**Shot status values:** `scheduled` · `preheating` · `running` · `completed` · `failed` · `cancelled`

---

## Analysis History

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/history` | List all analysis history |
| GET | `/api/history/{entry_id}` | Get single entry |
| GET | `/api/history/{entry_id}/json` | Entry as raw JSON |
| DELETE | `/api/history/{entry_id}` | Delete entry |
| DELETE | `/api/history` | Clear all history |
| POST | `/api/history/migrate` | Migrate legacy data |

---

## System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Update availability & system status |
| GET | `/api/version` | Server version |
| GET | `/api/settings` | Current settings |
| POST | `/api/settings` | Save settings (triggers hot-reload) |
| POST | `/api/restart` | Restart container services |
| GET | `/api/logs` | Retrieve log entries |
| GET | `/api/changelog` | Changelog |
| GET | `/api/network-ip` | Server network IP |
| GET | `/api/watcher-status` | Watchtower status |
| GET | `/api/update-method` | Current update method |
| GET | `/api/tailscale-status` | Tailscale connection info |
| POST | `/api/check-updates` | Trigger update check |
| GET | `/health` | Health check (no `/api` prefix) |

### Logs Query Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `lines` | 100 | Number of entries (max 1000) |
| `level` | all | `DEBUG` `INFO` `WARNING` `ERROR` `CRITICAL` |
| `log_type` | `all` | `all` or `errors` |

```bash
curl "http://<SERVER_IP>:3550/api/logs?lines=200&level=ERROR"
```

---

## Troubleshooting

```bash
# Check container is running
docker ps | grep meticai

# View logs
docker logs meticai -f

# Test connectivity
curl http://<SERVER_IP>:3550/health

# API errors via logs endpoint
curl "http://<SERVER_IP>:3550/api/logs?level=ERROR&lines=50"
```
