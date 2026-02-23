#!/bin/bash
# ==============================================================================
# MeticAI — Universal Update Script
# ==============================================================================
# This script serves two purposes:
#
# 1. **v2.0 normal updates**: Pulls the latest image and restarts containers.
#    Generated convenience scripts (start.sh, update.sh, etc.) call through to
#    this file so that users always run the canonical update logic.
#
# 2. **v1.x → v2.0 migration bridge**: After a v1.2.0 user's `git pull`
#    replaces the old `update.sh` with this one, subsequent invocations from
#    the host-side rebuild-watcher automatically complete the migration.
#
# Accepted flags (v1.x compat — harmlessly ignored for v2):
#   --auto          Run non-interactively (used by the old rebuild-watcher)
#   --check-only    Only check for updates (no-op in v2; Watchtower handles it)
#
# ==============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ──────────────────────────────────────────────────────────────────────────────
# Parse flags (v1.x compat)
# ──────────────────────────────────────────────────────────────────────────────
AUTO_MODE=false
CHECK_ONLY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --auto)         AUTO_MODE=true; shift ;;
        --check-only)   CHECK_ONLY=true; shift ;;
        *)              shift ;;
    esac
done

# ──────────────────────────────────────────────────────────────────────────────
# --check-only: Write a .versions.json that signals "update available"
# The old v1.x UI reads this file. We always report an update so the user
# is prompted to click "Update" one more time, which triggers the full flow.
# ──────────────────────────────────────────────────────────────────────────────
if $CHECK_ONLY; then
    # If we are already on v2 (container running), no-op
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^meticai$'; then
        # v2 container is running — report no updates (Watchtower handles it)
        cat > "$SCRIPT_DIR/.versions.json" <<'EOF'
{
  "last_check": "now",
  "update_available": false,
  "repositories": {
    "meticai": { "current_version": "2.0.0", "remote_version": "2.0.0", "update_available": false }
  }
}
EOF
        echo "MeticAI v2.0 is running. Watchtower handles updates."
        exit 0
    fi

    # Still on v1.x containers — report update available to prompt migration
    cat > "$SCRIPT_DIR/.versions.json" <<'EOF'
{
  "last_check": "now",
  "update_available": true,
  "repositories": {
    "meticai": { "current_version": "1.2.0", "remote_version": "2.0.0", "update_available": true }
  }
}
EOF
    echo "MeticAI v2.0.0 is available. Click Update to migrate."
    exit 0
fi

# ──────────────────────────────────────────────────────────────────────────────
# Detect if this is a v1.x → v2.0 migration
# ──────────────────────────────────────────────────────────────────────────────
is_v1_migration() {
    # After git pull, tracked v1 files (rebuild-watcher.sh, local-install.sh) are
    # deleted. Check for UNTRACKED artifacts that survive git pull:
    #   - meticulous-source/ and meticai-web/ (cloned sub-repos, untracked)
    #   - .rebuild-needed (signal file, untracked)
    # NOTE: .versions.json is intentionally excluded — --check-only writes it even
    # on v2 installs, which would cause a false-positive migration trigger.
    [[ -d "$SCRIPT_DIR/meticulous-source" ]] && return 0
    [[ -d "$SCRIPT_DIR/meticai-web" ]] && return 0
    [[ -f "$SCRIPT_DIR/.rebuild-needed" ]] && return 0
    # Fallback: check for tracked files (only present before git pull completes)
    [[ -f "$SCRIPT_DIR/rebuild-watcher.sh" ]] && return 0
    [[ -f "$SCRIPT_DIR/local-install.sh" ]] && return 0
    return 1
}

# ──────────────────────────────────────────────────────────────────────────────
# v1.x → v2.0 in-place migration
# ──────────────────────────────────────────────────────────────────────────────
do_v1_migration() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   MeticAI v2.0 — Automatic Migration    ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # --- 1. Preserve existing .env values ------------------------------------
    local OLD_GEMINI_KEY="" OLD_METICULOUS_IP="" OLD_TAILSCALE_KEY=""
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        # shellcheck disable=SC1091
        source "$SCRIPT_DIR/.env" 2>/dev/null || true
        OLD_GEMINI_KEY="${GEMINI_API_KEY:-}"
        OLD_METICULOUS_IP="${METICULOUS_IP:-meticulous.local}"
        OLD_TAILSCALE_KEY="${TAILSCALE_AUTHKEY:-}"
    fi

    # --- 2. Stop all old containers ------------------------------------------
    echo -e "${YELLOW}Stopping old containers...${NC}"
    docker compose down --remove-orphans 2>/dev/null || true
    # Also stop individually-named v1 containers
    for c in meticulous-mcp-server gemini-client coffee-relay meticai-web; do
        docker rm -f "$c" 2>/dev/null || true
    done

    # --- 3. Remove host-side watcher service ---------------------------------
    echo -e "${YELLOW}Removing host-side watcher service...${NC}"
    case "$(uname -s)" in
        Darwin*)
            PLIST="$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
            if [[ -f "$PLIST" ]]; then
                launchctl unload "$PLIST" 2>/dev/null || true
                rm -f "$PLIST"
                echo "  Removed launchd plist"
            fi
            ;;
        Linux*)
            if command -v systemctl &>/dev/null; then
                systemctl --user stop meticai-rebuild-watcher.path 2>/dev/null || true
                systemctl --user disable meticai-rebuild-watcher.path 2>/dev/null || true
                rm -f "$HOME/.config/systemd/user/meticai-rebuild-watcher.path" \
                      "$HOME/.config/systemd/user/meticai-rebuild-watcher.service" 2>/dev/null
                # Also try system-level, but only when root or passwordless sudo is available
                CAN_SYSTEM_SUDO=false
                if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
                    CAN_SYSTEM_SUDO=true
                elif command -v sudo &>/dev/null && sudo -n -v &>/dev/null; then
                    CAN_SYSTEM_SUDO=true
                fi

                if [[ "$CAN_SYSTEM_SUDO" == true ]]; then
                    if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
                        systemctl stop meticai-rebuild-watcher.path || true
                        systemctl disable meticai-rebuild-watcher.path || true
                        rm -f /etc/systemd/system/meticai-rebuild-watcher.path \
                              /etc/systemd/system/meticai-rebuild-watcher.service || true
                        systemctl daemon-reload || true
                    else
                        sudo -n systemctl stop meticai-rebuild-watcher.path || true
                        sudo -n systemctl disable meticai-rebuild-watcher.path || true
                        sudo -n rm -f /etc/systemd/system/meticai-rebuild-watcher.path \
                               /etc/systemd/system/meticai-rebuild-watcher.service || true
                        sudo -n systemctl daemon-reload || true
                    fi
                else
                    echo "  Skipping system-level systemd cleanup (no passwordless sudo or root)."
                fi

                systemctl --user daemon-reload || true
                echo "  Removed systemd units"
            fi
            ;;
    esac

    # --- 4. Clean up v1 signal files & scripts -------------------------------
    echo -e "${YELLOW}Cleaning up v1 artifacts...${NC}"
    for f in .rebuild-needed .update-requested .update-check-requested \
             .restart-requested .rebuild-watcher.log .versions.json \
             .update-config.json check-updates-on-start.sh \
             rebuild-watcher.sh local-install.sh \
             docker-compose.override.yml; do
        rm -f "$SCRIPT_DIR/$f" 2>/dev/null || true
    done

    # --- 5. Write v2 .env file -----------------------------------------------
    echo -e "${YELLOW}Writing v2 configuration...${NC}"
    local COMPOSE_FILES="-f docker-compose.yml"
    local WATCHTOWER_TOKEN
    WATCHTOWER_TOKEN=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p | head -c 32)

    # Respect METICAI_TAG from environment (useful for testing), default to latest
    local TAG="${METICAI_TAG:-latest}"

    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.watchtower.yml"

    if [[ -n "$OLD_TAILSCALE_KEY" ]]; then
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tailscale.yml"
    fi

    cat > "$SCRIPT_DIR/.env" <<EOF
# MeticAI Configuration
# Migrated from v1.x on $(date)

# Required
GEMINI_API_KEY=${OLD_GEMINI_KEY}
METICULOUS_IP=${OLD_METICULOUS_IP}

# Image tag
METICAI_TAG=${TAG}

# Compose files to load
COMPOSE_FILES="${COMPOSE_FILES}"

# Watchtower (automatic updates)
WATCHTOWER_TOKEN=${WATCHTOWER_TOKEN}
EOF

    if [[ -n "$OLD_TAILSCALE_KEY" ]]; then
        echo "TAILSCALE_AUTHKEY=${OLD_TAILSCALE_KEY}" >> "$SCRIPT_DIR/.env"
    fi

    # --- 6. Generate convenience scripts -------------------------------------
    echo -e "${YELLOW}Generating convenience scripts...${NC}"

    cat > "$SCRIPT_DIR/start.sh" << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} up -d
SCRIPT_END
    chmod +x "$SCRIPT_DIR/start.sh"

    cat > "$SCRIPT_DIR/stop.sh" << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down
SCRIPT_END
    chmod +x "$SCRIPT_DIR/stop.sh"

    cat > "$SCRIPT_DIR/uninstall.sh" << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
echo ""
echo "  MeticAI Uninstaller"
echo "  ==================="
echo ""
INSTALL_PATH="$(pwd)"
echo "This will stop MeticAI and remove all files from ${INSTALL_PATH}."
echo ""
read -p "Are you sure? (y/N): " CONFIRM < /dev/tty
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then echo "Cancelled."; exit 0; fi
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down 2>/dev/null || true
read -p "Also remove data volume? (y/N): " REMOVE_DATA < /dev/tty
if [[ "$REMOVE_DATA" =~ ^[Yy]$ ]]; then
    docker volume rm meticai-data mosquitto-data meticai-tailscale-state 2>/dev/null || true
fi
echo "MeticAI has been uninstalled."
echo "To remove the installation directory: rm -rf ${INSTALL_PATH}"
SCRIPT_END
    chmod +x "$SCRIPT_DIR/uninstall.sh"

    # --- 7. Clean up old sub-repos (free disk space) -------------------------
    echo -e "${YELLOW}Cleaning up old source directories...${NC}"
    for d in meticulous-source meticai-web coffee-relay gemini-client; do
        if [[ -d "$SCRIPT_DIR/$d" ]]; then
            rm -rf "$SCRIPT_DIR/$d"
            echo "  Removed $d/"
        fi
    done

    # --- 8. Remove old Docker images -----------------------------------------
    echo -e "${YELLOW}Removing old Docker images...${NC}"
    for img in $(docker images --filter "reference=meticai*" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null); do
        docker rmi "$img" 2>/dev/null || true
    done

    # --- 9. Pull and start v2 ------------------------------------------------
    # Re-source the new .env so COMPOSE_FILES is available
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"

    echo ""
    echo -e "${YELLOW}Pulling MeticAI v2.0 image...${NC}"
    docker compose ${COMPOSE_FILES} pull

    echo -e "${YELLOW}Starting MeticAI v2.0...${NC}"
    docker compose ${COMPOSE_FILES} up -d || {
        # Watchtower may fail to start (port conflict with existing services).
        # If meticai itself is running, that's OK — watchtower is optional.
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^meticai$'; then
            echo -e "${YELLOW}  Note: Watchtower failed to start (port conflict?), but MeticAI is running.${NC}"
            echo "  You can change the Watchtower port in docker-compose.watchtower.yml."
        else
            echo -e "${RED}ERROR: Failed to start MeticAI.${NC}"
            echo "  Check logs: docker compose ${COMPOSE_FILES} logs"
            exit 1
        fi
    }

    # --- 10. Wait for healthy --------------------------------------------------
    echo ""
    echo -e "${YELLOW}Waiting for MeticAI to start...${NC}"
    local attempts=0
    while [[ $attempts -lt 30 ]]; do
        if curl -sf http://localhost:3550/health >/dev/null 2>&1; then
            break
        fi
        sleep 2
        attempts=$((attempts + 1))
    done

    echo ""
    if curl -sf http://localhost:3550/health >/dev/null 2>&1; then
        echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║   Migration complete! MeticAI v2.0 🎉   ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
        echo ""
        echo "  Open http://localhost:3550 in your browser"
        echo ""
        echo "  Watchtower is enabled — future updates are automatic."
        if [[ -n "$OLD_TAILSCALE_KEY" ]]; then
            echo "  Tailscale is enabled for remote access."
        fi
        echo ""
    else
        echo -e "${YELLOW}MeticAI started but health check not yet passing.${NC}"
        echo "  Check logs: docker logs meticai -f"
    fi
}

# ──────────────────────────────────────────────────────────────────────────────
# v2.0 normal update (pull latest image, restart)
# ──────────────────────────────────────────────────────────────────────────────
do_v2_update() {
    # Source .env for COMPOSE_FILES
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        # shellcheck disable=SC1091
        source "$SCRIPT_DIR/.env" 2>/dev/null || true
    fi

    local CF="${COMPOSE_FILES:--f docker-compose.yml}"

    echo -e "${BLUE}Pulling latest MeticAI image...${NC}"
    docker compose ${CF} pull

    echo -e "${BLUE}Restarting...${NC}"
    docker compose ${CF} up -d

    echo -e "${GREEN}Updated!${NC}"
}

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
if is_v1_migration; then
    do_v1_migration
else
    do_v2_update
fi
