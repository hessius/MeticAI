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

# Text Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Constants
WEB_INSTALL_URL="https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh"

echo -e "${RED}=========================================${NC}"
echo -e "${RED}      ☕️ MeticAI Uninstaller 🗑️       ${NC}"
echo -e "${RED}=========================================${NC}"
echo ""
echo -e "${YELLOW}This will remove MeticAI from your system.${NC}"
echo ""

# Ask for confirmation
read -r -p "Are you sure you want to uninstall MeticAI? (y/n) [n]: " CONFIRM </dev/tty
CONFIRM=${CONFIRM:-n}

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Uninstallation cancelled.${NC}"
    exit 0
fi

echo ""
echo -e "${YELLOW}Starting uninstallation...${NC}"
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
echo -e "${YELLOW}[1/7] Stopping and removing Docker containers...${NC}"

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
                    echo -e "${GREEN}✓ Containers stopped and removed (with sudo)${NC}"
                else
                    echo -e "${GREEN}✓ Containers stopped and removed${NC}"
                fi
                UNINSTALLED_ITEMS+=("Docker containers")
            else
                echo -e "${YELLOW}Warning: Could not stop containers (they may not be running)${NC}"
                KEPT_ITEMS+=("Docker containers (not found)")
            fi
        else
            echo -e "${YELLOW}No containers found or not running${NC}"
            KEPT_ITEMS+=("Docker containers (not found)")
        fi
    else
        echo -e "${YELLOW}No docker-compose.yml found${NC}"
        KEPT_ITEMS+=("Docker containers (no compose file)")
    fi
else
    echo -e "${YELLOW}Docker not found, skipping container cleanup${NC}"
    KEPT_ITEMS+=("Docker containers (Docker not installed)")
fi

echo ""

# 2. Remove Docker images
################################################################################
echo -e "${YELLOW}[2/7] Removing Docker images...${NC}"

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
                    echo -e "${GREEN}✓ Docker images removed (with sudo)${NC}"
                    UNINSTALLED_ITEMS+=("Docker images")
                else
                    echo -e "${YELLOW}Warning: Could not remove images${NC}"
                    KEPT_ITEMS+=("Docker images (removal failed)")
                fi
            # Try removing without sudo first
            elif echo "$IMAGES" | xargs docker rmi -f 2>/dev/null; then
                echo -e "${GREEN}✓ Docker images removed${NC}"
                UNINSTALLED_ITEMS+=("Docker images")
            # Try with sudo on Linux if regular command failed
            elif [[ "$OSTYPE" != "darwin"* ]] && echo "$IMAGES" | xargs sudo docker rmi -f 2>/dev/null; then
                echo -e "${GREEN}✓ Docker images removed (with sudo)${NC}"
                UNINSTALLED_ITEMS+=("Docker images")
            else
                echo -e "${YELLOW}Warning: Could not remove images${NC}"
                KEPT_ITEMS+=("Docker images (removal failed)")
            fi
        else
            echo -e "${YELLOW}Keeping Docker images${NC}"
            KEPT_ITEMS+=("Docker images (user choice)")
        fi
    else
        echo -e "${YELLOW}No MeticAI images found${NC}"
        KEPT_ITEMS+=("Docker images (not found)")
    fi
else
    echo -e "${YELLOW}Docker not found, skipping image cleanup${NC}"
    KEPT_ITEMS+=("Docker images (Docker not installed)")
fi

echo ""

# 3. Remove cloned repositories
################################################################################
echo -e "${YELLOW}[3/7] Removing cloned repositories...${NC}"

REMOVED_REPOS=0

if [ -d "meticulous-source" ]; then
    rm -rf meticulous-source
    echo -e "${GREEN}✓ Removed meticulous-source directory${NC}"
    ((REMOVED_REPOS++))
fi

if [ -d "meticai-web" ]; then
    rm -rf meticai-web
    echo -e "${GREEN}✓ Removed meticai-web directory${NC}"
    ((REMOVED_REPOS++))
fi

if [ $REMOVED_REPOS -gt 0 ]; then
    UNINSTALLED_ITEMS+=("Cloned repositories ($REMOVED_REPOS)")
else
    echo -e "${YELLOW}No cloned repositories found${NC}"
    KEPT_ITEMS+=("Cloned repositories (not found)")
fi

echo ""

# 4. Remove configuration files (preserving .env and data for reinstallation)
################################################################################
echo -e "${YELLOW}[4/7] Handling configuration files...${NC}"

REMOVED_CONFIGS=0

# Preserve .env file for potential reinstallation
if [ -f ".env" ]; then
    echo -e "${BLUE}ℹ Preserving .env file for potential reinstallation${NC}"
    echo -e "${BLUE}  (Contains your GEMINI_API_KEY, METICULOUS_IP, PI_IP settings)${NC}"
    KEPT_ITEMS+=(".env file (preserved)")
fi

# Preserve data directory (contains profile history)
if [ -d "data" ]; then
    echo -e "${BLUE}ℹ Preserving data/ directory (contains profile history)${NC}"
    KEPT_ITEMS+=("data/ directory (preserved)")
fi

# Preserve logs directory
if [ -d "logs" ]; then
    echo -e "${BLUE}ℹ Preserving logs/ directory${NC}"
    KEPT_ITEMS+=("logs/ directory (preserved)")
fi

if [ -f ".versions.json" ]; then
    rm -f .versions.json
    echo -e "${GREEN}✓ Removed .versions.json file${NC}"
    ((REMOVED_CONFIGS++))
fi

# Note: .update-config.json is a source file and should not be removed

if [ -f ".rebuild-needed" ]; then
    rm -f .rebuild-needed
    echo -e "${GREEN}✓ Removed .rebuild-needed file${NC}"
    ((REMOVED_CONFIGS++))
fi

if [ -f ".rebuild-watcher.log" ]; then
    rm -f .rebuild-watcher.log
    echo -e "${GREEN}✓ Removed .rebuild-watcher.log file${NC}"
    ((REMOVED_CONFIGS++))
fi

if [ $REMOVED_CONFIGS -gt 0 ]; then
    UNINSTALLED_ITEMS+=("Configuration files ($REMOVED_CONFIGS)")
else
    echo -e "${YELLOW}No configuration files found${NC}"
    KEPT_ITEMS+=("Configuration files (not found)")
fi

echo ""

# 5. Remove macOS integrations
################################################################################
echo -e "${YELLOW}[5/7] Removing macOS integrations...${NC}"

REMOVED_MACOS=0

# Remove Dock shortcut
if [[ "$OSTYPE" == "darwin"* ]]; then
    APP_PATH="/Applications/MeticAI.app"
    if [ -d "$APP_PATH" ]; then
        echo -e "${YELLOW}Found MeticAI.app in Applications${NC}"
        read -r -p "Remove MeticAI from Applications and Dock? (y/n) [y]: " REMOVE_APP </dev/tty
        REMOVE_APP=${REMOVE_APP:-y}
        
        if [[ "$REMOVE_APP" =~ ^[Yy]$ ]]; then
            # Try to remove without sudo first
            if rm -rf "$APP_PATH" 2>/dev/null; then
                echo -e "${GREEN}✓ Removed MeticAI.app${NC}"
                ((REMOVED_MACOS++))
            else
                # Need sudo
                sudo rm -rf "$APP_PATH" 2>/dev/null
                echo -e "${GREEN}✓ Removed MeticAI.app (with sudo)${NC}"
                ((REMOVED_MACOS++))
            fi
            
            # Note: Removing the app from Dock programmatically is complex and risky
            # The Dock will automatically remove the icon when it detects the app is missing
            # User can also manually remove it by dragging the icon out of the Dock
            echo -e "${YELLOW}Note: MeticAI icon will disappear from Dock automatically or can be removed manually${NC}"
        else
            echo -e "${YELLOW}Keeping MeticAI.app${NC}"
            KEPT_ITEMS+=("macOS Dock shortcut (user choice)")
        fi
    fi
    
    # Uninstall rebuild watcher service
    PLIST_PATH="$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
    if [ -f "$PLIST_PATH" ]; then
        echo -e "${YELLOW}Found rebuild watcher service${NC}"
        read -r -p "Remove rebuild watcher service? (y/n) [y]: " REMOVE_WATCHER </dev/tty
        REMOVE_WATCHER=${REMOVE_WATCHER:-y}
        
        if [[ "$REMOVE_WATCHER" =~ ^[Yy]$ ]]; then
            launchctl unload "$PLIST_PATH" 2>/dev/null || true
            rm -f "$PLIST_PATH"
            echo -e "${GREEN}✓ Removed rebuild watcher service${NC}"
            ((REMOVED_MACOS++))
        else
            echo -e "${YELLOW}Keeping rebuild watcher service${NC}"
            KEPT_ITEMS+=("Rebuild watcher service (user choice)")
        fi
    fi
    
    if [ $REMOVED_MACOS -gt 0 ]; then
        UNINSTALLED_ITEMS+=("macOS integrations ($REMOVED_MACOS)")
    else
        if [ ! -d "$APP_PATH" ] && [ ! -f "$PLIST_PATH" ]; then
            echo -e "${YELLOW}No macOS integrations found${NC}"
            KEPT_ITEMS+=("macOS integrations (not found)")
        fi
    fi
else
    echo -e "${YELLOW}Not running on macOS, skipping${NC}"
    KEPT_ITEMS+=("macOS integrations (not macOS)")
fi

# Linux-specific (systemd) service cleanup
if [[ "$OSTYPE" == "linux"* ]]; then
    echo -e "${YELLOW}Checking for Linux systemd integrations...${NC}"
    REMOVED_LINUX=0
    
    # Check for systemd path unit
    if [ -f "/etc/systemd/system/meticai-rebuild-watcher.path" ]; then
        echo -e "${YELLOW}Found rebuild watcher systemd service${NC}"
        read -r -p "Remove rebuild watcher service? (y/n) [y]: " REMOVE_WATCHER </dev/tty
        REMOVE_WATCHER=${REMOVE_WATCHER:-y}
        
        if [[ "$REMOVE_WATCHER" =~ ^[Yy]$ ]]; then
            sudo systemctl stop meticai-rebuild-watcher.path 2>/dev/null || true
            sudo systemctl disable meticai-rebuild-watcher.path 2>/dev/null || true
            sudo rm -f /etc/systemd/system/meticai-rebuild-watcher.path
            sudo rm -f /etc/systemd/system/meticai-rebuild-watcher.service
            sudo systemctl daemon-reload
            echo -e "${GREEN}✓ Removed rebuild watcher systemd service${NC}"
            ((REMOVED_LINUX++))
        else
            echo -e "${YELLOW}Keeping rebuild watcher service${NC}"
            KEPT_ITEMS+=("Rebuild watcher service (user choice)")
        fi
    fi
    
    if [ $REMOVED_LINUX -gt 0 ]; then
        UNINSTALLED_ITEMS+=("Linux integrations ($REMOVED_LINUX)")
    fi
fi

echo ""

# 6. Ask about external dependencies
################################################################################
echo -e "${YELLOW}[6/7] External dependencies (optional)...${NC}"
echo ""
echo -e "${BLUE}MeticAI can optionally remove external dependencies that were installed${NC}"
echo -e "${BLUE}during setup. These are only removed if you explicitly choose to do so.${NC}"
echo ""
echo -e "${YELLOW}⚠️  WARNING: Only remove these if you don't use them for other projects!${NC}"
echo ""

# Docker
if command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker is installed on this system${NC}"
    read -r -p "Do you want to remove Docker? (y/n) [n]: " REMOVE_DOCKER </dev/tty
    REMOVE_DOCKER=${REMOVE_DOCKER:-n}
    
    if [[ "$REMOVE_DOCKER" =~ ^[Yy]$ ]]; then
        echo -e "${RED}Removing Docker...${NC}"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo -e "${YELLOW}On macOS, Docker Desktop must be uninstalled manually${NC}"
            echo -e "${YELLOW}Open /Applications and drag Docker.app to Trash${NC}"
            KEPT_ITEMS+=("Docker (manual removal required on macOS)")
        else
            # Linux uninstall
            if command -v apt-get &> /dev/null; then
                sudo apt-get remove -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
                echo -e "${GREEN}✓ Docker removed${NC}"
                UNINSTALLED_ITEMS+=("Docker")
            elif command -v dnf &> /dev/null; then
                sudo dnf remove -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
                echo -e "${GREEN}✓ Docker removed${NC}"
                UNINSTALLED_ITEMS+=("Docker")
            elif command -v yum &> /dev/null; then
                sudo yum remove -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
                echo -e "${GREEN}✓ Docker removed${NC}"
                UNINSTALLED_ITEMS+=("Docker")
            else
                echo -e "${YELLOW}Could not determine package manager for Docker removal${NC}"
                FAILED_ITEMS+=("Docker (unknown package manager)")
            fi
        fi
    else
        echo -e "${GREEN}Keeping Docker${NC}"
        KEPT_ITEMS+=("Docker (user choice)")
    fi
else
    KEPT_ITEMS+=("Docker (not installed)")
fi

echo ""

# Git
if command -v git &> /dev/null; then
    echo -e "${YELLOW}Git is installed on this system${NC}"
    read -r -p "Do you want to remove git? (y/n) [n]: " REMOVE_GIT </dev/tty
    REMOVE_GIT=${REMOVE_GIT:-n}
    
    if [[ "$REMOVE_GIT" =~ ^[Yy]$ ]]; then
        echo -e "${RED}Removing git...${NC}"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew uninstall git 2>/dev/null || true
                echo -e "${GREEN}✓ Git removed${NC}"
                UNINSTALLED_ITEMS+=("git")
            else
                echo -e "${YELLOW}Cannot remove git (not installed via Homebrew)${NC}"
                KEPT_ITEMS+=("git (not managed by Homebrew)")
            fi
        elif command -v apt-get &> /dev/null; then
            sudo apt-get remove -y git 2>/dev/null || true
            echo -e "${GREEN}✓ Git removed${NC}"
            UNINSTALLED_ITEMS+=("git")
        elif command -v dnf &> /dev/null; then
            sudo dnf remove -y git 2>/dev/null || true
            echo -e "${GREEN}✓ Git removed${NC}"
            UNINSTALLED_ITEMS+=("git")
        elif command -v yum &> /dev/null; then
            sudo yum remove -y git 2>/dev/null || true
            echo -e "${GREEN}✓ Git removed${NC}"
            UNINSTALLED_ITEMS+=("git")
        else
            echo -e "${YELLOW}Could not determine package manager for git removal${NC}"
            FAILED_ITEMS+=("git (unknown package manager)")
        fi
    else
        echo -e "${GREEN}Keeping git${NC}"
        KEPT_ITEMS+=("git (user choice)")
    fi
else
    KEPT_ITEMS+=("git (not installed)")
fi

echo ""

# qrencode
if command -v qrencode &> /dev/null; then
    echo -e "${YELLOW}qrencode is installed on this system${NC}"
    read -r -p "Do you want to remove qrencode? (y/n) [n]: " REMOVE_QRENCODE </dev/tty
    REMOVE_QRENCODE=${REMOVE_QRENCODE:-n}
    
    if [[ "$REMOVE_QRENCODE" =~ ^[Yy]$ ]]; then
        echo -e "${RED}Removing qrencode...${NC}"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew uninstall qrencode 2>/dev/null || true
                echo -e "${GREEN}✓ qrencode removed${NC}"
                UNINSTALLED_ITEMS+=("qrencode")
            else
                echo -e "${YELLOW}Cannot remove qrencode (not installed via Homebrew)${NC}"
                KEPT_ITEMS+=("qrencode (not managed by Homebrew)")
            fi
        elif command -v apt-get &> /dev/null; then
            sudo apt-get remove -y qrencode 2>/dev/null || true
            echo -e "${GREEN}✓ qrencode removed${NC}"
            UNINSTALLED_ITEMS+=("qrencode")
        elif command -v dnf &> /dev/null; then
            sudo dnf remove -y qrencode 2>/dev/null || true
            echo -e "${GREEN}✓ qrencode removed${NC}"
            UNINSTALLED_ITEMS+=("qrencode")
        elif command -v yum &> /dev/null; then
            sudo yum remove -y qrencode 2>/dev/null || true
            echo -e "${GREEN}✓ qrencode removed${NC}"
            UNINSTALLED_ITEMS+=("qrencode")
        else
            echo -e "${YELLOW}Could not determine package manager for qrencode removal${NC}"
            FAILED_ITEMS+=("qrencode (unknown package manager)")
        fi
    else
        echo -e "${GREEN}Keeping qrencode${NC}"
        KEPT_ITEMS+=("qrencode (user choice)")
    fi
else
    KEPT_ITEMS+=("qrencode (not installed)")
fi

echo ""

# 7. Summary
################################################################################
echo -e "${YELLOW}[7/7] Uninstallation complete!${NC}"
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

echo -e "${BLUE}Thank you for using MeticAI! ☕️${NC}"
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
            echo -e "${RED}Error: $INSTALL_SCRIPT not found.${NC}"
            echo -e "${YELLOW}Please run the installer manually:${NC}"
            
            # For web install method, provide the curl command
            if [[ "$METICAI_INSTALL_METHOD" == "web_install.sh" ]]; then
                echo -e "${BLUE}  curl -fsSL $WEB_INSTALL_URL | bash${NC}"
            else
                echo -e "${BLUE}  ./local-install.sh${NC}"
            fi
            echo ""
            exit 1
        fi
        
        if [ ! -x "$INSTALL_SCRIPT" ]; then
            echo -e "${YELLOW}Making $INSTALL_SCRIPT executable...${NC}"
            chmod +x "$INSTALL_SCRIPT"
        fi
        
        echo ""
        echo -e "${GREEN}Restarting installation flow...${NC}"
        echo ""
        # Clear the installer flag to avoid infinite loop
        unset METICAI_CALLED_FROM_INSTALLER
        unset METICAI_INSTALL_METHOD
        exec "$INSTALL_SCRIPT"
    else
        echo ""
        echo -e "${YELLOW}Installation not restarted.${NC}"
        echo -e "${YELLOW}You can run the installer manually later:${NC}"
        
        # For web install method, provide the curl command
        if [[ "$METICAI_INSTALL_METHOD" == "web_install.sh" ]]; then
            echo -e "${BLUE}  curl -fsSL $WEB_INSTALL_URL | bash${NC}"
        else
            echo -e "${BLUE}  $INSTALL_SCRIPT${NC}"
        fi
        echo ""
    fi
else
    # Standalone uninstall - show directory cleanup message
    echo -e "${YELLOW}Note: This directory ($(pwd)) still contains the MeticAI source code.${NC}"
    echo -e "${YELLOW}You can safely delete it if you no longer need it:${NC}"
    CURRENT_DIR_NAME=$(basename "$(pwd)")
    echo -e "${BLUE}  cd .. && rm -rf \"$CURRENT_DIR_NAME\"${NC}"
    echo ""
fi
