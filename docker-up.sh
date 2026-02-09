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

# Source common library
source "$SCRIPT_DIR/scripts/lib/common.sh"

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
    log_warning "Fixing file permissions..."
    sudo chown -R "$(id -u):$(id -g)" data logs .versions.json .rebuild-needed \
        meticulous-source meticai-web 2>/dev/null || true
    log_success "Permissions fixed"
}

# Determine docker compose command
COMPOSE_CMD=$(get_compose_command) || exit 1

# Check if we need sudo
SUDO_PREFIX=""
if ! docker info &> /dev/null; then
    if sudo docker info &> /dev/null; then
        SUDO_PREFIX="sudo"
    else
        log_error "Cannot access Docker daemon"
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
