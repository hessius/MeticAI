# API Reference

MeticAI provides a REST API for programmatic control and integration with external services.

## Base URL
```
http://<PI_IP>:8000
```

## Endpoints

### 1. Unified Analysis & Profile Creation (Recommended)
`POST /analyze_and_profile`

This consolidated endpoint analyzes coffee and creates a profile in a single LLM pass.

**Required**: At least ONE of the following:
- `file`: Image of the coffee bag (multipart/form-data)
- `user_prefs`: User preferences or specific instructions (form data)

**Example with image only:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg"
```

**Example with preferences only:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_and_profile \
  -F "user_prefs=Strong and intense espresso"
```

**Example with both:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_and_profile \
  -F "file=@coffee_bag.jpg" \
  -F "user_prefs=Balanced extraction"
```

**Response:**
```json
{
  "status": "success",
  "analysis": "Ethiopian Yirgacheffe, Light Roast, Floral and Citrus Notes",
  "reply": "Profile uploaded"
}
```

### 2. Quick Coffee Analysis (Standalone)
`POST /analyze_coffee`

For quick coffee bag analysis without profile creation.

**Required**: 
- `file`: Image of the coffee bag (multipart/form-data)

**Example:**
```bash
curl -X POST http://<PI_IP>:8000/analyze_coffee \
  -F "file=@coffee_bag.jpg"
```

**Response:**
```json
{
  "analysis": "Ethiopian Yirgacheffe, Light Roast, Floral and Citrus Notes"
}
```

### 3. System Status
`GET /status`

Check for updates and system status.

**Example:**
```bash
curl http://<PI_IP>:8000/status
```

**Response:**
```json
{
  "update_available": true/false,
  "last_check": "2026-01-13T19:45:00Z",
  "repositories": {
    "meticai": { "current_hash": "abc123...", "last_updated": "..." },
    "meticulous-mcp": { "current_hash": "def456...", "repo_url": "...", "last_updated": "..." },
    "meticai-web": { "current_hash": "ghi789...", "last_updated": "..." }
  }
}
```

### 4. Trigger Update
`POST /api/trigger-update`

Triggers the backend update process by running `update.sh --auto` on the server.

**Request:** No body needed.

**Response:**
- `200 OK` with JSON containing script output if successful:
  ```json
  {
    "status": "success",
    "output": "... script output ...",
    "message": "Update script completed successfully"
  }
  ```
- `500 Internal Server Error` with error details if failed:
  ```json
  {
    "detail": {
      "status": "error",
      "output": "... partial output ...",
      "error": "... error message ...",
      "message": "Update script failed"
    }
  }
  ```

**Example (curl):**
```bash
curl -X POST http://<PI_IP>:8000/api/trigger-update
```

**Example (JavaScript):**
```javascript
fetch('http://YOUR_PI_IP:8000/api/trigger-update', { method: 'POST' })
  .then(r => r.json())
  .then(data => {
    if (data.status === 'success') {
      console.log('Update completed:', data.output);
    } else {
      console.error('Update failed:', data.error);
    }
  });
```

**Security Note:**  
This endpoint is open to anyone with access to the backend API. Ensure your backend is not publicly exposed or restrict access at the network level if necessary. The update process will:
- Pull latest code from all repositories
- Rebuild Docker containers (where possible from inside container)
- Restart services automatically

Consider the implications before exposing this endpoint publicly.

### 5. Retrieve Logs (Diagnostics)
`GET /api/logs`

Retrieve recent log entries for debugging and diagnostics.

**Query Parameters:**
- `lines` (optional): Number of log entries to retrieve (default: 100, max: 1000)
- `level` (optional): Filter by log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- `log_type` (optional): Type of logs to retrieve - "all" or "errors" (default: "all")

**Example:**
```bash
# Get last 100 log entries
curl http://<PI_IP>:8000/api/logs

# Get last 500 entries
curl "http://<PI_IP>:8000/api/logs?lines=500"

# Get only ERROR level logs
curl "http://<PI_IP>:8000/api/logs?level=ERROR"

# Get error-only log file
curl "http://<PI_IP>:8000/api/logs?log_type=errors"

# Combine filters
curl "http://<PI_IP>:8000/api/logs?lines=200&level=ERROR&log_type=errors"
```

**Response:**
```json
{
  "logs": [
    {
      "timestamp": "2024-01-16T20:15:30.123456Z",
      "level": "ERROR",
      "message": "Coffee analysis failed: Rate limit exceeded",
      "request_id": "a3f2d1e9-5c8b-4f1a-9d3e-2a7b6c8d9e0f",
      "endpoint": "/analyze_coffee",
      "client_ip": "192.168.1.100",
      "error_type": "RateLimitError",
      "exception": {...}
    }
  ],
  "total_lines": 100,
  "log_file": "/app/logs/meticai-server.log",
  "filters": {
    "lines_requested": 100,
    "level": null,
    "log_type": "all"
  }
}
```

For more details on the logging system, see [LOGGING.md](LOGGING.md).

### 6. Machine Control & Scheduled Shots

#### 6.1 Get Machine Status
`GET /api/machine/status`

Get the current status of the Meticulous espresso machine, including scheduled shots.

**Example:**
```bash
curl http://<PI_IP>:8000/api/machine/status
```

**Response:**
```json
{
  "status": "success",
  "machine_status": {
    "state": "idle",
    "temperature": 93.5
  },
  "settings": {
    "auto_preheat": 0
  },
  "current_profile": {
    "id": "profile-123",
    "name": "Morning Blend"
  },
  "scheduled_shots": [
    {
      "id": "shot-uuid-1",
      "profile_id": "profile-123",
      "scheduled_time": "2026-02-01T18:00:00Z",
      "preheat": true,
      "status": "scheduled",
      "created_at": "2026-02-01T17:30:00Z"
    }
  ]
}
```

#### 6.2 Preheat Machine
`POST /api/machine/preheat`

Start preheating the espresso machine. Preheating takes approximately 10 minutes.

**Example:**
```bash
curl -X POST http://<PI_IP>:8000/api/machine/preheat
```

**Response:**
```json
{
  "status": "success",
  "message": "Preheat started",
  "estimated_ready_in_minutes": 10
}
```

#### 6.3 Run Profile
`POST /api/machine/run-profile/{profile_id}`

Load and run a specific profile immediately.

**Example:**
```bash
curl -X POST http://<PI_IP>:8000/api/machine/run-profile/my-profile-id
```

**Response:**
```json
{
  "status": "success",
  "message": "Profile loaded and started",
  "profile_id": "my-profile-id"
}
```

#### 6.4 Schedule Shot
`POST /api/machine/schedule-shot`

Schedule a shot to run at a specific time in the future. Scheduled shots persist across server restarts.

**Request Body:**
- `profile_id` (optional): Profile ID to run
- `scheduled_time` (required): ISO format datetime (e.g., "2026-02-01T18:00:00Z")
- `preheat` (optional): Whether to preheat 10 minutes before (default: false)

**Note:** Either `profile_id` or `preheat` must be provided (or both).

**Example - Schedule with profile:**
```bash
curl -X POST http://<PI_IP>:8000/api/machine/schedule-shot \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "morning-blend",
    "scheduled_time": "2026-02-02T07:00:00Z",
    "preheat": true
  }'
```

**Example - Preheat only:**
```bash
curl -X POST http://<PI_IP>:8000/api/machine/schedule-shot \
  -H "Content-Type: application/json" \
  -d '{
    "scheduled_time": "2026-02-02T07:00:00Z",
    "preheat": true
  }'
```

**Response:**
```json
{
  "status": "success",
  "schedule_id": "uuid-of-scheduled-shot",
  "scheduled_shot": {
    "id": "uuid-of-scheduled-shot",
    "profile_id": "morning-blend",
    "scheduled_time": "2026-02-02T07:00:00Z",
    "preheat": true,
    "status": "scheduled",
    "created_at": "2026-02-01T20:00:00Z"
  }
}
```

#### 6.5 List Scheduled Shots
`GET /api/machine/scheduled-shots`

List all scheduled shots. Completed or cancelled shots are automatically cleaned up after 1 hour.

**Example:**
```bash
curl http://<PI_IP>:8000/api/machine/scheduled-shots
```

**Response:**
```json
{
  "status": "success",
  "scheduled_shots": [
    {
      "id": "uuid-1",
      "profile_id": "morning-blend",
      "scheduled_time": "2026-02-02T07:00:00Z",
      "preheat": true,
      "status": "scheduled",
      "created_at": "2026-02-01T20:00:00Z"
    }
  ]
}
```

#### 6.6 Cancel Scheduled Shot
`DELETE /api/machine/schedule-shot/{schedule_id}`

Cancel a scheduled shot.

**Example:**
```bash
curl -X DELETE http://<PI_IP>:8000/api/machine/schedule-shot/uuid-of-scheduled-shot
```

**Response:**
```json
{
  "status": "success",
  "message": "Scheduled shot cancelled",
  "schedule_id": "uuid-of-scheduled-shot"
}
```

#### Scheduled Shots Persistence

**Important:** Scheduled shots are automatically persisted to disk and will survive server restarts. This ensures that:

- Scheduled shots are not lost during crashes, deploys, or host reboots
- When the server restarts, pending scheduled shots are automatically restored
- Background tasks are recreated to execute shots at the scheduled time
- Expired scheduled shots (time in the past) are automatically skipped during restoration

**Persistence Location:** Scheduled shots are stored in `/app/data/scheduled_shots.json` (or a temporary directory if the default location is not writable).

**Status Values:**
- `scheduled`: Shot is scheduled and waiting to execute
- `preheating`: Machine is preheating before the shot
- `running`: Shot is currently executing
- `completed`: Shot completed successfully
- `failed`: Shot failed (includes error message)
- `cancelled`: Shot was cancelled by user

For more details on the logging system, see [LOGGING.md](LOGGING.md).

## Interactive API Documentation

MeticAI includes automatic interactive API documentation powered by FastAPI:

- **Swagger UI**: Navigate to `http://<PI_IP>:8000/docs` for an interactive API explorer
- **ReDoc**: Navigate to `http://<PI_IP>:8000/redoc` for alternative documentation format

## Web Interface Integration

The web interface (`http://<PI_IP>:3550`) automatically connects to the relay API and provides the easiest way to interact with MeticAI. It handles all API calls internally and provides a user-friendly interface.

### Example: Polling for Updates in Web Apps

```javascript
// Example: Check for updates every hour
setInterval(async () => {
  const response = await fetch('http://YOUR_PI_IP:8000/status');
  const data = await response.json();
  
  if (data.update_available) {
    // Show notification to user
    showUpdateNotification('Updates available for MeticAI!');
  }
}, 3600000); // 1 hour
```

## Troubleshooting

**Connection Failed:**
- Verify the server is running: `docker ps`
- Check firewall settings
- Ensure you're on the same network
- Test with: `curl http://<PI_IP>:8000/docs`

**Invalid Response:**
- Check the endpoint URL
- Verify HTTP method (POST vs GET)
- Ensure form field names are correct and case-sensitive
- Review server logs: See [LOGGING.md](LOGGING.md) for details
  ```bash
  tail -f logs/meticai-server-errors.log | jq .
  # Or via API:
  curl "http://<PI_IP>:8000/api/logs?level=ERROR&lines=100"
  ```
