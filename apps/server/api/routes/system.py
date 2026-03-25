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


@router.get("/api/health")
async def health_check():
    """Health check endpoint for Docker and load balancer probes."""
    return {"status": "ok"}


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


# Cached update status (avoid hammering the GitHub API)
_update_cache: Optional[dict] = None
_update_cache_time: Optional[datetime] = None
UPDATE_CACHE_DURATION = timedelta(minutes=15)

GITHUB_RELEASES_URL = "https://api.github.com/repos/hessius/MeticAI/releases/latest"
GITHUB_ALL_RELEASES_URL = "https://api.github.com/repos/hessius/MeticAI/releases"
WATCHTOWER_API_ENDPOINTS = (
    "http://watchtower:8080/v1/update",
    "http://meticai-watchtower:8080/v1/update",
    "http://localhost:18088/v1/update",
    "http://localhost:8088/v1/update",
)

WATCHTOWER_REACHABLE_STATUS_CODES = {200, 204, 401, 403, 404, 405}
WATCHTOWER_TRIGGERABLE_STATUS_CODES = {200, 204}


async def _probe_watchtower_api(method: str = "get") -> dict:
    """Probe known Watchtower API endpoints.

    Sends an Authorization header when the ``WATCHTOWER_TOKEN`` env-var is
    set so that the probe (and trigger) succeeds on token-protected instances.

    Returns:
        {
            "reachable": bool,
            "can_trigger": bool,
            "endpoint": str | None,
            "status_code": int | None,
            "error": str | None,
        }
    """
    import httpx

    token = os.environ.get("WATCHTOWER_TOKEN", "").strip()
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    errors: list[str] = []

    async def _probe_one(client: httpx.AsyncClient, endpoint: str) -> dict:
        timeout = 3.0 if method == "post" else 2.0
        try:
            if method == "post":
                response = await client.post(endpoint, timeout=timeout, headers=headers)
            else:
                response = await client.get(endpoint, timeout=timeout, headers=headers)

            status_code = response.status_code
            return {
                "endpoint": endpoint,
                "status_code": status_code,
                "reachable": status_code in WATCHTOWER_REACHABLE_STATUS_CODES,
                "can_trigger": status_code in WATCHTOWER_TRIGGERABLE_STATUS_CODES,
                "error": None,
            }
        except Exception as exc:
            return {
                "endpoint": endpoint,
                "status_code": None,
                "reachable": False,
                "can_trigger": False,
                "error": f"{endpoint}: {exc}",
            }

    async with httpx.AsyncClient() as client:
        tasks = [asyncio.create_task(_probe_one(client, endpoint)) for endpoint in WATCHTOWER_API_ENDPOINTS]
        try:
            for completed in asyncio.as_completed(tasks):
                result = await completed
                if result["reachable"]:
                    for task in tasks:
                        if not task.done():
                            task.cancel()
                    return {
                        "reachable": True,
                        "can_trigger": result["can_trigger"],
                        "endpoint": result["endpoint"],
                        "status_code": result["status_code"],
                        "error": None,
                    }
                if result["error"]:
                    errors.append(result["error"])
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    return {
        "reachable": False,
        "can_trigger": False,
        "endpoint": None,
        "status_code": None,
        "error": "; ".join(errors) if errors else "Watchtower API not reachable",
    }


def _get_running_version() -> str:
    """Read the version baked into the container image."""
    version_file = Path(__file__).parent.parent.parent / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    return "unknown"


def _version_tuple(v: str):
    """Parse a semver string like '2.0.0' into a tuple for comparison."""
    v = v.lstrip("v")
    parts = v.split("-")[0].split(".")  # strip pre-release suffixes
    try:
        return tuple(int(p) for p in parts)
    except (ValueError, TypeError):
        return (0, 0, 0)


def _is_prerelease_version(v: str) -> bool:
    """Check if a version string has a pre-release tag (beta, alpha, rc)."""
    v = v.lstrip("v")
    return any(tag in v.lower() for tag in ["-beta", "-alpha", "-rc"])


async def _fetch_latest_release() -> dict:
    """Query GitHub Releases API for the latest published version.

    Fetches all recent releases to determine the latest stable and beta
    versions separately, enabling cross-channel notifications.
    """
    global _update_cache, _update_cache_time
    
    now = datetime.now(timezone.utc)
    if (_update_cache is not None
            and _update_cache_time is not None
            and (now - _update_cache_time) < UPDATE_CACHE_DURATION):
        return _update_cache
    
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                GITHUB_ALL_RELEASES_URL,
                params={"per_page": 30},
                headers={"Accept": "application/vnd.github+json"},
                timeout=10.0,
            )
            if resp.status_code == 200:
                releases = resp.json()
                running_version = _get_running_version()

                # Find the latest stable and beta releases
                latest_stable_version = None
                latest_beta_version = None
                latest_release_url = None

                for release in releases:
                    tag = release.get("tag_name", "").lstrip("v")
                    if not tag:
                        continue
                    is_pre = release.get("prerelease", False) or _is_prerelease_version(tag)
                    if is_pre:
                        if latest_beta_version is None:
                            latest_beta_version = tag
                    else:
                        if latest_stable_version is None:
                            latest_stable_version = tag
                            latest_release_url = release.get("html_url")
                    if latest_stable_version and latest_beta_version:
                        break

                # Primary update_available uses the latest stable release
                # (matches the previous /releases/latest behaviour)
                latest_version = latest_stable_version or ""
                update_available = (
                    latest_version != ""
                    and running_version != "unknown"
                    and _version_tuple(latest_version) > _version_tuple(running_version)
                )

                result = {
                    "update_available": update_available,
                    "latest_version": latest_version,
                    "current_version": running_version,
                    "last_check": now.isoformat(),
                    "release_url": latest_release_url,
                    "latest_stable_version": latest_stable_version,
                    "latest_beta_version": latest_beta_version,
                }
                _update_cache = result
                _update_cache_time = now
                return result
    except Exception as e:
        logger.debug(f"Failed to query GitHub releases: {e}")
    
    # Return stale cache if available, otherwise a safe fallback
    if _update_cache is not None:
        return _update_cache
    return {
        "update_available": False,
        "current_version": _get_running_version(),
        "latest_version": None,
        "last_check": None,
        "latest_stable_version": None,
        "latest_beta_version": None,
        "error": "Could not reach GitHub API",
    }


@router.post("/api/check-updates")
async def check_updates(request: Request):
    """Trigger a fresh update check against the GitHub Releases API.
    
    Queries the latest published release on GitHub and compares it to
    the version baked into the running container image.
    
    Returns:
        - update_available: Whether a newer version exists
        - current_version: Version running in this container
        - latest_version: Latest version on GitHub
        - last_check: Timestamp of this check
        - fresh_check: Always True for this endpoint
    """
    request_id = request.state.request_id
    
    try:
        global _update_cache, _update_cache_time
        # Bust the cache so we get a fresh result
        _update_cache = None
        _update_cache_time = None
        
        logger.info(
            "Checking for updates via GitHub Releases API",
            extra={"request_id": request_id, "endpoint": "/api/check-updates"}
        )
        
        result = await _fetch_latest_release()
        result["fresh_check"] = True
        return result
        
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
    
    Returns cached update information (refreshed every 15 minutes) comparing
    the running container version to the latest GitHub release.
    
    Returns:
        - update_available: Whether a newer version exists
        - current_version: Version running in this container
        - latest_version: Latest version on GitHub (if known)
        - last_check: Timestamp of last update check
    """
    request_id = request.state.request_id
    
    try:
        logger.debug("Checking system status", extra={"request_id": request_id})
        return await _fetch_latest_release()
        
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


@router.get("/api/update-method")
async def get_update_method(request: Request):
    """Detect how MeticAI updates are managed.
    
    Checks whether Watchtower is running (automatic Docker image updates)
    or whether updates must be applied manually.
    
    Returns:
        - method: "watchtower" | "manual"
        - watchtower_running: bool
        - can_trigger_update: bool
        - watchtower_endpoint: str | None — the reachable Watchtower API endpoint URL, or None
        - watchtower_error: str | None — error message if the probe failed or container reported an error
    """
    request_id = request.state.request_id
    
    try:
        probe = await _probe_watchtower_api(method="get")
        watchtower_running = probe["reachable"]
        can_trigger_update = probe["can_trigger"]
        watchtower_error = probe["error"]

        if not watchtower_running:
            try:
                result = subprocess.run(
                    ["docker", "inspect", "--format", "{{.State.Status}}|{{.State.Error}}", "meticai-watchtower"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    state_parts = result.stdout.strip().split("|", 1)
                    state_status = state_parts[0].strip() if state_parts else ""
                    state_error = state_parts[1].strip() if len(state_parts) > 1 else ""
                    watchtower_running = state_status == "running"
                    if state_error:
                        watchtower_error = state_error
            except Exception:
                pass

        method = "watchtower" if watchtower_running else "manual"

        return {
            "method": method,
            "watchtower_running": watchtower_running,
            "can_trigger_update": can_trigger_update,
            "watchtower_endpoint": probe["endpoint"],
            "watchtower_error": watchtower_error,
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
            "can_trigger_update": False
        }


@router.get("/api/tailscale-status")
async def get_tailscale_status(request: Request):
    """Get Tailscale connection status and configuration.
    
    Checks if Tailscale is running and provides status information.
    Also returns the user's Tailscale configuration preferences from settings.
    Works both when Tailscale runs as a sidecar container and when
    it runs natively on the host.
    
    Returns:
        - enabled: Whether user has enabled Tailscale in settings
        - auth_key_configured: Whether an auth key is saved
        - installed: Whether Tailscale is available/running
        - connected: Whether Tailscale is connected
        - hostname: Tailscale hostname if connected
        - ip: Tailscale IP if connected
        - auth_key_expired: Whether the auth key has expired
        - login_url: URL to re-authenticate if needed
    """
    request_id = request.state.request_id
    
    try:
        # Load user config from settings
        from services.settings_service import load_settings
        stored_settings = load_settings()
        settings = dict(stored_settings)
        ts_enabled = settings.get("tailscaleEnabled", False)
        ts_auth_key = settings.get("tailscaleAuthKey", "")
        # Also check env var fallback
        if not ts_auth_key:
            ts_auth_key = os.environ.get("TAILSCALE_AUTHKEY", "")
        
        status = {
            "enabled": ts_enabled,
            "auth_key_configured": bool(ts_auth_key),
            "installed": False,
            "connected": False,
            "hostname": None,
            "dns_name": None,
            "ip": None,
            "external_url": None,
            "auth_key_expired": False,
            "login_url": None
        }
        
        def _parse_ts_status(ts_data: dict) -> None:
            """Fill status dict from tailscale status JSON."""
            status["installed"] = True
            backend_state = ts_data.get("BackendState", "")
            status["connected"] = backend_state == "Running"
            self_info = ts_data.get("Self", {})
            status["hostname"] = self_info.get("HostName")
            dns_name = self_info.get("DNSName", "")
            if dns_name:
                status["dns_name"] = dns_name.rstrip(".")
                status["external_url"] = f"https://{status['dns_name']}"
            ts_ips = self_info.get("TailscaleIPs", [])
            if ts_ips:
                status["ip"] = ts_ips[0]
            if backend_state == "NeedsLogin":
                status["auth_key_expired"] = True
                status["connected"] = False
                status["login_url"] = "https://login.tailscale.com/admin/settings/keys"
        
        # Strategy 1: native tailscale binary (host install)
        try:
            result = subprocess.run(
                ["tailscale", "status", "--json"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                _parse_ts_status(json.loads(result.stdout))
            elif result.returncode == 1 and "not running" in result.stderr.lower():
                status["installed"] = True
                status["connected"] = False
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.debug(f"Tailscale status check failed: {e}", extra={"request_id": request_id})
        
        # Strategy 2: shared Tailscale socket (sidecar with volume mount)
        if not status["installed"]:
            ts_socket = "/var/run/tailscale/tailscaled.sock"
            if os.path.exists(ts_socket):
                try:
                    result = subprocess.run(
                        ["curl", "-sf", "--unix-socket", ts_socket,
                         "http://local-tailscaled.sock/localapi/v0/status"],
                        capture_output=True, text=True, timeout=5
                    )
                    if result.returncode == 0:
                        _parse_ts_status(json.loads(result.stdout))
                except Exception as e:
                    logger.debug(f"Tailscale socket check failed: {e}", extra={"request_id": request_id})
        
        # Strategy 3: docker exec on sidecar container
        if not status["installed"]:
            try:
                result = subprocess.run(
                    ["docker", "exec", "meticai-tailscale", "tailscale", "status", "--json"],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    _parse_ts_status(json.loads(result.stdout))
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
            "enabled": False,
            "auth_key_configured": False,
            "installed": False,
            "connected": False,
            "hostname": None,
            "dns_name": None,
            "ip": None,
            "external_url": None,
            "auth_key_expired": False,
            "login_url": None,
            "error": str(e)
        }


@router.post("/api/tailscale/configure")
async def configure_tailscale(request: Request):
    """Configure Tailscale remote access settings.
    
    Saves Tailscale preferences (enabled state and auth key) to settings.
    When enabled/disabled or auth key is changed, updates the .env file
    and COMPOSE_FILES variable, then signals a restart so the host
    picks up the new compose configuration.
    
    Body:
        - enabled: bool — Whether Tailscale should be active
        - authKey: str (optional) — Tailscale auth key
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        
        from services.settings_service import load_settings, save_settings
        current_settings = load_settings()
        
        changed = False
        compose_changed = False
        
        # Handle enabled toggle
        if "enabled" in body:
            new_enabled = bool(body["enabled"])
            old_enabled = current_settings.get("tailscaleEnabled", False)
            current_settings["tailscaleEnabled"] = new_enabled
            changed = True
            if new_enabled != old_enabled:
                compose_changed = True
        
        # Handle auth key update
        if "authKey" in body:
            new_key = body["authKey"].strip() if body["authKey"] else ""
            # Don't save masked values
            if new_key and "*" not in new_key and "..." not in new_key:
                current_settings["tailscaleAuthKey"] = new_key
                changed = True
            elif not new_key:
                current_settings["tailscaleAuthKey"] = ""
                changed = True
        
        if not changed:
            return {"status": "success", "message": "No changes to apply"}
        
        # Save to settings.json (persisted on /data volume)
        save_settings(current_settings)
        
        # Update .env file for compose-level changes
        env_path = Path("/app/.env")
        env_content = ""
        if env_path.exists():
            env_content = env_path.read_text()
        
        env_updated = False
        ts_enabled = current_settings.get("tailscaleEnabled", False)
        ts_auth_key = current_settings.get("tailscaleAuthKey", "")
        
        # Update TAILSCALE_AUTHKEY in .env
        if ts_auth_key:
            if "TAILSCALE_AUTHKEY=" in env_content:
                env_content = re.sub(
                    r'TAILSCALE_AUTHKEY=.*',
                    f'TAILSCALE_AUTHKEY={ts_auth_key}',
                    env_content
                )
            else:
                env_content += f"\nTAILSCALE_AUTHKEY={ts_auth_key}"
            env_updated = True
        
        # Update COMPOSE_FILES to add/remove tailscale overlay
        if compose_changed:
            compose_match = re.search(r'COMPOSE_FILES="([^"]*)"', env_content)
            if compose_match:
                current_compose = compose_match.group(1)
            else:
                current_compose = "-f docker-compose.yml"
            
            ts_flag = "-f docker-compose.tailscale.yml"
            
            if ts_enabled and ts_flag not in current_compose:
                current_compose = f"{current_compose} {ts_flag}"
            elif not ts_enabled and ts_flag in current_compose:
                current_compose = current_compose.replace(f" {ts_flag}", "").replace(ts_flag, "")
                current_compose = current_compose.strip()
            
            if 'COMPOSE_FILES=' in env_content:
                env_content = re.sub(
                    r'COMPOSE_FILES="[^"]*"',
                    f'COMPOSE_FILES="{current_compose}"',
                    env_content
                )
            else:
                env_content += f'\nCOMPOSE_FILES="{current_compose}"'
            env_updated = True
        
        if env_updated:
            try:
                env_path.write_text(env_content)
                logger.info("Updated .env with Tailscale config",
                           extra={"request_id": request_id})
            except (PermissionError, FileNotFoundError, OSError) as e:
                logger.warning(
                    f".env file not writable ({type(e).__name__}), "
                    "Tailscale config saved to settings.json only",
                    extra={"request_id": request_id}
                )
        
        # Signal restart if compose config changed (needs container recreation)
        restart_signaled = False
        if compose_changed:
            try:
                import signal as sig
                
                async def _deferred_restart():
                    """Wait briefly then kill PID 1 for restart."""
                    await asyncio.sleep(2.0)
                    try:
                        os.kill(1, sig.SIGTERM)
                    except ProcessLookupError:
                        pass
                
                asyncio.get_running_loop().create_task(_deferred_restart())
                restart_signaled = True
                logger.info("Scheduled container restart for Tailscale config change",
                           extra={"request_id": request_id})
            except Exception as e:
                logger.warning(f"Could not schedule restart: {e}",
                             extra={"request_id": request_id})
        
        action = "enabled" if ts_enabled else "disabled"
        logger.info(
            f"Tailscale configuration updated: {action}",
            extra={
                "request_id": request_id,
                "tailscale_enabled": ts_enabled,
                "auth_key_configured": bool(ts_auth_key),
                "compose_changed": compose_changed,
                "restart_signaled": restart_signaled
            }
        )
        
        return {
            "status": "success",
            "message": f"Tailscale {action}",
            "enabled": ts_enabled,
            "auth_key_configured": bool(ts_auth_key),
            "restart_required": compose_changed,
            "restart_signaled": restart_signaled
        }
        
    except Exception as e:
        logger.error(
            f"Failed to configure Tailscale: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "error": str(e),
                "message": "Failed to configure Tailscale"
            }
        )


@router.post("/api/trigger-update")
async def trigger_update(request: Request):
    """Trigger an immediate update check via Watchtower.
    
    Calls Watchtower's HTTP API to request an immediate image-update check.
    If Watchtower is not running, returns an error indicating manual update
    is required.
    
    Returns:
        - status: "success" or "error"
        - message: Description of what happened
    """
    request_id = request.state.request_id
    
    try:
        logger.info(
            "Triggering update via Watchtower HTTP API",
            extra={"request_id": request_id, "endpoint": "/api/trigger-update"}
        )

        probe = await _probe_watchtower_api(method="post")

        if probe["can_trigger"]:
            logger.info(
                "Update triggered via Watchtower",
                extra={
                    "request_id": request_id,
                    "endpoint": probe["endpoint"],
                    "status_code": probe["status_code"],
                }
            )
            return {
                "status": "success",
                "message": "Update triggered. Watchtower will pull the latest image and restart the container."
            }

        if probe["reachable"]:
            raise HTTPException(
                status_code=503,
                detail={
                    "status": "error",
                    "error": f"Watchtower endpoint reachable but update not authorized (HTTP {probe['status_code']})",
                    "message": "Automatic updates are available, but this Watchtower endpoint rejected the trigger request."
                }
            )
        
        # No Watchtower — manual update required
        raise HTTPException(
            status_code=503,
            detail={
                "status": "error",
                "error": "Watchtower not available",
                "message": "Automatic updates require Watchtower. Update manually with: docker compose pull && docker compose up -d"
            }
        )
    except HTTPException:
        raise
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
                "message": "Failed to trigger update"
            }
        )


@router.post("/api/restart")
async def restart_system(request: Request):
    """Restart the MeticAI container.
    
    Sends SIGTERM to PID 1 (s6-overlay init) after a short delay to allow
    the HTTP response to be sent. Docker's ``restart: unless-stopped`` policy
    will automatically bring the container back up.
    
    Returns:
        - status: "success" or "error"
        - message: Description of what happened
    """
    request_id = request.state.request_id
    
    try:
        import signal
        
        logger.info(
            "Triggering container restart via SIGTERM to PID 1",
            extra={"request_id": request_id, "endpoint": "/api/restart"}
        )
        
        async def _kill_pid1():
            """Wait briefly for the HTTP response to flush, then kill PID 1."""
            await asyncio.sleep(1.5)
            logger.info("Sending SIGTERM to PID 1 (s6-overlay) for restart")
            try:
                os.kill(1, signal.SIGTERM)
            except ProcessLookupError:
                # In test/dev environments PID 1 may not be s6
                logger.warning("PID 1 not found — not running inside container?")
        
        # Schedule the kill in the background so the response can be sent first
        asyncio.get_running_loop().create_task(_kill_pid1())
        
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
                "message": "Failed to trigger restart"
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
        
        # Read log file (last N lines) — use deque for memory-efficient tail
        from collections import deque
        with open(log_file, 'r', encoding='utf-8') as f:
            recent_lines = deque(f, maxlen=lines)
        
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
    Includes beta channel status from settings.
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
        
        # Determine if this is a beta version (contains -beta, -alpha, or -rc)
        is_beta_version = any(suffix in version.lower() for suffix in ['-beta', '-alpha', '-rc'])
        
        # Get beta channel preference from settings
        settings = load_settings()
        beta_channel = settings.get("betaChannel", False)
        
        return {
            "version": version,
            "commit": commit,
            "repo_url": "https://github.com/hessius/MeticAI",
            "is_beta_version": is_beta_version,
            "beta_channel_enabled": beta_channel,
            "channel": "beta" if beta_channel else "stable"
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
            "repo_url": "https://github.com/hessius/MeticAI",
            "is_beta_version": False,
            "beta_channel_enabled": False,
            "channel": "stable"
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
        
        stored_settings = load_settings()
        settings = dict(stored_settings)
        
        # Read current values from environment
        env_api_key = os.environ.get("GEMINI_API_KEY", "")
        env_meticulous_ip = os.environ.get("METICULOUS_IP", "")
        env_server_ip = os.environ.get("PI_IP", "")
        
        stored_api_key = str(stored_settings.get("geminiApiKey", "") or "").strip()
        effective_api_key = env_api_key.strip() or stored_api_key

        # Always show API key as stars if set (never expose the actual key)
        if effective_api_key:
            settings["geminiApiKey"] = "*" * min(len(effective_api_key), 20)
            settings["geminiApiKeyMasked"] = True
            settings["geminiApiKeyConfigured"] = True
        else:
            settings["geminiApiKey"] = ""
            settings["geminiApiKeyMasked"] = False
            settings["geminiApiKeyConfigured"] = False
        
        # Always show current IP values from environment (env takes precedence)
        if env_meticulous_ip:
            settings["meticulousIp"] = env_meticulous_ip
        
        if env_server_ip:
            settings["serverIp"] = env_server_ip
        
        # MQTT enabled flag (env var takes precedence over stored setting)
        mqtt_env = os.environ.get("MQTT_ENABLED", "")
        if mqtt_env:
            settings["mqttEnabled"] = mqtt_env.lower() == "true"
        elif "mqttEnabled" not in settings:
            settings["mqttEnabled"] = True

        # Gemini model (env var takes precedence over stored setting)
        gemini_model_env = os.environ.get("GEMINI_MODEL", "").strip()
        if gemini_model_env:
            settings["geminiModel"] = gemini_model_env
        elif "geminiModel" not in settings:
            settings["geminiModel"] = "gemini-2.5-flash"
        
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


def _update_s6_env(var_name: str, value: str, request_id: str = "") -> None:
    """Write an env var to the s6 container environment directory.

    Delegates to the shared ``utils.s6_env.update_s6_env`` implementation.
    """
    from utils.s6_env import update_s6_env
    update_s6_env(var_name, value, request_id=request_id)


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

        # Boolean preference fields
        for bool_key in ("autoSync", "autoSyncAiDescription"):
            if bool_key in body:
                current_settings[bool_key] = bool(body[bool_key])

        # Gemini model selection
        if "geminiModel" in body:
            model_value = str(body["geminiModel"]).strip()
            current_settings["geminiModel"] = model_value if model_value else "gemini-2.5-flash"
        
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
        
        # Save settings to JSON file.
        # Strip display-only keys that should never be persisted.
        for _display_key in ("geminiApiKeyConfigured", "geminiApiKeyMasked"):
            current_settings.pop(_display_key, None)
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
            
            # Write to s6 container environment so restarted services pick it up.
            # s6-overlay services using `with-contenv` read from this directory,
            # NOT from the FastAPI process environment.
            _update_s6_env("METICULOUS_IP", new_ip, request_id)
            
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
            
            # Also restart the bridge (it needs the new IP for Socket.IO)
            try:
                from services.bridge_service import restart_bridge_service
                if restart_bridge_service():
                    services_restarted.append("meticulous-bridge")
            except Exception as e:
                logger.warning(f"Could not restart bridge: {e}",
                             extra={"request_id": request_id})
        
        if body.get("geminiApiKey") and not body.get("geminiApiKeyMasked"):
            new_api_key = body["geminiApiKey"].strip()
            if new_api_key and "..." not in new_api_key and "*" not in new_api_key:
                os.environ["GEMINI_API_KEY"] = new_api_key
                _update_s6_env("GEMINI_API_KEY", new_api_key, request_id)
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
        
        # Handle MQTT enabled toggle
        if "mqttEnabled" in body:
            mqtt_enabled = bool(body["mqttEnabled"])
            current_settings["mqttEnabled"] = mqtt_enabled
            os.environ["MQTT_ENABLED"] = str(mqtt_enabled).lower()
            
            # Update .env file
            if "MQTT_ENABLED=" in env_content:
                env_content = re.sub(
                    r'MQTT_ENABLED=.*',
                    f'MQTT_ENABLED={str(mqtt_enabled).lower()}',
                    env_content
                )
            else:
                env_content += f"\nMQTT_ENABLED={str(mqtt_enabled).lower()}"
            env_updated = True
            
            # Restart bridge and reset MQTT subscriber
            try:
                from services.bridge_service import restart_bridge_service
                restart_bridge_service()
                services_restarted.append("meticulous-bridge")
            except Exception as e:
                logger.warning(f"Failed to restart bridge: {e}",
                             extra={"request_id": request_id})
            
            try:
                from services.mqtt_service import reset_mqtt_subscriber, get_mqtt_subscriber
                reset_mqtt_subscriber()
                if mqtt_enabled:
                    import asyncio
                    sub = get_mqtt_subscriber()
                    sub.start(asyncio.get_running_loop())
                services_restarted.append("mqtt_subscriber")
            except Exception as e:
                logger.warning(f"Failed to reset MQTT subscriber: {e}",
                             extra={"request_id": request_id})
            
            logger.info("MQTT enabled=%s", mqtt_enabled,
                       extra={"request_id": request_id})
        
        # Hot-reload Gemini model into process environment
        if "geminiModel" in body:
            new_model = str(body["geminiModel"]).strip()
            if new_model:
                os.environ["GEMINI_MODEL"] = new_model
                _update_s6_env("GEMINI_MODEL", new_model, request_id)
                services_restarted.append("gemini_model")
                logger.info("Updated GEMINI_MODEL to %s", new_model,
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


@router.post("/api/beta-channel")
async def switch_beta_channel(request: Request):
    """Switch between beta and stable update channels.
    
    Updates the betaChannel setting and optionally creates a docker-compose override
    to pull from the beta tag instead of latest.
    
    Request body:
        enabled (bool): Whether to enable beta channel
    
    Returns:
        status: success/error
        channel: Current channel after switch ("beta" or "stable")
        message: Informational message
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        enabled = body.get("enabled", False)
        
        logger.info(
            f"Switching beta channel: enabled={enabled}",
            extra={"request_id": request_id}
        )
        
        # Update settings
        current_settings = load_settings()
        current_settings["betaChannel"] = enabled
        save_settings(current_settings)
        
        # Create or update docker-compose override for image tag
        override_path = Path("/app/docker-compose.channel.yml")
        compose_updated = False
        
        try:
            if enabled:
                # Create override to use beta tag
                override_content = """# Auto-generated by MeticAI beta channel switch
# DO NOT EDIT - this file is managed automatically
version: '3.8'
services:
  meticai:
    image: ghcr.io/hessius/meticai:beta
"""
                override_path.write_text(override_content)
                compose_updated = True
                logger.info("Created docker-compose.channel.yml for beta tag",
                           extra={"request_id": request_id})
            else:
                # Remove override to use latest (default)
                if override_path.exists():
                    override_path.unlink()
                    compose_updated = True
                    logger.info("Removed docker-compose.channel.yml, reverting to latest",
                               extra={"request_id": request_id})
        except PermissionError:
            logger.warning(
                "Cannot modify docker-compose override - filesystem may be read-only",
                extra={"request_id": request_id}
            )
        except Exception as e:
            logger.warning(
                f"Failed to update docker-compose override: {e}",
                extra={"request_id": request_id}
            )
        
        channel = "beta" if enabled else "stable"
        
        return {
            "status": "success",
            "channel": channel,
            "compose_updated": compose_updated,
            "message": f"Switched to {channel} channel. " + (
                "Watchtower will pull the next beta update automatically." if enabled
                else "Watchtower will pull from the stable channel."
            ) + (" Container restart may be required for changes to take effect." if compose_updated else "")
        }
        
    except Exception as e:
        logger.error(
            f"Failed to switch beta channel: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )


@router.post("/api/feedback")
async def send_feedback(request: Request):
    """Submit beta feedback to create a GitHub issue.
    
    Request body:
        type (str): Feedback type - "bug", "feature", "question", or "general"
        title (str): Short summary of the feedback
        description (str): Detailed description
        include_logs (bool, optional): Whether to include recent server logs
    
    Returns:
        status: success/error
        issue_url: URL to the created GitHub issue (if successful)
        message: Informational message
    
    Note: This creates an issue via the GitHub API. Requires the GITHUB_TOKEN
    environment variable to be set, or falls back to returning a pre-filled
    issue URL that the user can open manually.
    """
    request_id = request.state.request_id
    
    try:
        body = await request.json()
        feedback_type = body.get("type", "general")
        title = body.get("title", "").strip()
        description = body.get("description", "").strip()
        include_logs = body.get("include_logs", False)
        
        if not title or not description:
            raise HTTPException(
                status_code=400,
                detail={"error": "Title and description are required"}
            )
        
        # Get version info for context
        version = "unknown"
        version_file = Path(__file__).parent.parent.parent / "VERSION"
        if version_file.exists():
            version = version_file.read_text().strip()
        
        # Check if running beta
        settings = load_settings()
        is_beta = settings.get("betaChannel", False)
        
        # Build issue body
        issue_body_parts = [
            f"## Feedback Type\n{feedback_type.capitalize()}",
            f"\n## Description\n{description}",
            f"\n## Environment",
            f"- **Version**: {version}",
            f"- **Channel**: {'Beta' if is_beta else 'Stable'}",
        ]
        
        # Include recent logs if requested
        if include_logs:
            try:
                # Get last 50 lines of logs
                import subprocess
                result = subprocess.run(
                    ["journalctl", "-u", "meticai", "-n", "50", "--no-pager"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    issue_body_parts.append(
                        f"\n## Recent Logs\n```\n{result.stdout[:2000]}\n```"
                    )
            except Exception:
                pass  # Skip logs if unavailable
        
        issue_body = "\n".join(issue_body_parts)
        
        # Add labels based on type
        labels = ["beta-feedback"]
        if feedback_type == "bug":
            labels.append("bug")
        elif feedback_type == "feature":
            labels.append("enhancement")
        
        # Try to create issue via GitHub API
        github_token = os.environ.get("GITHUB_TOKEN")
        
        if github_token:
            import httpx
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        "https://api.github.com/repos/hessius/MeticAI/issues",
                        headers={
                            "Authorization": f"Bearer {github_token}",
                            "Accept": "application/vnd.github+json",
                            "X-GitHub-Api-Version": "2022-11-28"
                        },
                        json={
                            "title": f"[{feedback_type.upper()}] {title}",
                            "body": issue_body,
                            "labels": labels
                        },
                        timeout=30.0
                    )
                    
                    if response.status_code == 201:
                        issue_data = response.json()
                        logger.info(
                            f"Created GitHub issue #{issue_data.get('number')}",
                            extra={"request_id": request_id}
                        )
                        return {
                            "status": "success",
                            "issue_url": issue_data.get("html_url"),
                            "issue_number": issue_data.get("number"),
                            "message": "Feedback submitted successfully!"
                        }
                    else:
                        logger.warning(
                            f"GitHub API returned {response.status_code}: {response.text}",
                            extra={"request_id": request_id}
                        )
            except Exception as e:
                logger.warning(
                    f"Failed to create GitHub issue: {e}",
                    extra={"request_id": request_id}
                )
        
        # Fallback: return a URL for manual issue creation
        import urllib.parse
        params = urllib.parse.urlencode({
            "title": f"[{feedback_type.upper()}] {title}",
            "body": issue_body,
            "labels": ",".join(labels)
        })
        manual_url = f"https://github.com/hessius/MeticAI/issues/new?{params}"
        
        return {
            "status": "manual",
            "issue_url": manual_url,
            "message": "Please click the link to submit your feedback on GitHub."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to submit feedback: {str(e)}",
            exc_info=True,
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "error": str(e)}
        )
