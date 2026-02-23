#!/bin/bash
# ==============================================================================
# MeticAI Migration Script (v1 → v2)
# ==============================================================================
# Migrates existing MeticAI v1.x installations to the v2.0 unified container.
#
# Supports three invocation scenarios:
#   1. Manual install — user runs install.sh, it detects v1 and calls this
#   2. Manual update  — user runs ./update.sh from a v1 install
#   3. Automatic/Web  — triggered non-interactively (no tty)
#
# In non-interactive mode (no tty), defaults are applied automatically:
#   - Watchtower is enabled (automatic updates)
#   - Tailscale compose is included (user adds auth key via Settings UI)
#   - Existing .env values (GEMINI_API_KEY, METICULOUS_IP) are preserved
#
# Usage:
#   Interactive:     bash scripts/migrate-to-unified.sh
#   Non-interactive: METICAI_NON_INTERACTIVE=true bash scripts/migrate-to-unified.sh
#   Via curl:        curl -fsSL .../scripts/migrate-to-unified.sh | bash
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${HOME}/MeticAI"
BACKUP_DIR="${INSTALL_DIR}/backup-$(date +%Y%m%d-%H%M%S)"
REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_URL="https://raw.githubusercontent.com/hessius/MeticAI/${REPO_BRANCH}"
if [[ "$REPO_BRANCH" == "main" ]]; then
    METICAI_TAG="${METICAI_TAG:-latest}"
else
    METICAI_TAG="${METICAI_TAG:-$(echo "$REPO_BRANCH" | tr '/' '-')}"
fi

# Detect interactive mode
IS_INTERACTIVE=false
if [[ "$METICAI_NON_INTERACTIVE" != "true" ]] && [[ -t 0 || -e /dev/tty ]]; then
    # Double-check that /dev/tty is actually usable
    if echo "" > /dev/tty 2>/dev/null; then
        IS_INTERACTIVE=true
    fi
fi

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo "☕ MeticAI Migration Tool (v1 → v2)"
echo "====================================="
if [[ "$IS_INTERACTIVE" == "true" ]]; then
    echo "  Mode: interactive"
else
    echo "  Mode: non-interactive (defaults will be applied)"
fi
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if old installation exists
if [[ ! -d "$INSTALL_DIR" ]] && [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    log_warning "No existing MeticAI installation found at $INSTALL_DIR"
    echo "Run the installer instead:"
    echo "  curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash"
    exit 0
fi

# ==============================================================================
# Step 1: Back up existing configuration
# ==============================================================================
log_info "Creating backup..."
mkdir -p "$BACKUP_DIR"

if [[ -f "$INSTALL_DIR/.env" ]]; then
    cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env"
    log_success "Backed up .env"
fi

if [[ -d "$INSTALL_DIR/data" ]]; then
    cp -r "$INSTALL_DIR/data" "$BACKUP_DIR/data"
    log_success "Backed up data/"
fi

# ==============================================================================
# Step 2: Stop and remove old v1 containers
# ==============================================================================
log_info "Stopping old containers..."
if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    cd "$INSTALL_DIR"
    docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
fi

for container in meticai-server meticai-web meticulous-mcp gemini-client coffee-relay; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        log_info "Stopping container: $container"
        docker stop "$container" 2>/dev/null || true
        docker rm "$container" 2>/dev/null || true
    fi
done
log_success "Old containers stopped"

# ==============================================================================
# Step 3: Remove old watcher services
# ==============================================================================
log_info "Removing old watcher services..."

# macOS: launchd plist
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
if [[ -f "$LAUNCHD_PLIST" ]]; then
    launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
    rm -f "$LAUNCHD_PLIST"
    log_success "Removed macOS launchd watcher service"
fi

# Linux: systemd path + service units
if command -v systemctl &> /dev/null; then
    if systemctl list-unit-files meticai-rebuild-watcher.path &> /dev/null; then
        sudo systemctl stop meticai-rebuild-watcher.path 2>/dev/null || true
        sudo systemctl stop meticai-rebuild-watcher.service 2>/dev/null || true
        sudo systemctl disable meticai-rebuild-watcher.path 2>/dev/null || true
        sudo systemctl disable meticai-rebuild-watcher.service 2>/dev/null || true
        sudo rm -f /etc/systemd/system/meticai-rebuild-watcher.path
        sudo rm -f /etc/systemd/system/meticai-rebuild-watcher.service
        sudo systemctl daemon-reload 2>/dev/null || true
        log_success "Removed systemd watcher services"
    fi
fi

# ==============================================================================
# Step 4: Clean up v1 signal files and scripts
# ==============================================================================
for sigfile in .rebuild-needed .update-requested .update-check-requested .restart-requested .rebuild-watcher.log .versions.json; do
    rm -f "$INSTALL_DIR/$sigfile" 2>/dev/null || true
done

# Remove old v1 scripts (will be replaced with new convenience scripts)
for oldscript in rebuild-watcher.sh local-install.sh; do
    rm -f "$INSTALL_DIR/$oldscript" 2>/dev/null || true
done
log_success "Cleaned up old watcher artifacts and v1 scripts"

# ==============================================================================
# Step 5: Download new v2 compose files
# ==============================================================================
cd "$INSTALL_DIR"

log_info "Downloading compose files..."
curl -fsSL "${REPO_URL}/docker-compose.yml" -o docker-compose.yml

HAS_TAILSCALE_COMPOSE=false
if curl -fsSL "${REPO_URL}/docker-compose.tailscale.yml" -o docker-compose.tailscale.yml 2>/dev/null; then
    HAS_TAILSCALE_COMPOSE=true
fi

HAS_WATCHTOWER_COMPOSE=false
if curl -fsSL "${REPO_URL}/docker-compose.watchtower.yml" -o docker-compose.watchtower.yml 2>/dev/null; then
    HAS_WATCHTOWER_COMPOSE=true
fi

curl -fsSL "${REPO_URL}/tailscale-serve.json" -o tailscale-serve.json 2>/dev/null || true
mkdir -p docker
curl -fsSL "${REPO_URL}/docker/mosquitto-external.conf" -o docker/mosquitto-external.conf 2>/dev/null || true

log_success "Compose files downloaded"

# ==============================================================================
# Step 6: Configure .env and optional services
# ==============================================================================

# Source existing .env to get current values
GEMINI_API_KEY=""
METICULOUS_IP=""
TAILSCALE_AUTHKEY=""
if [[ -f "$BACKUP_DIR/.env" ]]; then
    source "$BACKUP_DIR/.env" 2>/dev/null || true
fi

# --- Gemini API Key ---
if [[ -z "$GEMINI_API_KEY" ]]; then
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        echo "Get your API key from: https://aistudio.google.com/app/apikey"
        read -p "Gemini API Key: " GEMINI_API_KEY < /dev/tty
    else
        log_warning "No GEMINI_API_KEY found — configure it via the Settings UI after migration"
    fi
fi

# --- Meticulous IP ---
if [[ -z "$METICULOUS_IP" ]]; then
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -p "Meticulous IP [meticulous.local]: " METICULOUS_IP < /dev/tty
    fi
    METICULOUS_IP=${METICULOUS_IP:-meticulous.local}
fi

# --- Optional services ---
COMPOSE_FILES="-f docker-compose.yml"

# Tailscale
if [[ "$HAS_TAILSCALE_COMPOSE" == "true" ]]; then
    ENABLE_TAILSCALE="y"  # default for non-interactive
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -p "Enable Tailscale for remote access? (Y/n): " ENABLE_TAILSCALE < /dev/tty
        ENABLE_TAILSCALE=${ENABLE_TAILSCALE:-y}
    fi
    if [[ "$ENABLE_TAILSCALE" =~ ^[Yy]$ ]]; then
        if [[ -z "$TAILSCALE_AUTHKEY" ]] && [[ "$IS_INTERACTIVE" == "true" ]]; then
            echo "Get an auth key from: https://login.tailscale.com/admin/settings/keys"
            read -p "Tailscale Auth Key (or Enter to skip): " TAILSCALE_AUTHKEY < /dev/tty
        fi
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tailscale.yml"
        if [[ -n "$TAILSCALE_AUTHKEY" ]]; then
            log_success "Tailscale enabled (auth key configured)"
        else
            log_success "Tailscale enabled (add auth key via Settings UI)"
        fi
    else
        log_info "Tailscale: skipped"
    fi
fi

# Watchtower
if [[ "$HAS_WATCHTOWER_COMPOSE" == "true" ]]; then
    ENABLE_WATCHTOWER="y"  # default for non-interactive
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -p "Enable Watchtower for automatic updates? (Y/n): " ENABLE_WATCHTOWER < /dev/tty
        ENABLE_WATCHTOWER=${ENABLE_WATCHTOWER:-y}
    fi
    if [[ "$ENABLE_WATCHTOWER" =~ ^[Yy]$ ]]; then
        WATCHTOWER_TOKEN=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.watchtower.yml"
        log_success "Watchtower enabled (automatic updates)"
    else
        log_info "Watchtower: skipped"
    fi
fi

# --- Write .env ---
log_info "Writing configuration..."

cat > .env << ENVEOF
# MeticAI Configuration
# Migrated from v1 on $(date)

# Required
GEMINI_API_KEY=${GEMINI_API_KEY}
METICULOUS_IP=${METICULOUS_IP}

# Image tag
METICAI_TAG=${METICAI_TAG}

# Compose files to load
COMPOSE_FILES="${COMPOSE_FILES}"
ENVEOF

[[ -n "$TAILSCALE_AUTHKEY" ]] && echo "TAILSCALE_AUTHKEY=${TAILSCALE_AUTHKEY}" >> .env
[[ -n "$WATCHTOWER_TOKEN" ]] && echo "WATCHTOWER_TOKEN=${WATCHTOWER_TOKEN}" >> .env

log_success "Configuration saved"

# ==============================================================================
# Step 7: Generate convenience scripts
# ==============================================================================

cat > start.sh << 'SCRIPTEND'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} up -d
SCRIPTEND
chmod +x start.sh

cat > stop.sh << 'SCRIPTEND'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down
SCRIPTEND
chmod +x stop.sh

cat > update.sh << 'SCRIPTEND'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
echo "Pulling latest MeticAI image..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} pull
echo "Restarting..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} up -d
echo "Updated!"
SCRIPTEND
chmod +x update.sh

cat > uninstall.sh << 'SCRIPTEND'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
echo ""
echo "  MeticAI Uninstaller"
echo "  ==================="
echo ""
INSTALL_PATH="$(pwd)"
echo "This will stop MeticAI and remove all files from ${INSTALL_PATH}."
echo "Your data (profiles, history) is stored in a Docker volume and will be preserved."
echo ""
read -p "Are you sure? (y/N): " CONFIRM < /dev/tty
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi
echo ""
echo "Stopping containers..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down 2>/dev/null || true
read -p "Also remove data volume (profiles, history, settings)? (y/N): " REMOVE_DATA < /dev/tty
if [[ "$REMOVE_DATA" =~ ^[Yy]$ ]]; then
    docker volume rm meticai-data 2>/dev/null || true
    docker volume rm mosquitto-data 2>/dev/null || true
    docker volume rm meticai-tailscale-state 2>/dev/null || true
    echo "Data volumes removed"
fi
read -p "Also remove the MeticAI Docker image? (y/N): " REMOVE_IMAGE < /dev/tty
if [[ "$REMOVE_IMAGE" =~ ^[Yy]$ ]]; then
    docker rmi "ghcr.io/hessius/meticai:${METICAI_TAG:-latest}" 2>/dev/null || true
    echo "Image removed"
fi
if [[ -d "/Applications/MeticAI.app" ]]; then
    echo "Removing macOS app shortcut..."
    rm -rf "/Applications/MeticAI.app" 2>/dev/null || sudo rm -rf "/Applications/MeticAI.app" 2>/dev/null || true
fi
echo ""
echo "MeticAI has been uninstalled."
echo "To remove the installation directory: rm -rf ${INSTALL_PATH}"
echo ""
SCRIPTEND
chmod +x uninstall.sh

log_success "Generated: start.sh, stop.sh, update.sh, uninstall.sh"

# ==============================================================================
# Step 8: Migrate data to Docker volume
# ==============================================================================
log_info "Migrating data to Docker volume..."
docker volume create meticai-data 2>/dev/null || true

if [[ -d "$INSTALL_DIR/data" ]]; then
    docker run --rm -v meticai-data:/data -v "$INSTALL_DIR/data":/backup alpine sh -c "cp -r /backup/* /data/ 2>/dev/null || true"
    log_success "Data migrated to Docker volume"
fi

# ==============================================================================
# Step 9: Pull and start the unified container
# ==============================================================================
log_info "Pulling MeticAI unified image..."
docker compose ${COMPOSE_FILES} pull 2>&1 || true

log_info "Starting MeticAI..."
docker compose ${COMPOSE_FILES} up -d 2>&1 || true

log_info "Waiting for services to start..."
sleep 10

if docker compose ${COMPOSE_FILES} ps 2>/dev/null | grep -qi "running\|healthy\|up"; then
    log_success "MeticAI is running!"
else
    log_warning "Container may still be starting. Check with: docker compose logs -f"
fi

# ==============================================================================
# Step 10: Clean up old Docker images
# ==============================================================================
log_info "Cleaning up old Docker images..."
for img in meticai-server meticai-web meticulous-mcp gemini-client coffee-relay; do
    docker image rm "$img" 2>/dev/null || true
done
docker image prune -f 2>/dev/null || true
log_success "Old images cleaned up"

# ==============================================================================
# Done!
# ==============================================================================
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "======================================"
echo "✅ Migration Complete!"
echo "======================================"
echo ""
echo "Access MeticAI at: http://${IP}:3550"
echo ""
echo "Backup saved to: $BACKUP_DIR"
echo ""
echo "Useful commands:"
echo "  cd ~/MeticAI"
echo "  ./start.sh        Start MeticAI"
echo "  ./stop.sh         Stop MeticAI"
echo "  ./update.sh       Pull latest image & restart"
echo "  ./uninstall.sh    Remove MeticAI"
echo "  docker compose logs -f   View live logs"
echo ""
if [[ -z "$GEMINI_API_KEY" ]]; then
    echo "⚠️  Don't forget to add your Gemini API key in Settings!"
    echo ""
fi
if [[ -z "$TAILSCALE_AUTHKEY" ]] && echo "$COMPOSE_FILES" | grep -q tailscale; then
    echo "⚠️  Tailscale is enabled but needs an auth key."
    echo "   Add it via the Settings UI or:"
    echo "   echo 'TAILSCALE_AUTHKEY=tskey-...' >> ~/MeticAI/.env && ./start.sh"
    echo ""
fi
echo "☕ Enjoy your coffee!"
