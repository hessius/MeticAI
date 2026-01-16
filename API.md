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
  "log_file": "/app/logs/coffee-relay.log",
  "filters": {
    "lines_requested": 100,
    "level": null,
    "log_type": "all"
  }
}
```

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
  tail -f logs/coffee-relay-errors.log | jq .
  # Or via API:
  curl "http://<PI_IP>:8000/api/logs?level=ERROR&lines=100"
  ```
