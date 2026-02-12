# Logging

## Overview

MeticAI uses structured JSON logging with automatic rotation. All logs are stored locally inside the container at `/app/logs/`.

## Log Files

| File | Contents |
|------|----------|
| `meticai-server.log` | All log entries (JSON) |
| `meticai-server-errors.log` | Errors only (JSON) |

**Retention:** 10 MB per file, 5 rotated backups (≤ 60 MB total).

## Viewing Logs

```bash
# Container stdout
docker logs meticai -f

# Via API (last 100 entries)
curl http://<SERVER_IP>:3550/api/logs

# Errors only
curl "http://<SERVER_IP>:3550/api/logs?level=ERROR&lines=200"

# Inside the container
docker exec meticai tail -f /app/logs/meticai-server.log | jq .
```

### API Query Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `lines` | 100 | Number of entries (max 1000) |
| `level` | all | `DEBUG` `INFO` `WARNING` `ERROR` `CRITICAL` |
| `log_type` | `all` | `all` or `errors` |

## Log Entry Format

Each JSON entry includes: `timestamp`, `level`, `message`, `request_id`, `endpoint`, `duration_ms`. Errors additionally include `error_type` and `traceback`.

## Troubleshooting

```bash
# Verify container is running
docker ps | grep meticai

# Check s6 service logs
docker exec meticai cat /var/log/mcp-server.log

# Restart a single service
docker exec meticai s6-svc -r /run/service/server
```

## Privacy

Logs capture IP addresses, user agents, and timestamps for debugging. Coffee images, credentials, and API keys are **never** logged. All data stays on your server.
