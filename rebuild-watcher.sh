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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common library
source "$SCRIPT_DIR/scripts/lib/common.sh"
REBUILD_FLAG="$SCRIPT_DIR/.rebuild-needed"
UPDATE_CHECK_FLAG="$SCRIPT_DIR/.update-check-requested"
UPDATE_REQUESTED_FLAG="$SCRIPT_DIR/.update-requested"
RESTART_REQUESTED_FLAG="$SCRIPT_DIR/.restart-requested"
LOG_FILE="$SCRIPT_DIR/.rebuild-watcher.log"

# Set up PATH for launchd environment (needed for Docker credential helpers)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Docker Desktop credential helper location
if [ -d "/Applications/Docker.app/Contents/Resources/bin" ]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

# Custom log function that writes to file and uses colors from common.sh
log() {
    echo -e "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Ensure required files exist and have correct permissions before Docker operations
prepare_for_docker() {
    cd "$SCRIPT_DIR"
    
    # Ensure required files exist as files (not directories)
    for file in ".versions.json" ".rebuild-needed" ".update-check-requested" ".update-requested" ".restart-requested"; do
        if [ -d "$SCRIPT_DIR/$file" ]; then
            rm -rf "$SCRIPT_DIR/$file"
        fi
    done
    
    [ ! -f "$SCRIPT_DIR/.versions.json" ] && echo '{}' > "$SCRIPT_DIR/.versions.json"
    [ ! -f "$SCRIPT_DIR/.rebuild-needed" ] && touch "$SCRIPT_DIR/.rebuild-needed"
    [ ! -f "$SCRIPT_DIR/.update-check-requested" ] && touch "$SCRIPT_DIR/.update-check-requested"
    [ ! -f "$SCRIPT_DIR/.update-requested" ] && touch "$SCRIPT_DIR/.update-requested"
    [ ! -f "$SCRIPT_DIR/.restart-requested" ] && touch "$SCRIPT_DIR/.restart-requested"
    
    # Pre-create directories so Docker doesn't create them as root
    mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/logs"
}

# Fix permissions after Docker operations (needed when using sudo)
fix_permissions() {
    cd "$SCRIPT_DIR"
    
    # Get the owner of the script directory (should be the real user)
    local dir_owner
    dir_owner=$(stat -c '%u:%g' "$SCRIPT_DIR" 2>/dev/null || stat -f '%u:%g' "$SCRIPT_DIR" 2>/dev/null)
    
    if [ -n "$dir_owner" ]; then
        # Fix ownership of files that Docker might have created as root
        for item in data logs .versions.json .rebuild-needed .update-check-requested .update-requested .restart-requested meticulous-source meticai-web; do
            if [ -e "$SCRIPT_DIR/$item" ]; then
                sudo chown -R "$dir_owner" "$SCRIPT_DIR/$item" 2>/dev/null || true
            fi
        done
    fi
}

# Handle full update request (triggered by trigger-update API endpoint)
do_full_update() {
    log "${YELLOW}Full update requested by UI - pulling updates and rebuilding...${NC}"
    
    cd "$SCRIPT_DIR"
    
    if [ -x "$SCRIPT_DIR/update.sh" ]; then
        if "$SCRIPT_DIR/update.sh" --auto 2>&1 | tee -a "$LOG_FILE"; then
            log "${GREEN}✓ Full update completed${NC}"
        else
            log "${YELLOW}Update completed with warnings${NC}"
        fi
    else
        log "${RED}update.sh not found or not executable${NC}"
    fi
    
    # Clear the signal file
    echo "" > "$UPDATE_REQUESTED_FLAG"
}

check_full_update_needed() {
    if [ -f "$UPDATE_REQUESTED_FLAG" ]; then
        # File exists - check if it has non-whitespace content
        if grep -q '[^[:space:]]' "$UPDATE_REQUESTED_FLAG" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Handle update check request (triggered by API endpoint)
do_update_check() {
    log "${BLUE}Update check requested by API...${NC}"
    
    cd "$SCRIPT_DIR"
    
    if [ -x "$SCRIPT_DIR/update.sh" ]; then
        if "$SCRIPT_DIR/update.sh" --check-only 2>&1 | tee -a "$LOG_FILE"; then
            log "${GREEN}✓ Update check completed${NC}"
        else
            log "${YELLOW}Update check had issues but may have succeeded${NC}"
        fi
    else
        log "${RED}update.sh not found or not executable${NC}"
    fi
    
    # Clear the signal file
    echo "" > "$UPDATE_CHECK_FLAG"
}

check_update_check_needed() {
    if [ -f "$UPDATE_CHECK_FLAG" ]; then
        # File exists - check if it has non-whitespace content
        if grep -q '[^[:space:]]' "$UPDATE_CHECK_FLAG" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Handle restart request (triggered by API endpoint)
do_restart() {
    log "${BLUE}Restart requested by API...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Prepare files before Docker runs
    prepare_for_docker
    
    # Check if docker compose is available
    DOCKER_PATHS="/usr/local/bin/docker /opt/homebrew/bin/docker /Applications/Docker.app/Contents/Resources/bin/docker"
    DOCKER_CMD=""
    
    for path in $DOCKER_PATHS; do
        if [ -x "$path" ]; then
            DOCKER_CMD="$path"
            break
        fi
    done
    
    if [ -z "$DOCKER_CMD" ]; then
        DOCKER_CMD=$(command -v docker 2>/dev/null)
    fi
    
    if [ -z "$DOCKER_CMD" ] || ! "$DOCKER_CMD" compose version &> /dev/null; then
        log "${RED}Error: Docker Compose not found${NC}"
        echo "" > "$RESTART_REQUESTED_FLAG"
        return 1
    fi
    
    # On Linux, we may need sudo for docker commands
    SUDO_PREFIX=""
    if [[ "$OSTYPE" == "linux"* ]]; then
        if ! "$DOCKER_CMD" info &> /dev/null; then
            SUDO_PREFIX="sudo"
        fi
    fi
    
    COMPOSE_CMD="$SUDO_PREFIX $DOCKER_CMD compose"
    
    log "Restarting containers..."
    if $COMPOSE_CMD restart 2>&1 | tee -a "$LOG_FILE"; then
        log "${GREEN}✓ Containers restarted successfully${NC}"
        fix_permissions
    else
        log "${RED}✗ Failed to restart containers${NC}"
    fi
    
    # Clear the signal file
    echo "" > "$RESTART_REQUESTED_FLAG"
}

check_restart_needed() {
    if [ -f "$RESTART_REQUESTED_FLAG" ]; then
        # File exists - check if it has non-whitespace content
        if grep -q '[^[:space:]]' "$RESTART_REQUESTED_FLAG" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

do_rebuild() {
    log "${YELLOW}Rebuild requested - starting container rebuild...${NC}"
    
    cd "$SCRIPT_DIR"
    
    # Prepare files before Docker runs
    prepare_for_docker
    
    # Check if docker compose is available (use full paths for launchd compatibility)
    # Common Docker paths on macOS
    DOCKER_PATHS="/usr/local/bin/docker /opt/homebrew/bin/docker /Applications/Docker.app/Contents/Resources/bin/docker"
    DOCKER_CMD=""
    
    for path in $DOCKER_PATHS; do
        if [ -x "$path" ]; then
            DOCKER_CMD="$path"
            break
        fi
    done
    
    if [ -z "$DOCKER_CMD" ]; then
        # Fallback to PATH lookup
        DOCKER_CMD=$(command -v docker 2>/dev/null)
    fi
    
    if [ -z "$DOCKER_CMD" ] || ! "$DOCKER_CMD" compose version &> /dev/null; then
        log "${RED}Error: Docker Compose not found (tried: $DOCKER_PATHS)${NC}"
        return 1
    fi
    
    # On Linux, we may need sudo for docker commands
    SUDO_PREFIX=""
    if [[ "$OSTYPE" == "linux"* ]]; then
        if ! "$DOCKER_CMD" info &> /dev/null; then
            SUDO_PREFIX="sudo"
        fi
    fi
    
    COMPOSE_CMD="$SUDO_PREFIX $DOCKER_CMD compose"
    
    # Rebuild containers
    log "Rebuilding containers..."
    if $COMPOSE_CMD up -d --build 2>&1 | tee -a "$LOG_FILE"; then
        log "${GREEN}✓ Containers rebuilt successfully${NC}"
        
        # Fix permissions after Docker operations
        fix_permissions
        
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
    if [ -f "$REBUILD_FLAG" ]; then
        # File exists - check if it has non-whitespace content
        if grep -q '[^[:space:]]' "$REBUILD_FLAG" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

install_launchd() {
    local plist_path="$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
    local script_path="$SCRIPT_DIR/rebuild-watcher.sh"
    
    log_info "Installing launchd service..."
    
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
        <string>$UPDATE_CHECK_FLAG</string>
        <string>$UPDATE_REQUESTED_FLAG</string>
        <string>$RESTART_REQUESTED_FLAG</string>
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
    
    log_success "Launchd service installed"
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
        log_success "Launchd service uninstalled"
    else
        log_warning "Service not installed"
    fi
}

################################################################################
# Linux (systemd) Installation - For Raspberry Pi and other Linux systems
################################################################################

install_systemd() {
    local service_dir="/etc/systemd/system"
    local path_unit="$service_dir/meticai-rebuild-watcher.path"
    local service_unit="$service_dir/meticai-rebuild-watcher.service"
    local script_path="$SCRIPT_DIR/rebuild-watcher.sh"
    
    log_info "Installing systemd service..."
    
    # Check if we have sudo access
    if ! sudo -n true 2>/dev/null; then
        log_warning "This requires sudo access. You may be prompted for your password."
    fi
    
    # Create the path unit (watches the files)
    sudo tee "$path_unit" > /dev/null <<EOF
[Unit]
Description=MeticAI Rebuild Watcher Path
Documentation=https://github.com/hessius/MeticAI

[Path]
PathModified=$REBUILD_FLAG
PathModified=$UPDATE_CHECK_FLAG
PathModified=$UPDATE_REQUESTED_FLAG
Unit=meticai-rebuild-watcher.service

[Install]
WantedBy=multi-user.target
EOF

    # Create the service unit (runs the rebuild)
    sudo tee "$service_unit" > /dev/null <<EOF
[Unit]
Description=MeticAI Rebuild Watcher Service
Documentation=https://github.com/hessius/MeticAI
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=$script_path
WorkingDirectory=$SCRIPT_DIR
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
User=$USER

[Install]
WantedBy=multi-user.target
EOF

    # Make sure the script is executable
    chmod +x "$script_path"
    
    # Reload systemd and enable the path unit
    sudo systemctl daemon-reload
    sudo systemctl enable meticai-rebuild-watcher.path
    sudo systemctl start meticai-rebuild-watcher.path
    
    log_success "Systemd service installed"
    echo -e "  Service will automatically rebuild containers when updates are triggered."
    echo -e "  Log file: $LOG_FILE"
    echo ""
    echo -e "  To check status: sudo systemctl status meticai-rebuild-watcher.path"
    echo -e "  To uninstall: $0 --uninstall"
}

uninstall_systemd() {
    local service_dir="/etc/systemd/system"
    local path_unit="$service_dir/meticai-rebuild-watcher.path"
    local service_unit="$service_dir/meticai-rebuild-watcher.service"
    
    log_info "Uninstalling systemd service..."
    
    # Stop and disable
    sudo systemctl stop meticai-rebuild-watcher.path 2>/dev/null
    sudo systemctl disable meticai-rebuild-watcher.path 2>/dev/null
    sudo systemctl stop meticai-rebuild-watcher.service 2>/dev/null
    
    # Remove unit files
    if [ -f "$path_unit" ] || [ -f "$service_unit" ]; then
        sudo rm -f "$path_unit" "$service_unit"
        sudo systemctl daemon-reload
        log_success "Systemd service uninstalled"
    else
        log_warning "Service not installed"
    fi
}

# Detect OS and call appropriate install/uninstall function
install_service() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        install_launchd
    elif [[ "$OSTYPE" == "linux"* ]]; then
        install_systemd
    else
        log_error "Unsupported OS: $OSTYPE"
        echo "Supported: macOS (darwin), Linux"
        exit 1
    fi
}

uninstall_service() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        uninstall_launchd
    elif [[ "$OSTYPE" == "linux"* ]]; then
        uninstall_systemd
    else
        log_error "Unsupported OS: $OSTYPE"
        exit 1
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
    echo "  --install     Install as system service (launchd on macOS, systemd on Linux)"
    echo "  --uninstall   Remove system service"
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
            if check_full_update_needed; then
                do_full_update
            fi
            if check_update_check_needed; then
                do_update_check
            fi
            if check_restart_needed; then
                do_restart
            fi
            if check_rebuild_needed; then
                do_rebuild
            fi
            sleep 2
        done
        ;;
    --install)
        install_service
        ;;
    --uninstall)
        uninstall_service
        ;;
    --status)
        if check_rebuild_needed; then
            log_warning "Rebuild is needed"
            cat "$REBUILD_FLAG"
            exit 1
        else
            log_success "No rebuild needed"
            exit 0
        fi
        ;;
    --help|-h)
        show_help
        ;;
    *)
        # Default: check once for all signals
        if check_full_update_needed; then
            do_full_update
        elif check_update_check_needed; then
            do_update_check
        elif check_restart_needed; then
            do_restart
        elif check_rebuild_needed; then
            do_rebuild
        else
            log_success "No action needed"
        fi
        ;;
esac
