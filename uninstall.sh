#!/bin/bash

################################################################################
# MeticAI - Uninstaller
################################################################################
# 
# This script removes MeticAI and its related files from your system.
#
# USAGE:
#   ./uninstall.sh
#
# WHAT IT DOES:
#   1. Stops and removes all MeticAI Docker containers
#   2. Removes Docker images built by MeticAI
#   3. Removes cloned repositories (meticulous-source, meticai-web)
#   4. Removes configuration files (.env, settings)
#   5. Optionally removes macOS integrations (Dock shortcut, rebuild watcher)
#   6. Asks whether to remove external dependencies (Docker, git, etc.)
#
# NOTE:
#   - External dependencies (Docker, git, qrencode) are NOT automatically
#     removed unless you explicitly choose to do so
#   - You can safely keep Docker and git if you use them for other projects
#
################################################################################

# Get the directory where this script is located (absolute path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common library
source "$SCRIPT_DIR/scripts/lib/common.sh"

# Constants
WEB_INSTALL_URL="https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh"

echo -e "${RED}=========================================${NC}"
echo -e "${RED}      ☕️ MeticAI Uninstaller 🗑️       ${NC}"
echo -e "${RED}=========================================${NC}"
echo ""
log_warning "This will remove MeticAI from your system."
echo ""

# Ask for confirmation
read -r -p "Are you sure you want to uninstall MeticAI? (y/n) [n]: " CONFIRM </dev/tty
CONFIRM=${CONFIRM:-n}

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    log_success "Uninstallation cancelled."
    exit 0
fi

echo ""
log_warning "Starting uninstallation..."
echo ""

# Track what we've done
UNINSTALLED_ITEMS=()
KEPT_ITEMS=()
FAILED_ITEMS=()

# Helper function: Try docker command with and without sudo
# Returns: 0 on success, 1 on failure
# Sets USED_SUDO to "true" if sudo was needed
# Note: Preserves existing USED_SUDO=true state to track sudo across multiple calls
try_docker_command() {
    local cmd="$1"
    local prev_used_sudo="$USED_SUDO"
    USED_SUDO="false"
    
    # Try without sudo first (works on macOS and Linux with docker group)
    if eval "$cmd" 2>/dev/null; then
        # Preserve previous sudo state if it was true
        [ "$prev_used_sudo" = "true" ] && USED_SUDO="true"
        return 0
    # Try with sudo on Linux if regular command failed
    elif [[ "$OSTYPE" != "darwin"* ]] && eval "sudo $cmd" 2>/dev/null; then
        USED_SUDO="true"
        return 0
    else
        # Preserve previous sudo state if it was true
        [ "$prev_used_sudo" = "true" ] && USED_SUDO="true"
        return 1
    fi
}

# 1. Stop and remove Docker containers
################################################################################
log_warning "[1/7] Stopping and removing Docker containers..."

if command -v docker &> /dev/null; then
    # Only attempt docker compose commands if a compose file exists
    if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ] || [ -f "compose.yml" ] || [ -f "compose.yaml" ]; then
        # Check if containers exist and stop them
        if try_docker_command "docker compose ps -q" || try_docker_command "docker-compose ps -q"; then
            # Stop and remove containers (supports both: docker compose down || docker-compose down)
            CONTAINERS_REMOVED=false
            if try_docker_command "docker compose down"; then
                CONTAINERS_REMOVED=true
            elif try_docker_command "docker-compose down"; then
                CONTAINERS_REMOVED=true
            fi
            
            if [ "$CONTAINERS_REMOVED" = true ]; then
                if [ "$USED_SUDO" = "true" ]; then
                    log_success "Containers stopped and removed (with sudo)"
                else
                    log_success "Containers stopped and removed"
                fi
                UNINSTALLED_ITEMS+=("Docker containers")
            else
                log_warning "Could not stop containers (they may not be running)"
                KEPT_ITEMS+=("Docker containers (not found)")
            fi
        else
            log_warning "No containers found or not running"
            KEPT_ITEMS+=("Docker containers (not found)")
        fi
    else
        log_warning "No docker-compose.yml found"
        KEPT_ITEMS+=("Docker containers (no compose file)")
    fi
else
    log_warning "Docker not found, skipping container cleanup"
    KEPT_ITEMS+=("Docker containers (Docker not installed)")
fi

# 2. Remove Docker images
################################################################################
log_warning "[2/7] Removing Docker images..."

if command -v docker &> /dev/null; then
    # List MeticAI-related images (matches various naming patterns: meticai-, met-ai-, meticai-web-, etc.)
    # Try without sudo first
    if docker images &> /dev/null; then
        IMAGES=$(docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -E "(meticai|met-ai|coffee-relay|gemini-client|meticulous-mcp|meticulous-source)" || true)
        USED_SUDO_FOR_IMAGES=false
    # If the docker command failed (permission denied), try with sudo on Linux
    elif [[ "$OSTYPE" != "darwin"* ]] && sudo docker images &> /dev/null; then
        IMAGES=$(sudo docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -E "(meticai|met-ai|coffee-relay|gemini-client|meticulous-mcp|meticulous-source)" || true)
        USED_SUDO_FOR_IMAGES=true
    else
        IMAGES=""
        USED_SUDO_FOR_IMAGES=false
    fi
    
    if [ -n "$IMAGES" ]; then
        echo "Found MeticAI images:"
        echo "$IMAGES"
        echo ""
        read -r -p "Remove these Docker images? (y/n) [y]: " REMOVE_IMAGES </dev/tty
        REMOVE_IMAGES=${REMOVE_IMAGES:-y}
        
        if [[ "$REMOVE_IMAGES" =~ ^[Yy]$ ]]; then
            # Use sudo if we used it to list images
            if [ "$USED_SUDO_FOR_IMAGES" = true ]; then
                if echo "$IMAGES" | xargs sudo docker rmi -f 2>/dev/null; then
                    log_success "Docker images removed (with sudo)"
                    UNINSTALLED_ITEMS+=("Docker images")
                else
                    log_warning "Could not remove images"
                    KEPT_ITEMS+=("Docker images (removal failed)")
                fi
            # Try removing without sudo first
            elif echo "$IMAGES" | xargs docker rmi -f 2>/dev/null; then
                log_success "Docker images removed"
                UNINSTALLED_ITEMS+=("Docker images")
            # Try with sudo on Linux if regular command failed
            elif [[ "$OSTYPE" != "darwin"* ]] && echo "$IMAGES" | xargs sudo docker rmi -f 2>/dev/null; then
                log_success "Docker images removed (with sudo)"
                UNINSTALLED_ITEMS+=("Docker images")
            else
                log_warning "Could not remove images"
                KEPT_ITEMS+=("Docker images (removal failed)")
            fi
        else
            log_warning "Keeping Docker images"
            KEPT_ITEMS+=("Docker images (user choice)")
        fi
    else
        log_warning "No MeticAI images found"
        KEPT_ITEMS+=("Docker images (not found)")
    fi
else
    log_warning "Docker not found, skipping image cleanup"
    KEPT_ITEMS+=("Docker images (Docker not installed)")
fi

# 3. Remove cloned repositories
################################################################################
log_warning "[3/7] Removing cloned repositories..."

REMOVED_REPOS=0

if [ -d "meticulous-source" ]; then
    rm -rf meticulous-source
    log_success "Removed meticulous-source directory"
    ((REMOVED_REPOS++))
fi

if [ -d "meticai-web" ]; then
    rm -rf meticai-web
    log_success "Removed meticai-web directory"
    ((REMOVED_REPOS++))
fi

if [ $REMOVED_REPOS -gt 0 ]; then
    UNINSTALLED_ITEMS+=("Cloned repositories ($REMOVED_REPOS)")
else
    log_warning "No cloned repositories found"
    KEPT_ITEMS+=("Cloned repositories (not found)")
fi

# 4. Remove configuration files (preserving .env and data for reinstallation)
################################################################################
log_warning "[4/7] Handling configuration files..."

REMOVED_CONFIGS=0

# Preserve .env file for potential reinstallation
if [ -f ".env" ]; then
    log_info "Preserving .env file for potential reinstallation"
    log_info "  (Contains your GEMINI_API_KEY, METICULOUS_IP, PI_IP settings)"
    KEPT_ITEMS+=(".env file (preserved)")
fi

# Preserve data directory (contains profile history)
if [ -d "data" ]; then
    log_info "Preserving data/ directory (contains profile history)"
    KEPT_ITEMS+=("data/ directory (preserved)")
fi

# Preserve logs directory
if [ -d "logs" ]; then
    log_info "Preserving logs/ directory"
    KEPT_ITEMS+=("logs/ directory (preserved)")
fi

if [ -f ".versions.json" ]; then
    rm -f .versions.json
    log_success "Removed .versions.json file"
    ((REMOVED_CONFIGS++))
fi

# Note: .update-config.json is a source file and should not be removed

if [ -f ".rebuild-needed" ]; then
    rm -f .rebuild-needed
    log_success "Removed .rebuild-needed file"
    ((REMOVED_CONFIGS++))
fi

if [ -f ".rebuild-watcher.log" ]; then
    rm -f .rebuild-watcher.log
    log_success "Removed .rebuild-watcher.log file"
    ((REMOVED_CONFIGS++))
fi

if [ $REMOVED_CONFIGS -gt 0 ]; then
    UNINSTALLED_ITEMS+=("Configuration files ($REMOVED_CONFIGS)")
else
    log_warning "No configuration files found"
    KEPT_ITEMS+=("Configuration files (not found)")
fi

# 5. Remove macOS integrations
################################################################################
log_warning "[5/7] Removing macOS integrations..."

REMOVED_MACOS=0

# Remove Dock shortcut
if [[ "$OSTYPE" == "darwin"* ]]; then
    APP_PATH="/Applications/MeticAI.app"
    if [ -d "$APP_PATH" ]; then
        log_warning "Found MeticAI.app in Applications"
        read -r -p "Remove MeticAI from Applications and Dock? (y/n) [y]: " REMOVE_APP </dev/tty
        REMOVE_APP=${REMOVE_APP:-y}
        
        if [[ "$REMOVE_APP" =~ ^[Yy]$ ]]; then
            # Try to remove without sudo first
            if rm -rf "$APP_PATH" 2>/dev/null; then
                log_success "Removed MeticAI.app"
                ((REMOVED_MACOS++))
            else
                # Need sudo
                sudo rm -rf "$APP_PATH" 2>/dev/null
                log_success "Removed MeticAI.app (with sudo)"
                ((REMOVED_MACOS++))
            fi
            
            # Note: Removing the app from Dock programmatically is complex and risky
            # The Dock will automatically remove the icon when it detects the app is missing
            # User can also manually remove it by dragging the icon out of the Dock
            log_warning "Note: MeticAI icon will disappear from Dock automatically or can be removed manually"
        else
            log_warning "Keeping MeticAI.app"
            KEPT_ITEMS+=("macOS Dock shortcut (user choice)")
        fi
    fi
    
    # Uninstall rebuild watcher service
    PLIST_PATH="$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
    if [ -f "$PLIST_PATH" ]; then
        log_warning "Found rebuild watcher service"
        read -r -p "Remove rebuild watcher service? (y/n) [y]: " REMOVE_WATCHER </dev/tty
        REMOVE_WATCHER=${REMOVE_WATCHER:-y}
        
        if [[ "$REMOVE_WATCHER" =~ ^[Yy]$ ]]; then
            launchctl unload "$PLIST_PATH" 2>/dev/null || true
            rm -f "$PLIST_PATH"
            log_success "Removed rebuild watcher service"
            ((REMOVED_MACOS++))
        else
            log_warning "Keeping rebuild watcher service"
            KEPT_ITEMS+=("Rebuild watcher service (user choice)")
        fi
    fi
    
    if [ $REMOVED_MACOS -gt 0 ]; then
        UNINSTALLED_ITEMS+=("macOS integrations ($REMOVED_MACOS)")
    else
        if [ ! -d "$APP_PATH" ] && [ ! -f "$PLIST_PATH" ]; then
            log_warning "No macOS integrations found"
            KEPT_ITEMS+=("macOS integrations (not found)")
        fi
    fi
else
    log_warning "Not running on macOS, skipping"
    KEPT_ITEMS+=("macOS integrations (not macOS)")
fi

# Linux-specific (systemd) service cleanup
if [[ "$OSTYPE" == "linux"* ]]; then
    log_warning "Checking for Linux systemd integrations..."
    REMOVED_LINUX=0
    
    # Check for systemd path unit
    if [ -f "/etc/systemd/system/meticai-rebuild-watcher.path" ]; then
        log_warning "Found rebuild watcher systemd service"
        read -r -p "Remove rebuild watcher service? (y/n) [y]: " REMOVE_WATCHER </dev/tty
        REMOVE_WATCHER=${REMOVE_WATCHER:-y}
        
        if [[ "$REMOVE_WATCHER" =~ ^[Yy]$ ]]; then
            sudo systemctl stop meticai-rebuild-watcher.path 2>/dev/null || true
            sudo systemctl disable meticai-rebuild-watcher.path 2>/dev/null || true
            sudo rm -f /etc/systemd/system/meticai-rebuild-watcher.path
            sudo rm -f /etc/systemd/system/meticai-rebuild-watcher.service
            sudo systemctl daemon-reload
            log_success "Removed rebuild watcher systemd service"
            ((REMOVED_LINUX++))
        else
            log_warning "Keeping rebuild watcher service"
            KEPT_ITEMS+=("Rebuild watcher service (user choice)")
        fi
    fi
    
    if [ $REMOVED_LINUX -gt 0 ]; then
        UNINSTALLED_ITEMS+=("Linux integrations ($REMOVED_LINUX)")
    fi
fi

# 6. Ask about external dependencies
################################################################################
log_warning "[6/7] External dependencies (optional)..."
echo ""
log_info "MeticAI can optionally remove external dependencies that were installed"
log_info "during setup. These are only removed if you explicitly choose to do so."
echo ""
log_warning "⚠️  WARNING: Only remove these if you don't use them for other projects!"
echo ""

# Docker
if command -v docker &> /dev/null; then
    log_warning "Docker is installed on this system"
    read -r -p "Do you want to remove Docker? (y/n) [n]: " REMOVE_DOCKER </dev/tty
    REMOVE_DOCKER=${REMOVE_DOCKER:-n}
    
    if [[ "$REMOVE_DOCKER" =~ ^[Yy]$ ]]; then
        log_error "Removing Docker..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            log_warning "On macOS, Docker Desktop must be uninstalled manually"
            log_warning "Open /Applications and drag Docker.app to Trash"
            KEPT_ITEMS+=("Docker (manual removal required on macOS)")
        else
            # Linux uninstall
            if command -v apt-get &> /dev/null; then
                sudo apt-get remove -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
                log_success "Docker removed"
                UNINSTALLED_ITEMS+=("Docker")
            elif command -v dnf &> /dev/null; then
                sudo dnf remove -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
                log_success "Docker removed"
                UNINSTALLED_ITEMS+=("Docker")
            elif command -v yum &> /dev/null; then
                sudo yum remove -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
                log_success "Docker removed"
                UNINSTALLED_ITEMS+=("Docker")
            else
                log_warning "Could not determine package manager for Docker removal"
                FAILED_ITEMS+=("Docker (unknown package manager)")
            fi
        fi
    else
        log_success "Keeping Docker"
        KEPT_ITEMS+=("Docker (user choice)")
    fi
else
    KEPT_ITEMS+=("Docker (not installed)")
fi

echo ""

# Git
if command -v git &> /dev/null; then
    log_warning "Git is installed on this system"
    read -r -p "Do you want to remove git? (y/n) [n]: " REMOVE_GIT </dev/tty
    REMOVE_GIT=${REMOVE_GIT:-n}
    
    if [[ "$REMOVE_GIT" =~ ^[Yy]$ ]]; then
        log_error "Removing git..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew uninstall git 2>/dev/null || true
                log_success "Git removed"
                UNINSTALLED_ITEMS+=("git")
            else
                log_warning "Cannot remove git (not installed via Homebrew)"
                KEPT_ITEMS+=("git (not managed by Homebrew)")
            fi
        elif command -v apt-get &> /dev/null; then
            sudo apt-get remove -y git 2>/dev/null || true
            log_success "Git removed"
            UNINSTALLED_ITEMS+=("git")
        elif command -v dnf &> /dev/null; then
            sudo dnf remove -y git 2>/dev/null || true
            log_success "Git removed"
            UNINSTALLED_ITEMS+=("git")
        elif command -v yum &> /dev/null; then
            sudo yum remove -y git 2>/dev/null || true
            log_success "Git removed"
            UNINSTALLED_ITEMS+=("git")
        else
            log_warning "Could not determine package manager for git removal"
            FAILED_ITEMS+=("git (unknown package manager)")
        fi
    else
        log_success "Keeping git"
        KEPT_ITEMS+=("git (user choice)")
    fi
else
    KEPT_ITEMS+=("git (not installed)")
fi

echo ""

# qrencode
if command -v qrencode &> /dev/null; then
    log_warning "qrencode is installed on this system"
    read -r -p "Do you want to remove qrencode? (y/n) [n]: " REMOVE_QRENCODE </dev/tty
    REMOVE_QRENCODE=${REMOVE_QRENCODE:-n}
    
    if [[ "$REMOVE_QRENCODE" =~ ^[Yy]$ ]]; then
        log_error "Removing qrencode..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew uninstall qrencode 2>/dev/null || true
                log_success "qrencode removed"
                UNINSTALLED_ITEMS+=("qrencode")
            else
                log_warning "Cannot remove qrencode (not installed via Homebrew)"
                KEPT_ITEMS+=("qrencode (not managed by Homebrew)")
            fi
        elif command -v apt-get &> /dev/null; then
            sudo apt-get remove -y qrencode 2>/dev/null || true
            log_success "qrencode removed"
            UNINSTALLED_ITEMS+=("qrencode")
        elif command -v dnf &> /dev/null; then
            sudo dnf remove -y qrencode 2>/dev/null || true
            log_success "qrencode removed"
            UNINSTALLED_ITEMS+=("qrencode")
        elif command -v yum &> /dev/null; then
            sudo yum remove -y qrencode 2>/dev/null || true
            log_success "qrencode removed"
            UNINSTALLED_ITEMS+=("qrencode")
        else
            log_warning "Could not determine package manager for qrencode removal"
            FAILED_ITEMS+=("qrencode (unknown package manager)")
        fi
    else
        log_success "Keeping qrencode"
        KEPT_ITEMS+=("qrencode (user choice)")
    fi
else
    KEPT_ITEMS+=("qrencode (not installed)")
fi

echo ""

# 7. Summary
################################################################################
log_warning "[7/7] Uninstallation complete!"
echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}          Uninstallation Summary         ${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

if [ ${#UNINSTALLED_ITEMS[@]} -gt 0 ]; then
    echo -e "${GREEN}✓ Removed:${NC}"
    for item in "${UNINSTALLED_ITEMS[@]}"; do
        echo -e "  - $item"
    done
    echo ""
fi

if [ ${#KEPT_ITEMS[@]} -gt 0 ]; then
    echo -e "${YELLOW}⊙ Kept:${NC}"
    for item in "${KEPT_ITEMS[@]}"; do
        echo -e "  - $item"
    done
    echo ""
fi

if [ ${#FAILED_ITEMS[@]} -gt 0 ]; then
    echo -e "${RED}✗ Failed to remove:${NC}"
    for item in "${FAILED_ITEMS[@]}"; do
        echo -e "  - $item"
    done
    echo ""
fi

log_info "Thank you for using MeticAI! ☕️"
echo ""

# Check if uninstall was called from an installer script
if [[ "$METICAI_CALLED_FROM_INSTALLER" == "true" ]]; then
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}    Restart Installation Flow?          ${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    echo -e "${YELLOW}The uninstallation is complete.${NC}"
    echo ""
    
    # Determine which install script to use
    INSTALL_SCRIPT="./local-install.sh"
    if [[ "$METICAI_INSTALL_METHOD" == "web_install.sh" ]]; then
        INSTALL_SCRIPT="./web_install.sh"
    fi
    
    echo -e "${BLUE}Would you like to restart the installation process now?${NC}"
    echo -e "  This will run: ${GREEN}$INSTALL_SCRIPT${NC}"
    echo ""
    read -r -p "Restart installation? (y/n) [y]: " RESTART_INSTALL </dev/tty
    RESTART_INSTALL=${RESTART_INSTALL:-y}
    
    if [[ "$RESTART_INSTALL" =~ ^[Yy]$ ]]; then
        # Validate that the install script exists and is executable
        if [ ! -f "$INSTALL_SCRIPT" ]; then
            echo ""
            log_error "Error: $INSTALL_SCRIPT not found."
            log_warning "Please run the installer manually:"
            
            # For web install method, provide the curl command
            if [[ "$METICAI_INSTALL_METHOD" == "web_install.sh" ]]; then
                log_info "  curl -fsSL $WEB_INSTALL_URL | bash"
            else
                log_info "  ./local-install.sh"
            fi
            echo ""
            exit 1
        fi
        
        if [ ! -x "$INSTALL_SCRIPT" ]; then
            log_warning "Making $INSTALL_SCRIPT executable..."
            chmod +x "$INSTALL_SCRIPT"
        fi
        
        echo ""
        log_success "Restarting installation flow..."
        echo ""
        # Clear the installer flag to avoid infinite loop
        unset METICAI_CALLED_FROM_INSTALLER
        unset METICAI_INSTALL_METHOD
        exec "$INSTALL_SCRIPT"
    else
        echo ""
        log_warning "Installation not restarted."
        log_warning "You can run the installer manually later:"
        
        # For web install method, provide the curl command
        if [[ "$METICAI_INSTALL_METHOD" == "web_install.sh" ]]; then
            log_info "  curl -fsSL $WEB_INSTALL_URL | bash"
        else
            log_info "  $INSTALL_SCRIPT"
        fi
        echo ""
    fi
else
    # Standalone uninstall - show directory cleanup message
    log_warning "Note: The MeticAI directory still contains source code:"
    log_info "  $SCRIPT_DIR"
    echo ""
    log_warning "You can safely delete it if you no longer need it:"
    log_info "  rm -rf \"$SCRIPT_DIR\""
    log_warning "(On some systems like Raspbian, you may need: sudo rm -rf \"$SCRIPT_DIR\")"
    echo ""
fi
