#!/bin/bash
# ==============================================================================
# MeticAI Migration Script
# ==============================================================================
# Migrates existing MeticAI installations to the unified container architecture.
#
# This script:
# 1. Backs up existing configuration
# 2. Stops and removes old containers
# 3. Migrates data to the new volume structure
# 4. Downloads new compose file
# 5. Starts the unified container
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/migrate-to-unified.sh | bash
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${HOME}/.meticai"
BACKUP_DIR="${INSTALL_DIR}/backup-$(date +%Y%m%d-%H%M%S)"
OLD_METICAI_DIR="${HOME}/MeticAI"

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo "☕ MeticAI Migration Tool"
echo "========================="
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if old installation exists
if [[ ! -d "$OLD_METICAI_DIR" ]] && [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    log_warning "No existing MeticAI installation found."
    echo "Run the installer instead:"
    echo "  curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash"
    exit 0
fi

# Create backup directory
log_info "Creating backup directory..."
mkdir -p "$BACKUP_DIR"

# Backup existing .env
if [[ -f "$OLD_METICAI_DIR/.env" ]]; then
    log_info "Backing up .env file..."
    cp "$OLD_METICAI_DIR/.env" "$BACKUP_DIR/.env"
    log_success "Backed up to $BACKUP_DIR/.env"
fi

if [[ -f "${INSTALL_DIR}/.env" ]]; then
    log_info "Backing up existing .env..."
    cp "${INSTALL_DIR}/.env" "$BACKUP_DIR/.env.meticai"
fi

# Backup data directory
if [[ -d "$OLD_METICAI_DIR/data" ]]; then
    log_info "Backing up data directory..."
    cp -r "$OLD_METICAI_DIR/data" "$BACKUP_DIR/data"
    log_success "Backed up data to $BACKUP_DIR/data"
fi

# Stop old containers
log_info "Stopping old containers..."
if [[ -f "$OLD_METICAI_DIR/docker-compose.yml" ]]; then
    cd "$OLD_METICAI_DIR"
    docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
fi

# Also stop by container names (in case compose file changed)
for container in meticai-server meticai-web meticulous-mcp gemini-client coffee-relay; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        log_info "Stopping container: $container"
        docker stop "$container" 2>/dev/null || true
        docker rm "$container" 2>/dev/null || true
    fi
done

log_success "Old containers stopped"

# Create new installation directory
log_info "Setting up new installation directory..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Extract configuration from backup
if [[ -f "$BACKUP_DIR/.env" ]]; then
    log_info "Extracting configuration from backup..."
    
    # Source the old .env to get values
    source "$BACKUP_DIR/.env"
    
    # Create new .env with extracted values
    cat > .env << EOF
# MeticAI Configuration (migrated from old installation)
GEMINI_API_KEY=${GEMINI_API_KEY:-}
METICULOUS_IP=${METICULOUS_IP:-meticulous.local}
EOF
    
    log_success "Configuration migrated"
else
    log_warning "No existing .env found, you'll need to configure manually"
    
    # Prompt for required values
    read -p "Enter your Gemini API Key: " GEMINI_API_KEY
    read -p "Enter Meticulous IP [meticulous.local]: " METICULOUS_IP
    METICULOUS_IP=${METICULOUS_IP:-meticulous.local}
    
    cat > .env << EOF
GEMINI_API_KEY=${GEMINI_API_KEY}
METICULOUS_IP=${METICULOUS_IP}
EOF
fi

# Download new compose file
log_info "Downloading docker-compose.yml..."
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/docker-compose.unified.yml -o docker-compose.yml
log_success "Downloaded docker-compose.yml"

# Migrate data to Docker volume
log_info "Migrating data to Docker volume..."
docker volume create meticai-data 2>/dev/null || true

if [[ -d "$BACKUP_DIR/data" ]]; then
    # Use a temporary container to copy data into the volume
    docker run --rm -v meticai-data:/data -v "$BACKUP_DIR/data":/backup alpine sh -c "cp -r /backup/* /data/ 2>/dev/null || true"
    log_success "Data migrated to Docker volume"
fi

# Pull the new image
log_info "Pulling MeticAI unified image..."
docker compose pull

# Start the unified container
log_info "Starting MeticAI..."
docker compose up -d

# Wait for health check
log_info "Waiting for services to start..."
sleep 5

# Check if container is running
if docker compose ps | grep -q "running\|healthy"; then
    log_success "MeticAI is running!"
else
    log_warning "Container may still be starting. Check with: docker compose logs -f"
fi

# Get IP for access URL
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
echo "  View logs:     cd ~/.meticai && docker compose logs -f"
echo "  Restart:       cd ~/.meticai && docker compose restart"
echo "  Stop:          cd ~/.meticai && docker compose down"
echo ""

# Offer to clean up old installation
echo "Would you like to remove the old installation at $OLD_METICAI_DIR?"
read -p "(This saves disk space but is irreversible) [y/N]: " CLEANUP

if [[ "$CLEANUP" =~ ^[Yy]$ ]]; then
    log_info "Removing old installation..."
    rm -rf "$OLD_METICAI_DIR"
    log_success "Old installation removed"
else
    log_info "Old installation kept at $OLD_METICAI_DIR"
    echo "You can remove it later with: rm -rf $OLD_METICAI_DIR"
fi

echo ""
echo "☕ Enjoy your coffee!"
