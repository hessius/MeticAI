#!/bin/bash
################################################################################
# MeticAI - Docker Compose Wrapper
################################################################################
#
# Use this script instead of running `docker compose` directly.
# It ensures proper file permissions are maintained.
#
# USAGE:
#   ./docker-up.sh              # Build and start all containers
#   ./docker-up.sh --no-build   # Start without building
#   ./docker-up.sh down         # Stop all containers
#
################################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Ensure required files exist before Docker runs
prepare_files() {
    # Ensure files exist (not directories)
    [ -d ".versions.json" ] && rm -rf .versions.json
    [ -d ".rebuild-needed" ] && rm -rf .rebuild-needed
    [ ! -f ".versions.json" ] && echo '{}' > .versions.json
    [ ! -f ".rebuild-needed" ] && touch .rebuild-needed
    
    # Pre-create directories
    mkdir -p data logs
}

# Fix permissions after Docker operations
fix_permissions() {
    echo -e "${YELLOW}Fixing file permissions...${NC}"
    sudo chown -R "$(id -u):$(id -g)" data logs .versions.json .rebuild-needed \
        meticulous-source meticai-web 2>/dev/null || true
    echo -e "${GREEN}✓ Permissions fixed${NC}"
}

# Determine docker compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo "Error: Docker Compose not found"
    exit 1
fi

# Check if we need sudo
SUDO_PREFIX=""
if ! docker info &> /dev/null; then
    if sudo docker info &> /dev/null; then
        SUDO_PREFIX="sudo"
    else
        echo "Error: Cannot access Docker daemon"
        exit 1
    fi
fi

# Handle arguments
case "${1:-up}" in
    down|stop)
        $SUDO_PREFIX $COMPOSE_CMD down "$@"
        ;;
    *)
        prepare_files
        
        if [[ "$1" == "--no-build" ]]; then
            shift
            $SUDO_PREFIX $COMPOSE_CMD up -d "$@"
        else
            $SUDO_PREFIX $COMPOSE_CMD up -d --build "$@"
        fi
        
        # Fix permissions if we used sudo
        if [ -n "$SUDO_PREFIX" ]; then
            fix_permissions
        fi
        ;;
esac
