"""System management endpoints."""
from fastapi import APIRouter, Request, HTTPException
from typing import Optional
from pathlib import Path
from datetime import datetime, timezone, timedelta
import json
import asyncio
import socket
import subprocess
import logging
import os
import re
import tempfile

from services.settings_service import load_settings, save_settings

router = APIRouter()
logger = logging.getLogger(__name__)

# Data directory configuration
TEST_MODE = os.environ.get("TEST_MODE") == "true"
if TEST_MODE:
    DATA_DIR = Path(tempfile.gettempdir()) / "meticai_test_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
else:
    DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))

# Regex pattern for extracting version from pyproject.toml or setup.py
VERSION_PATTERN = re.compile(r'^\s*version\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)

# Changelog cache
_changelog_cache: Optional[dict] = None
_changelog_cache_time: Optional[datetime] = None
CHANGELOG_CACHE_DURATION = timedelta(hours=1)  # Cache for 1 hour


@router.post("/api/check-updates")
async def check_updates(request: Request):
    """Trigger a fresh update check by signaling the host-side watcher.
    
    This endpoint creates a flag file that the host-side watcher script detects
    and runs the actual git fetch. Since git operations can't run properly inside
    the container (no access to sub-repo .git directories), we delegate to the host.
    
    Returns:
        - update_available: Whether updates are available for any component
        - last_check: Timestamp of this check
        - repositories: Status of each repository (main, mcp, web)
        - fresh_check: True if this was a fresh check
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Triggering fresh update check via host signal",
            extra={"request_id": request_id, "endpoint": "/api/check-updates"}
        )
        
        # Get the current timestamp from .versions.json before signaling
        version_file_path = Path("/app/.versions.json")
        old_check_time = None
        if version_file_path.exists():
            try:
                with open(version_file_path, 'r') as f:
                    old_data = json.load(f)
                    old_check_time = old_data.get("last_check")
            except Exception:
                # Ignore errors reading old version file (may not exist or be corrupted)
                pass
        
        # Create signal file for host-side watcher
        signal_path = Path("/app/.update-check-requested")
        signal_path.write_text(f"requested_at: {datetime.now(timezone.utc).isoformat()}\n")
        
        logger.info(
            "Update check signal created, waiting for host to process",
            extra={"request_id": request_id}
        )
        
        # Wait for host to process the signal (poll for up to 30 seconds)
        max_wait = 30
        poll_interval = 0.5
        waited = 0
        
        while waited < max_wait:
            await asyncio.sleep(poll_interval)
            waited += poll_interval
            
            # Check if signal file was removed (host processed it)
            if not signal_path.exists():
                break
            
            # Check if .versions.json was updated
            if version_file_path.exists():
                try:
                    with open(version_file_path, 'r') as f:
                        current_data = json.load(f)
                        new_check_time = current_data.get("last_check")
                        if new_check_time and new_check_time != old_check_time:
                            # Versions file was updated
                            break
                except Exception:
                    # Ignore errors polling version file (may be being written or temporarily unavailable)
                    pass
        
        # Clean up signal file if it still exists
        try:
            signal_path.unlink(missing_ok=True)
        except Exception:
            # Ignore errors during cleanup (file may already be deleted or have permission issues)
            pass
        
        # Read the versions file
        if version_file_path.exists():
            with open(version_file_path, 'r') as f:
                version_data = json.load(f)
                new_check_time = version_data.get("last_check")
                was_updated = new_check_time != old_check_time
                
                return {
                    "update_available": version_data.get("update_available", False),
                    "last_check": new_check_time,
                    "repositories": version_data.get("repositories", {}),
                    "fresh_check": was_updated
                }
        else:
            return {
                "update_available": False,
                "error": "Version file not found",
                "message": "No version information available"
            }
            
    except Exception as e:
        logger.error(
            f"Failed to check for updates: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        return {
            "update_available": False,
            "error": str(e),
            "message": "Failed to check for updates"
        }


@router.get("/api/status")
async def get_status(request: Request):
    """Get system status including update availability.
    
    Returns:
        - update_available: Whether updates are available for any component
        - last_check: Timestamp of last update check
        - repositories: Status of each repository (main, mcp, web)
    
    Note: This reads from .versions.json which is populated by the update.sh
    script running on the host. The file is mounted into the container.
    Run './update.sh --check-only' on the host to refresh update status.
    """
    request_id = request.state.request_id
    
    try:
        logger.debug("Checking system status", extra={"request_id": request_id})
        
        # Read version file directly (mounted from host)
        # The file is updated by update.sh --check-only running on the host
        version_file_path = Path("/app/.versions.json")
        update_status = {
            "update_available": False,
            "last_check": None,
            "repositories": {}
        }
        
        if version_file_path.exists():
            with open(version_file_path, 'r') as f:
                version_data = json.load(f)
                # Read update_available directly from file (new format)
                update_status["update_available"] = version_data.get("update_available", False)
                update_status["last_check"] = version_data.get("last_check")
                update_status["repositories"] = version_data.get("repositories", {})
        else:
            # File doesn't exist yet - suggest running update check
            update_status["message"] = "Version file not found. Run './update.sh --check-only' on the host to check for updates."
            logger.warning(
                "Version file not found",
                extra={"request_id": request_id, "version_file": str(version_file_path)}
            )
        
        return update_status
        
    except Exception as e:
        logger.error(
            f"Failed to read system status: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "endpoint": "/status",
                "error_type": type(e).__name__
            }
        )
        return {
            "update_available": False,
            "error": str(e),
            "message": "Could not read update status"
        }


@router.get("/api/watcher-status")
async def get_watcher_status(request: Request):
    """Get the status of the host rebuild-watcher service.
    
    The watcher is considered active if:
    1. The log file exists and was modified recently, OR
    2. The signal file was processed (log is newer than signal)
    
    Returns:
        - running: Whether the watcher appears to be running
        - last_activity: Timestamp of last watcher activity
        - message: Human-readable status message
    """
    request_id = request.state.request_id
    
    try:
        from datetime import datetime, timezone
        
        log_file = Path("/app/.rebuild-watcher.log")
        restart_signal = Path("/app/.restart-requested")
        
        status = {
            "running": False,
            "last_activity": None,
            "message": "Watcher status unknown"
        }
        
        # Check 1: Log file exists and has recent activity
        if log_file.exists():
            log_mtime = os.path.getmtime(log_file)
            log_time = datetime.fromtimestamp(log_mtime, tz=timezone.utc)
            now = datetime.now(timezone.utc)
            age_seconds = (now - log_time).total_seconds()
            
            status["last_activity"] = log_time.isoformat()
            
            # If log was modified in the last 10 minutes, watcher is likely active
            if age_seconds < 600:  # 10 minutes
                status["running"] = True
                status["message"] = f"Watcher active (last activity {int(age_seconds)}s ago)"
            else:
                # Check the restart signal file's mtime vs log mtime
                # If signal is newer than log, watcher might not be running
                if restart_signal.exists():
                    signal_mtime = os.path.getmtime(restart_signal)
                    if signal_mtime > log_mtime + 10:  # Signal newer by >10s
                        status["running"] = False
                        status["message"] = "Watcher may not be running (signal not processed)"
                    else:
                        status["running"] = True
                        status["message"] = f"Watcher idle (last activity {int(age_seconds/60)}m ago)"
                else:
                    status["running"] = True
                    status["message"] = f"Watcher idle (last activity {int(age_seconds/60)}m ago)"
        else:
            # No log file - check if this is a fresh install
            if restart_signal.exists():
                status["running"] = False
                status["message"] = "Watcher not installed or not running"
            else:
                status["message"] = "Unable to determine watcher status"
        
        logger.debug(
            f"Watcher status: {status}",
            extra={"request_id": request_id}
        )
        
        return status
        
    except Exception as e:
        logger.error(
            f"Failed to check watcher status: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        return {
            "running": False,
            "last_activity": None,
            "error": str(e),
            "message": "Failed to check watcher status"
        }


@router.get("/api/update-method")
async def get_update_method(request: Request):
    """Detect how MeticAI updates are managed.
    
    Checks whether Watchtower is running (automatic Docker image updates)
    or whether the host-side watcher/manual approach is used.
    
    Returns:
        - method: "watchtower" | "watcher" | "manual"
        - watchtower_running: bool
        - watcher_running: bool
        - can_trigger_update: bool
    """
    request_id = request.state.request_id
    
    try:
        watchtower_running = False
        watcher_running = False
        
        # Check for Watchtower: try to reach its HTTP API on port 8080
        # or detect the container via docker socket
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                # Watchtower in the compose stack listens on 8080
                resp = await client.get("http://localhost:8080/v1/update", timeout=2.0)
                # Any response (even 401) means watchtower is there
                watchtower_running = True
        except Exception:
            # Also check if watchtower container exists via docker
            try:
                result = subprocess.run(
                    ["docker", "ps", "--filter", "name=watchtower", "--format", "{{.Names}}"],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0 and "watchtower" in result.stdout:
                    watchtower_running = True
            except Exception:
                pass
        
        # Check for host-side watcher
        log_file = Path("/app/.rebuild-watcher.log")
        if log_file.exists():
            log_mtime = os.path.getmtime(log_file)
            age_seconds = (datetime.now(timezone.utc) - datetime.fromtimestamp(log_mtime, tz=timezone.utc)).total_seconds()
            if age_seconds < 600:  # Active in last 10 minutes
                watcher_running = True
        
        if watchtower_running:
            method = "watchtower"
        elif watcher_running:
            method = "watcher"
        else:
            method = "manual"
        
        return {
            "method": method,
            "watchtower_running": watchtower_running,
            "watcher_running": watcher_running,
            "can_trigger_update": watchtower_running or watcher_running
        }
    except Exception as e:
        logger.error(
            f"Failed to detect update method: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        return {
            "method": "manual",
            "watchtower_running": False,
            "watcher_running": False,
            "can_trigger_update": False
        }


@router.get("/api/tailscale-status")
async def get_tailscale_status(request: Request):
    """Get Tailscale connection status.
    
    Checks if Tailscale is running and provides status information.
    Works both when Tailscale runs as a sidecar container and when
    it runs natively on the host.
    
    Returns:
        - installed: Whether Tailscale is available
        - connected: Whether Tailscale is connected
        - hostname: Tailscale hostname if connected
        - ip: Tailscale IP if connected
        - auth_key_expired: Whether the auth key has expired
        - login_url: URL to re-authenticate if needed
    """
    request_id = request.state.request_id
    
    try:
        status = {
            "installed": False,
            "connected": False,
            "hostname": None,
            "ip": None,
            "auth_key_expired": False,
            "login_url": None
        }
        
        # Try tailscale status command
        try:
            result = subprocess.run(
                ["tailscale", "status", "--json"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                ts_data = json.loads(result.stdout)
                status["installed"] = True
                
                backend_state = ts_data.get("BackendState", "")
                status["connected"] = backend_state == "Running"
                
                self_info = ts_data.get("Self", {})
                status["hostname"] = self_info.get("HostName")
                
                # Get Tailscale IPs
                ts_ips = self_info.get("TailscaleIPs", [])
                if ts_ips:
                    status["ip"] = ts_ips[0]  # Primary IP
                
                # Check if auth key is expired (NeedsLogin state)
                if backend_state == "NeedsLogin":
                    status["auth_key_expired"] = True
                    status["connected"] = False
                    
                    # Get login URL
                    try:
                        login_result = subprocess.run(
                            ["tailscale", "up", "--json"],
                            capture_output=True, text=True, timeout=5
                        )
                        if login_result.returncode == 0:
                            login_data = json.loads(login_result.stdout)
                            status["login_url"] = login_data.get("AuthURL")
                    except Exception:
                        status["login_url"] = "https://login.tailscale.com/admin/settings/keys"
                        
            elif result.returncode == 1 and "not running" in result.stderr.lower():
                status["installed"] = True
                status["connected"] = False
        except FileNotFoundError:
            # tailscale binary not available
            pass
        except Exception as e:
            logger.debug(f"Tailscale status check failed: {e}", extra={"request_id": request_id})
        
        # If not found natively, try via docker exec on sidecar
        if not status["installed"]:
            try:
                result = subprocess.run(
                    ["docker", "exec", "meticai-tailscale", "tailscale", "status", "--json"],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    ts_data = json.loads(result.stdout)
                    status["installed"] = True
                    backend_state = ts_data.get("BackendState", "")
                    status["connected"] = backend_state == "Running"
                    self_info = ts_data.get("Self", {})
                    status["hostname"] = self_info.get("HostName")
                    ts_ips = self_info.get("TailscaleIPs", [])
                    if ts_ips:
                        status["ip"] = ts_ips[0]
                    if backend_state == "NeedsLogin":
                        status["auth_key_expired"] = True
                        status["connected"] = False
                        status["login_url"] = "https://login.tailscale.com/admin/settings/keys"
            except Exception:
                pass
        
        return status
        
    except Exception as e:
        logger.error(
            f"Failed to check Tailscale status: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        return {
            "installed": False,
            "connected": False,
            "hostname": None,
            "ip": None,
            "auth_key_expired": False,
            "login_url": None,
            "error": str(e)
        }


@router.post("/api/trigger-update")
async def trigger_update(request: Request):
    """Trigger the backend update process by signaling the host.
    
    This endpoint writes a timestamp to /app/.update-requested which is mounted
    from the host. The host's systemd/launchd service (rebuild-watcher) monitors this
    file and runs update.sh --auto when it changes, which pulls updates AND rebuilds.
    
    The update cannot run inside the container because:
    1. Docker mounts create git conflicts (files appear modified)
    2. The container cannot rebuild itself
    
    Returns:
        - status: "success" or "error"
        - message: Description of what happened
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Triggering system update via host signal",
            extra={"request_id": request_id, "endpoint": "/api/trigger-update"}
        )
        
        # Signal the host to perform the full update (git pull + rebuild)
        # This file is watched by systemd/launchd on the host (rebuild-watcher.sh)
        update_signal = Path("/app/.update-requested")
        
        # Write a timestamp to trigger the file change
        import time
        update_signal.write_text(f"update-requested:{time.time()}\n")
        
        logger.info(
            "Update triggered - signaled host via .update-requested",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": "Update triggered. The host will pull updates and restart containers."
        }
    except Exception as e:
        logger.error(
            f"Failed to trigger update: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "error_type": type(e).__name__
            }
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "Failed to signal update"
            }
        )


@router.post("/api/restart")
async def restart_system(request: Request):
    """Restart all MeticAI containers.
    
    This endpoint writes a timestamp to /app/.restart-requested which is mounted
    from the host. The host's systemd/launchd service (rebuild-watcher) monitors this
    file and restarts all containers without pulling updates.
    
    Returns:
        - status: "success" or "error"
        - message: Description of what happened
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Triggering system restart via host signal",
            extra={"request_id": request_id, "endpoint": "/api/restart"}
        )
        
        # Signal the host to restart containers
        # This file is watched by systemd/launchd on the host (rebuild-watcher.sh)
        restart_signal = Path("/app/.restart-requested")
        
        # Write a timestamp to trigger the file change
        import time
        restart_signal.write_text(f"restart-requested:{time.time()}\n")
        
        logger.info(
            "Restart triggered - signaled host via .restart-requested",
            extra={"request_id": request_id}
        )
        
        return {
            "status": "success",
            "message": "Restart triggered. The system will restart momentarily."
        }
    except Exception as e:
        logger.error(
            f"Failed to trigger restart: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "error_type": type(e).__name__
            }
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "Failed to signal restart"
            }
        )


@router.get("/api/logs")
async def get_logs(
    request: Request,
    lines: int = 100,
    level: Optional[str] = None,
    log_type: str = "all"
):
    """Retrieve recent log entries for debugging and diagnostics.
    
    Args:
        lines: Number of lines to retrieve (default: 100, max: 1000)
        level: Filter by log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_type: Type of logs to retrieve - "all" or "errors" (default: "all")
    
    Returns:
        - logs: List of log entries (most recent first)
        - total_lines: Total number of log lines returned
        - log_file: Path to the log file
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Log retrieval requested",
            extra={
                "request_id": request_id,
                "lines": lines,
                "level": level,
                "log_type": log_type
            }
        )
        
        # Limit lines to prevent overwhelming responses
        lines = min(lines, 1000)
        
        # Determine which log file to read
        log_dir = Path("/app/logs")
        if log_type == "errors":
            log_file = log_dir / "meticai-server-errors.log"
        else:
            log_file = log_dir / "meticai-server.log"
        
        if not log_file.exists():
            logger.warning(
                f"Log file not found: {log_file}",
                extra={"request_id": request_id, "log_file": str(log_file)}
            )
            return {
                "logs": [],
                "total_lines": 0,
                "log_file": str(log_file),
                "message": "Log file not found - logging may not be initialized yet"
            }
        
        # Read log file (last N lines)
        with open(log_file, 'r', encoding='utf-8') as f:
            all_lines = f.readlines()
            recent_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        
        # Parse JSON log entries
        log_entries = []
        for line in reversed(recent_lines):  # Most recent first
            try:
                log_entry = json.loads(line.strip())
                
                # Filter by level if specified
                if level and log_entry.get("level") != level.upper():
                    continue
                
                log_entries.append(log_entry)
            except json.JSONDecodeError:
                # Skip malformed lines
                continue
        
        logger.debug(
            f"Retrieved {len(log_entries)} log entries",
            extra={"request_id": request_id, "log_file": str(log_file)}
        )
        
        return {
            "logs": log_entries,
            "total_lines": len(log_entries),
            "log_file": str(log_file),
            "filters": {
                "lines_requested": lines,
                "level": level,
                "log_type": log_type
            }
        }
        
    except Exception as e:
        logger.error(
            f"Failed to retrieve logs: {str(e)}",
            exc_info=True,
            extra={
                "request_id": request_id,
                "error_type": type(e).__name__
            }
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "Failed to retrieve logs"
            }
        )


@router.get("/api/version")
async def get_version_info(request: Request):
    """Get unified version information for MeticAI.
    
    In v2 all components run in a single container, so there is one version.
    """
    request_id = request.state.request_id
    
    try:
        # Read unified version from VERSION file
        version = "unknown"
        version_file = Path(__file__).parent.parent.parent / "VERSION"
        if version_file.exists():
            version = version_file.read_text().strip()
        
        # Try to get git commit hash
        commit = None
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=Path(__file__).parent.parent.parent,
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                commit = result.stdout.strip()
        except Exception:
            pass
        
        return {
            "version": version,
            "commit": commit,
            "repo_url": "https://github.com/hessius/MeticAI"
        }
    except Exception as e:
        logger.error(
            f"Failed to get version info: {str(e)}",
            extra={"request_id": request_id},
            exc_info=True
        )
        return {
            "version": "unknown",
            "commit": None,
            "repo_url": "https://github.com/hessius/MeticAI"
        }


@router.get("/api/network-ip")
async def get_network_ip(request: Request):
    """Auto-detect the server's LAN IP address for cross-device QR codes.

    Uses a UDP socket trick (no data is actually sent) to discover
    the default-route interface address.  Falls back to hostname
    resolution and finally to ``127.0.0.1``.
    """
    request_id = request.state.request_id
    ip = "127.0.0.1"

    try:
        # Preferred: open a UDP socket to a public IP (no traffic sent)
        # This gives us the address of the interface with the default route.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(1)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
    except Exception:
        # Fallback: hostname lookup
        try:
            hostname = socket.gethostname()
            resolved = socket.gethostbyname(hostname)
            if resolved and not resolved.startswith("127."):
                ip = resolved
        except Exception:
            pass

    logger.debug("Network IP detected", extra={"request_id": request_id, "ip": ip})
    return {"ip": ip}


@router.get("/api/changelog")
async def get_changelog(request: Request):
    """Get release notes from GitHub.
    
    Returns cached release notes if available and fresh,
    otherwise fetches from GitHub API and caches the result.
    """
    global _changelog_cache, _changelog_cache_time
    request_id = request.state.request_id
    
    try:
        # Check if we have a valid cache
        now = datetime.now(timezone.utc)
        if _changelog_cache and _changelog_cache_time:
            cache_age = now - _changelog_cache_time
            if cache_age < CHANGELOG_CACHE_DURATION:
                logger.debug(
                    f"Returning cached changelog (age: {cache_age.total_seconds():.0f}s)",
                    extra={"request_id": request_id}
                )
                return _changelog_cache
        
        # Fetch from GitHub API
        import httpx
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.github.com/repos/hessius/MeticAI/releases",
                params={"per_page": 10},
                headers={"Accept": "application/vnd.github.v3+json"},
                timeout=10.0
            )
            
            if response.status_code == 200:
                releases = response.json()
                
                def strip_installation_section(body: str) -> str:
                    """Remove the Installation section from release notes."""
                    if not body:
                        return body
                    # Find where Installation section starts (### Installation or ## Installation)
                    # Match "### Installation" or "## Installation" and everything after until end or next major section
                    pattern = r'\n---\n+### Installation.*$'
                    cleaned = re.sub(pattern, '', body, flags=re.DOTALL | re.IGNORECASE)
                    # Also try without the --- separator
                    pattern2 = r'\n### Installation.*$'
                    cleaned = re.sub(pattern2, '', cleaned, flags=re.DOTALL | re.IGNORECASE)
                    return cleaned.strip()
                
                changelog_data = {
                    "releases": [
                        {
                            "version": release.get("tag_name", ""),
                            "date": release.get("published_at", "")[:10] if release.get("published_at") else "",
                            "body": strip_installation_section(release.get("body", "No release notes available."))
                        }
                        for release in releases
                    ],
                    "cached_at": now.isoformat()
                }
                
                # Update cache
                _changelog_cache = changelog_data
                _changelog_cache_time = now
                
                logger.info(
                    f"Fetched and cached {len(releases)} releases from GitHub",
                    extra={"request_id": request_id}
                )
                
                return changelog_data
            elif response.status_code in (403, 429):
                # Rate limited
                logger.warning(
                    f"GitHub API rate limit reached: {response.status_code}",
                    extra={"request_id": request_id}
                )
                # Return cached data if available, even if stale
                if _changelog_cache:
                    return _changelog_cache
                return {
                    "releases": [],
                    "error": "GitHub API rate limit reached. Please try again later.",
                    "cached_at": None
                }
            else:
                logger.error(
                    f"GitHub API error: {response.status_code}",
                    extra={"request_id": request_id}
                )
                if _changelog_cache:
                    return _changelog_cache
                return {
                    "releases": [],
                    "error": f"Failed to fetch releases (status {response.status_code})",
                    "cached_at": None
                }
                
    except Exception as e:
        logger.error(
            f"Failed to fetch changelog: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        # Return cached data if available
        if _changelog_cache:
            return _changelog_cache
        return {
            "releases": [],
            "error": str(e),
            "cached_at": None
        }


@router.get("/api/settings")
async def get_settings(request: Request):
    """Get current settings.
    
    Returns settings with API key masked for security.
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Fetching settings",
            extra={"request_id": request_id, "endpoint": "/api/settings"}
        )
        
        settings = load_settings()
        
        # Read current values from environment
        env_api_key = os.environ.get("GEMINI_API_KEY", "")
        env_meticulous_ip = os.environ.get("METICULOUS_IP", "")
        env_server_ip = os.environ.get("PI_IP", "")
        
        # Always show API key as stars if set (never expose the actual key)
        if env_api_key:
            # Show stars to indicate a key is configured
            settings["geminiApiKey"] = "*" * min(len(env_api_key), 20)
            settings["geminiApiKeyMasked"] = True
            settings["geminiApiKeyConfigured"] = True
        else:
            settings["geminiApiKeyConfigured"] = False
        
        # Always show current IP values from environment (env takes precedence)
        if env_meticulous_ip:
            settings["meticulousIp"] = env_meticulous_ip
        
        if env_server_ip:
            settings["serverIp"] = env_server_ip
        
        return settings
        
    except Exception as e:
        logger.error(
            f"Failed to fetch settings: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to fetch settings"}
        )


@router.post("/api/settings")
async def save_settings_endpoint(request: Request):
    """Save settings.
    
    Updates the settings.json file and optionally updates the .env file
    for system-level settings (requires container restart to take effect).
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        
        logger.info(
            "Saving settings",
            extra={
                "request_id": request_id,
                "endpoint": "/api/settings",
                "has_api_key": bool(body.get("geminiApiKey")),
                "has_meticulous_ip": bool(body.get("meticulousIp")),
                "has_server_ip": bool(body.get("serverIp")),
                "has_author": bool(body.get("authorName"))
            }
        )
        
        # Load current settings
        current_settings = load_settings()
        
        # Update only provided fields
        if "authorName" in body:
            current_settings["authorName"] = body["authorName"].strip()
        
        # For IP and API key changes, also update .env file
        env_updated = False
        env_path = Path("/app/.env")
        
        # Read current .env content
        env_content = ""
        if env_path.exists():
            env_content = env_path.read_text()
        
        # Handle API key update
        if body.get("geminiApiKey") and not body.get("geminiApiKeyMasked"):
            new_api_key = body["geminiApiKey"].strip()
            if new_api_key and "..." not in new_api_key and "*" not in new_api_key:  # Not a masked value
                current_settings["geminiApiKey"] = new_api_key
                # Update .env file — use re.escape to handle special chars in keys
                if "GEMINI_API_KEY=" in env_content:
                    env_content = re.sub(
                        r'GEMINI_API_KEY=.*',
                        f'GEMINI_API_KEY={re.escape(new_api_key)}',
                        env_content
                    )
                else:
                    env_content += f"\nGEMINI_API_KEY={new_api_key}"
                env_updated = True
        
        # Handle Meticulous IP update
        if body.get("meticulousIp"):
            new_ip = body["meticulousIp"].strip()
            current_settings["meticulousIp"] = new_ip
            if "METICULOUS_IP=" in env_content:
                env_content = re.sub(
                    r'METICULOUS_IP=.*',
                    f'METICULOUS_IP={new_ip}',
                    env_content
                )
            else:
                env_content += f"\nMETICULOUS_IP={new_ip}"
            env_updated = True
        
        # Handle Server IP update
        if body.get("serverIp"):
            new_ip = body["serverIp"].strip()
            current_settings["serverIp"] = new_ip
            if "PI_IP=" in env_content:
                env_content = re.sub(
                    r'PI_IP=.*',
                    f'PI_IP={new_ip}',
                    env_content
                )
            else:
                env_content += f"\nPI_IP={new_ip}"
            env_updated = True
        
        # Save settings to JSON file
        save_settings(current_settings)
        
        # Write .env file if updated (note: may fail if read-only mount)
        if env_updated:
            try:
                env_path.write_text(env_content)
                logger.info("Updated .env file", extra={"request_id": request_id})
            except PermissionError:
                logger.warning(
                    ".env file is read-only, changes saved to settings.json only",
                    extra={"request_id": request_id}
                )
        
        # Hot-reload: update running process environment and restart services
        services_restarted = []
        
        if body.get("meticulousIp"):
            new_ip = body["meticulousIp"].strip()
            os.environ["METICULOUS_IP"] = new_ip
            
            # Reset cached FastAPI Meticulous client
            try:
                from services.meticulous_service import reset_meticulous_api
                reset_meticulous_api()
                services_restarted.append("meticulous_api")
            except Exception as e:
                logger.warning(f"Failed to reset Meticulous API client: {e}",
                             extra={"request_id": request_id})
            
            # Restart MCP server s6 service so it picks up the new IP
            try:
                result = subprocess.run(
                    ["s6-svc", "-r", "/run/service/mcp-server"],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    services_restarted.append("mcp-server")
                    logger.info("Restarted MCP server with new METICULOUS_IP",
                              extra={"request_id": request_id, "new_ip": new_ip})
                else:
                    logger.warning(f"Failed to restart MCP server: {result.stderr}",
                                 extra={"request_id": request_id})
            except Exception as e:
                logger.warning(f"Could not restart MCP server: {e}",
                             extra={"request_id": request_id})
        
        if body.get("geminiApiKey") and not body.get("geminiApiKeyMasked"):
            new_api_key = body["geminiApiKey"].strip()
            if new_api_key and "..." not in new_api_key and "*" not in new_api_key:
                os.environ["GEMINI_API_KEY"] = new_api_key
                # Reset cached vision model so it re-configures with the new key
                try:
                    from services.gemini_service import reset_vision_model
                    reset_vision_model()
                    services_restarted.append("vision_model")
                except Exception as e:
                    logger.warning(f"Failed to reset vision model: {e}",
                                 extra={"request_id": request_id})
                services_restarted.append("gemini_env")
                logger.info("Updated GEMINI_API_KEY in process environment",
                          extra={"request_id": request_id})
        
        return {
            "status": "success",
            "message": "Settings saved successfully",
            "env_updated": env_updated,
            "services_restarted": services_restarted
        }
        
    except Exception as e:
        logger.error(
            f"Failed to save settings: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id, "error_type": type(e).__name__}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e), "message": "Failed to save settings"}
        )
