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

# 1. Stop and remove Docker containers
################################################################################
echo -e "${YELLOW}[1/7] Stopping and removing Docker containers...${NC}"

if command -v docker &> /dev/null; then
    # Check for running containers
    if docker compose ps -q &> /dev/null 2>&1 || [ -f "docker-compose.yml" ]; then
        if docker compose down 2>/dev/null || docker-compose down 2>/dev/null; then
            echo -e "${GREEN}✓ Containers stopped and removed${NC}"
            UNINSTALLED_ITEMS+=("Docker containers")
        else
            echo -e "${YELLOW}Warning: Could not stop containers (they may not be running)${NC}"
            KEPT_ITEMS+=("Docker containers (not found)")
        fi
    else
        echo -e "${YELLOW}No docker-compose.yml found or containers not running${NC}"
        KEPT_ITEMS+=("Docker containers (not found)")
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
    # List MeticAI-related images
    IMAGES=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "(meticai|coffee-relay|gemini-client|meticulous-mcp)" || true)
    
    if [ -n "$IMAGES" ]; then
        echo "Found MeticAI images:"
        echo "$IMAGES"
        echo ""
        read -r -p "Remove these Docker images? (y/n) [y]: " REMOVE_IMAGES </dev/tty
        REMOVE_IMAGES=${REMOVE_IMAGES:-y}
        
        if [[ "$REMOVE_IMAGES" =~ ^[Yy]$ ]]; then
            echo "$IMAGES" | xargs docker rmi -f 2>/dev/null || true
            echo -e "${GREEN}✓ Docker images removed${NC}"
            UNINSTALLED_ITEMS+=("Docker images")
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

# 4. Remove configuration files
################################################################################
echo -e "${YELLOW}[4/7] Removing configuration files...${NC}"

REMOVED_CONFIGS=0

if [ -f ".env" ]; then
    rm -f .env
    echo -e "${GREEN}✓ Removed .env file${NC}"
    ((REMOVED_CONFIGS++))
fi

if [ -f ".versions.json" ]; then
    rm -f .versions.json
    echo -e "${GREEN}✓ Removed .versions.json file${NC}"
    ((REMOVED_CONFIGS++))
fi

if [ -f ".update-config.json" ]; then
    rm -f .update-config.json
    echo -e "${GREEN}✓ Removed .update-config.json file${NC}"
    ((REMOVED_CONFIGS++))
fi

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
            
            # Remove from Dock
            defaults delete com.apple.dock persistent-apps 2>/dev/null || true
            killall Dock 2>/dev/null || true
            echo -e "${GREEN}✓ Removed from Dock${NC}"
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
echo -e "${YELLOW}Note: This directory ($(pwd)) still contains the MeticAI source code.${NC}"
echo -e "${YELLOW}You can safely delete it if you no longer need it:${NC}"
echo -e "${BLUE}  cd .. && rm -rf $(basename "$(pwd)")${NC}"
echo ""
