# 📊 MeticAI Logging System

## Overview

MeticAI includes a comprehensive, actionable logging system that captures detailed information for effective debugging and troubleshooting. All errors, requests, and system events are logged with full context to help diagnose issues quickly.

## Features

- ✅ **Structured JSON logging** - Easy to parse and analyze programmatically
- ✅ **Automatic log rotation** - Prevents disk space issues with size and count limits
- ✅ **Request correlation IDs** - Track requests across the system
- ✅ **Detailed error context** - Full stack traces, timestamps, and user information
- ✅ **Multiple log levels** - DEBUG, INFO, WARNING, ERROR, CRITICAL
- ✅ **Separate error logs** - Quick access to errors without wading through info logs
- ✅ **HTTP endpoint for log retrieval** - Programmatic access to recent logs

## Log File Locations

Logs are stored in the `logs/` directory in the MeticAI installation directory:

```
MeticAI/
├── logs/
│   ├── meticai-server.log           # All log entries (JSON format)
│   ├── meticai-server.log.1         # Rotated backup (newest)
│   ├── meticai-server.log.2         # Rotated backup
│   ├── meticai-server.log.3         # Rotated backup
│   ├── meticai-server.log.4         # Rotated backup
│   ├── meticai-server.log.5         # Rotated backup (oldest)
│   ├── meticai-server-errors.log    # Error-only logs (JSON format)
│   ├── meticai-server-errors.log.1  # Error log backups...
│   └── ...
```

## Log Retention Policy

- **Maximum file size**: 10 MB per log file
- **Backup count**: 5 backup files kept
- **Total storage**: Up to 60 MB of logs (10 MB × 6 files per log type)
- **Rotation**: Automatic when file size limit is reached
- **Format**: JSON (one log entry per line)

## What Gets Logged

### Request Information
Each HTTP request logs:
- **Timestamp** - When the request occurred (UTC)
- **Request ID** - Unique correlation ID for tracking
- **Endpoint** - Which API endpoint was called
- **Method** - HTTP method (GET, POST, etc.)
- **Client IP** - IP address of the requester
- **User Agent** - Browser/client information
- **Duration** - How long the request took (milliseconds)
- **Status Code** - HTTP response code

### Error Information
Errors include all request info plus:
- **Error Type** - Exception class name
- **Error Message** - Detailed error description
- **Stack Trace** - Full traceback for debugging
- **Context** - What the user was doing when it failed

### Example Log Entry

```json
{
  "timestamp": "2024-01-16T20:15:30.123456Z",
  "level": "ERROR",
  "logger": "meticai-server",
  "message": "Coffee analysis failed: Rate limit exceeded",
  "module": "main",
  "function": "analyze_coffee",
  "line": 221,
  "request_id": "a3f2d1e9-5c8b-4f1a-9d3e-2a7b6c8d9e0f",
  "endpoint": "/analyze_coffee",
  "client_ip": "192.168.1.100",
  "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  "duration_ms": 1250,
  "error_type": "RateLimitError",
  "exception": {
    "type": "RateLimitError",
    "message": "Rate limit exceeded for Gemini API",
    "traceback": ["  File \"/app/main.py\", line 215, in analyze_coffee", "..."]
  }
}
```

## Retrieving Logs

### Method 1: Direct File Access

SSH into your MeticAI server and read log files directly:

```bash
# View recent logs (human-readable)
tail -f logs/meticai-server.log | jq .

# View only errors
tail -f logs/meticai-server-errors.log | jq .

# Search for specific request
grep "a3f2d1e9-5c8b-4f1a-9d3e" logs/meticai-server.log | jq .

# Filter by level
jq 'select(.level == "ERROR")' logs/meticai-server.log
```

### Method 2: HTTP API Endpoint

Retrieve logs programmatically via the `/api/logs` endpoint:

```bash
# Get last 100 log entries
curl http://YOUR_SERVER_IP:8000/api/logs

# Get last 500 entries
curl "http://YOUR_SERVER_IP:8000/api/logs?lines=500"

# Get only ERROR level logs
curl "http://YOUR_SERVER_IP:8000/api/logs?level=ERROR"

# Get error-only log file
curl "http://YOUR_SERVER_IP:8000/api/logs?log_type=errors"

# Combine filters
curl "http://YOUR_SERVER_IP:8000/api/logs?lines=200&level=ERROR&log_type=errors"
```

**Response Format:**
```json
{
  "logs": [
    {
      "timestamp": "2024-01-16T20:15:30.123456Z",
      "level": "ERROR",
      "message": "...",
      "request_id": "...",
      ...
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

### Method 3: Web Interface (Future)

The meticai-web interface will include a log viewer in a future update.

## Collecting Logs from Users

When users report issues, you can collect logs in several ways:

### Option 1: Ask users to run a command

```bash
# On the MeticAI server
cd ~/MeticAI  # or wherever MeticAI is installed
tar -czf meticai-logs-$(date +%Y%m%d-%H%M%S).tar.gz logs/
```

Then have them send you the `meticai-logs-*.tar.gz` file.

### Option 2: Use the API remotely

If you have access to the user's MeticAI instance:

```bash
# Save recent error logs
curl "http://USER_IP:8000/api/logs?log_type=errors&lines=1000" > user-errors.json

# Save all recent logs
curl "http://USER_IP:8000/api/logs?lines=1000" > user-logs.json
```

### Option 3: Create a diagnostic script

Save this as `collect-logs.sh` in the MeticAI directory:

```bash
#!/bin/bash
# Collect MeticAI diagnostic information

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_FILE="meticai-diagnostics-${TIMESTAMP}.tar.gz"

echo "Collecting MeticAI diagnostics..."

# Create temp directory
mkdir -p /tmp/meticai-diagnostics

# Copy logs
cp -r logs/ /tmp/meticai-diagnostics/

# Get system info
echo "=== Docker Containers ===" > /tmp/meticai-diagnostics/system-info.txt
docker ps -a >> /tmp/meticai-diagnostics/system-info.txt

echo -e "\n=== Docker Images ===" >> /tmp/meticai-diagnostics/system-info.txt
docker images >> /tmp/meticai-diagnostics/system-info.txt

echo -e "\n=== MeticAI Version ===" >> /tmp/meticai-diagnostics/system-info.txt
cat .versions.json >> /tmp/meticai-diagnostics/system-info.txt 2>&1 || echo "No version file"

# Get recent API logs via endpoint
curl -s "http://localhost:8000/api/logs?lines=500" > /tmp/meticai-diagnostics/recent-api-logs.json 2>&1

# Create archive
cd /tmp
tar -czf "${OUTPUT_FILE}" meticai-diagnostics/
mv "${OUTPUT_FILE}" ~/

# Cleanup
rm -rf /tmp/meticai-diagnostics

echo "✓ Diagnostics saved to: ~/${OUTPUT_FILE}"
```

Make it executable: `chmod +x collect-logs.sh`

## Troubleshooting Common Issues

### Logs not being created

**Symptom**: No log files in `logs/` directory

**Solutions**:
1. Check that the logs directory mount exists in docker-compose.yml
2. Restart the meticai-server container: `docker restart meticai-server`
3. Check container logs: `docker logs meticai-server`
4. Verify directory permissions: `ls -la logs/`

### Log files too large

**Symptom**: Log files growing beyond expected size

**Solution**: Log rotation should handle this automatically. If not:
1. Check that log rotation is configured (should be by default)
2. Manually rotate: `mv logs/meticai-server.log logs/meticai-server.log.old`
3. Restart container: `docker restart meticai-server`

### Cannot access /api/logs endpoint

**Symptom**: 404 or 500 error when accessing logs endpoint

**Solutions**:
1. Ensure you're using the correct URL: `http://YOUR_IP:8000/api/logs`
2. Check that meticai-server container is running: `docker ps | grep meticai-server`
3. Check container logs for errors: `docker logs meticai-server`

### Missing request context

**Symptom**: Log entries missing request_id or other context

**Solution**: This is expected for startup logs. Only HTTP requests have request IDs. System startup and background tasks use generic logging.

## Log Levels

Understanding what each log level means:

- **DEBUG**: Detailed information for diagnosing problems (disabled in production)
- **INFO**: General informational messages (request started, completed, etc.)
- **WARNING**: Something unexpected but not critical (missing file, deprecated feature)
- **ERROR**: An error occurred but the service is still running
- **CRITICAL**: Severe error that may cause service failure

## Configuration

Log settings can be adjusted via environment variables (add to `.env` file):

```bash
# Log directory (default: /app/logs)
LOG_DIR=/custom/log/path

# Log level (default: INFO)
# Options: DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_LEVEL=DEBUG
```

Then restart containers:
```bash
docker-compose down
docker-compose up -d
```

## Best Practices

1. **Regular monitoring**: Check error logs periodically
   ```bash
   tail -f logs/meticai-server-errors.log | jq .
   ```

2. **Archive old logs**: Before major updates, back up logs
   ```bash
   tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/
   ```

3. **Search efficiently**: Use `jq` for JSON filtering
   ```bash
   # Find all rate limit errors
   jq 'select(.message | contains("rate limit"))' logs/meticai-server.log
   
   # Find slow requests (> 5 seconds)
   jq 'select(.duration_ms > 5000)' logs/meticai-server.log
   ```

4. **Track specific users**: Use request IDs to follow a user's journey
   ```bash
   REQUEST_ID="a3f2d1e9-5c8b-4f1a-9d3e-2a7b6c8d9e0f"
   grep "$REQUEST_ID" logs/meticai-server.log | jq .
   ```

## Privacy Considerations

The logging system captures:
- ✅ IP addresses (for debugging network issues)
- ✅ User agents (for compatibility testing)
- ✅ Timestamps (for incident correlation)
- ❌ Coffee bag images (not logged, only referenced)
- ❌ User credentials (never logged)
- ❌ API keys (never logged)

All logs are stored locally on your server and are not transmitted anywhere.

## Integration with meticai-web

The meticai-web frontend logs to the browser console. To integrate those logs with the backend logging:

1. Frontend errors are reported to the backend via API calls
2. The backend logs these with the original context
3. Both frontend and backend logs share the same request ID for correlation

This integration is automatic when using the web interface.

## Support

If you need help with logs:
1. Check this documentation
2. Review the [Troubleshooting](#troubleshooting-common-issues) section
3. Open an issue on GitHub with relevant log excerpts (redact sensitive info!)

---

**Remember**: Logs are your friend! When reporting issues, always include recent error logs.
