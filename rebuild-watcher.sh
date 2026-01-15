#!/bin/bash

################################################################################
# MeticAI - Host Rebuild Watcher
################################################################################
#
# This script watches for rebuild requests triggered by the update system
# running inside containers. When updates are pulled from inside a container,
# some containers (with host volume mounts) cannot be rebuilt from within.
#
# USAGE:
#   ./rebuild-watcher.sh              # Run once, check and rebuild if needed
#   ./rebuild-watcher.sh --watch      # Continuously watch (for launchd/cron)
#   ./rebuild-watcher.sh --install    # Install as launchd service (macOS)
#
# HOW IT WORKS:
#   1. The update system inside containers creates .rebuild-needed when updates
#      are pulled but containers can't be rebuilt
#   2. This script detects that file and runs docker compose up -d --build
#   3. After successful rebuild, the flag file is removed
#
################################################################################

# Text Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REBUILD_FLAG="$SCRIPT_DIR/.rebuild-needed"
LOG_FILE="$SCRIPT_DIR/.rebuild-watcher.log"

log() {
    echo -e "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

do_rebuild() {
    log "${YELLOW}Rebuild requested - starting container rebuild...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Check if docker compose is available
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        log "${RED}Error: Docker Compose not found${NC}"
        return 1
    fi
    
    # Rebuild containers
    log "Rebuilding containers..."
    if $COMPOSE_CMD up -d --build 2>&1 | tee -a "$LOG_FILE"; then
        log "${GREEN}✓ Containers rebuilt successfully${NC}"
        # Clear the file contents but keep the file (Docker needs it to exist for mount)
        echo "" > "$REBUILD_FLAG"
        
        # Update the versions file to clear update_available
        if [ -x "$SCRIPT_DIR/update.sh" ]; then
            "$SCRIPT_DIR/update.sh" --check-only &>/dev/null
        fi
        
        return 0
    else
        log "${RED}✗ Failed to rebuild containers${NC}"
        return 1
    fi
}

check_rebuild_needed() {
    if [ -f "$REBUILD_FLAG" ] && [ -s "$REBUILD_FLAG" ]; then
        # File exists and is not empty
        return 0
    fi
    return 1
}

install_launchd() {
    local plist_path="$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
    local script_path="$SCRIPT_DIR/rebuild-watcher.sh"
    
    echo -e "${BLUE}Installing launchd service...${NC}"
    
    # Create LaunchAgents directory if it doesn't exist
    mkdir -p "$HOME/Library/LaunchAgents"
    
    # Create the plist file
    cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.meticai.rebuild-watcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>$script_path</string>
    </array>
    <key>WatchPaths</key>
    <array>
        <string>$REBUILD_FLAG</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
</dict>
</plist>
EOF
    
    # Load the service
    launchctl unload "$plist_path" 2>/dev/null
    launchctl load "$plist_path"
    
    echo -e "${GREEN}✓ Launchd service installed${NC}"
    echo -e "  Service will automatically rebuild containers when updates are triggered."
    echo -e "  Log file: $LOG_FILE"
    echo ""
    echo -e "  To uninstall: launchctl unload $plist_path && rm $plist_path"
}

uninstall_launchd() {
    local plist_path="$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
    
    if [ -f "$plist_path" ]; then
        launchctl unload "$plist_path" 2>/dev/null
        rm -f "$plist_path"
        echo -e "${GREEN}✓ Launchd service uninstalled${NC}"
    else
        echo -e "${YELLOW}Service not installed${NC}"
    fi
}

show_help() {
    echo "MeticAI Rebuild Watcher"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  (no args)     Check once and rebuild if needed"
    echo "  --watch       Continuously watch for rebuild requests"
    echo "  --install     Install as macOS launchd service (auto-watches)"
    echo "  --uninstall   Remove launchd service"
    echo "  --status      Check if rebuild is needed"
    echo "  --help        Show this help message"
    echo ""
    echo "The rebuild watcher enables fully automatic updates from the web UI."
    echo "When updates are triggered from inside a container, this service"
    echo "completes the rebuild process on the host system."
}

# Main
case "${1:-}" in
    --watch)
        log "Starting rebuild watcher (continuous mode)..."
        while true; do
            if check_rebuild_needed; then
                do_rebuild
            fi
            sleep 10
        done
        ;;
    --install)
        install_launchd
        ;;
    --uninstall)
        uninstall_launchd
        ;;
    --status)
        if check_rebuild_needed; then
            echo -e "${YELLOW}Rebuild is needed${NC}"
            cat "$REBUILD_FLAG"
            exit 1
        else
            echo -e "${GREEN}No rebuild needed${NC}"
            exit 0
        fi
        ;;
    --help|-h)
        show_help
        ;;
    *)
        # Default: check once
        if check_rebuild_needed; then
            do_rebuild
        else
            echo -e "${GREEN}No rebuild needed${NC}"
        fi
        ;;
esac
