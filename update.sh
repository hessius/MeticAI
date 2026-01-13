#!/bin/bash

################################################################################
# MeticAI - Update Script
################################################################################
# 
# This script manages updates for MeticAI and all its dependencies.
#
# USAGE:
#   ./update.sh [OPTIONS]
#
# OPTIONS:
#   --check-only        Check for updates without applying them
#   --auto              Run non-interactively (auto-accept updates)
#   --switch-mcp-repo   Switch meticulous-mcp between fork and main repo
#   --help              Show this help message
#
# WHAT IT DOES:
#   1. Checks for updates to MeticAI main repository
#   2. Checks for updates to meticulous-mcp dependency
#   3. Checks for updates to meticai-web dependency
#   4. Optionally applies updates and rebuilds containers
#   5. Can switch between fork and main MCP repository
#
# DEPENDENCIES:
#   - Git
#   - Docker & Docker Compose
#
################################################################################

# Text Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="$SCRIPT_DIR/.versions.json"
MCP_FORK_URL="https://github.com/manonstreet/meticulous-mcp.git"
MCP_MAIN_URL="https://github.com/meticulous/meticulous-mcp.git"  # Placeholder for when fork merges
WEB_APP_URL="https://github.com/hessius/MeticAI-web.git"

# Parse command line arguments
CHECK_ONLY=false
AUTO_MODE=false
SWITCH_MCP_REPO=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --check-only)
            CHECK_ONLY=true
            shift
            ;;
        --auto)
            AUTO_MODE=true
            shift
            ;;
        --switch-mcp-repo)
            SWITCH_MCP_REPO=true
            shift
            ;;
        --help)
            head -n 30 "$0" | grep "^#" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Run with --help for usage information"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}      ☕️ MeticAI Update Manager 🔄     ${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Function to get current git commit hash
get_commit_hash() {
    local dir="$1"
    if [ -d "$dir/.git" ]; then
        cd "$dir" && git rev-parse HEAD 2>/dev/null
    else
        echo "not-a-git-repo"
    fi
}

# Function to get remote commit hash
get_remote_hash() {
    local dir="$1"
    local branch="${2:-main}"
    if [ -d "$dir/.git" ]; then
        cd "$dir" && git fetch origin "$branch" 2>/dev/null && git rev-parse "origin/$branch" 2>/dev/null
    else
        echo "not-a-git-repo"
    fi
}

# Function to get current branch
get_current_branch() {
    local dir="$1"
    if [ -d "$dir/.git" ]; then
        cd "$dir" && git rev-parse --abbrev-ref HEAD 2>/dev/null
    else
        echo "unknown"
    fi
}

# Function to get repository remote URL
get_remote_url() {
    local dir="$1"
    if [ -d "$dir/.git" ]; then
        cd "$dir" && git remote get-url origin 2>/dev/null
    else
        echo "unknown"
    fi
}

# Initialize versions file if it doesn't exist
initialize_versions_file() {
    if [ ! -f "$VERSION_FILE" ]; then
        echo "Initializing version tracking..."
        cat > "$VERSION_FILE" <<EOF
{
  "last_check": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repositories": {
    "meticai": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR")",
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "meticulous-mcp": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR/meticulous-source")",
      "repo_url": "$(get_remote_url "$SCRIPT_DIR/meticulous-source")",
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "meticai-web": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR/meticai-web")",
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    }
  }
}
EOF
        echo -e "${GREEN}✓ Version tracking initialized${NC}"
    fi
}

# Function to check if updates are available
check_for_updates() {
    local has_updates=false
    
    echo -e "${YELLOW}Checking for updates...${NC}"
    echo ""
    
    # Check main MeticAI repo
    echo "📦 MeticAI Main Repository"
    local meticai_current=$(get_commit_hash "$SCRIPT_DIR")
    local meticai_remote=$(get_remote_hash "$SCRIPT_DIR" "$(get_current_branch "$SCRIPT_DIR")")
    
    if [ "$meticai_current" != "$meticai_remote" ] && [ "$meticai_remote" != "not-a-git-repo" ]; then
        echo -e "   ${YELLOW}⚠ Update available${NC}"
        echo "   Current: ${meticai_current:0:8}"
        echo "   Latest:  ${meticai_remote:0:8}"
        has_updates=true
    else
        echo -e "   ${GREEN}✓ Up to date${NC}"
    fi
    echo ""
    
    # Check meticulous-mcp
    if [ -d "$SCRIPT_DIR/meticulous-source" ]; then
        echo "📦 Meticulous MCP"
        local mcp_current=$(get_commit_hash "$SCRIPT_DIR/meticulous-source")
        local mcp_branch=$(get_current_branch "$SCRIPT_DIR/meticulous-source")
        local mcp_remote=$(get_remote_hash "$SCRIPT_DIR/meticulous-source" "$mcp_branch")
        local mcp_url=$(get_remote_url "$SCRIPT_DIR/meticulous-source")
        
        echo "   Repository: $mcp_url"
        if [ "$mcp_current" != "$mcp_remote" ] && [ "$mcp_remote" != "not-a-git-repo" ]; then
            echo -e "   ${YELLOW}⚠ Update available${NC}"
            echo "   Current: ${mcp_current:0:8}"
            echo "   Latest:  ${mcp_remote:0:8}"
            has_updates=true
        else
            echo -e "   ${GREEN}✓ Up to date${NC}"
        fi
    else
        echo "📦 Meticulous MCP"
        echo -e "   ${RED}✗ Not installed${NC}"
        has_updates=true
    fi
    echo ""
    
    # Check meticai-web
    if [ -d "$SCRIPT_DIR/meticai-web" ]; then
        echo "📦 MeticAI Web Interface"
        local web_current=$(get_commit_hash "$SCRIPT_DIR/meticai-web")
        local web_branch=$(get_current_branch "$SCRIPT_DIR/meticai-web")
        local web_remote=$(get_remote_hash "$SCRIPT_DIR/meticai-web" "$web_branch")
        
        if [ "$web_current" != "$web_remote" ] && [ "$web_remote" != "not-a-git-repo" ]; then
            echo -e "   ${YELLOW}⚠ Update available${NC}"
            echo "   Current: ${web_current:0:8}"
            echo "   Latest:  ${web_remote:0:8}"
            has_updates=true
        else
            echo -e "   ${GREEN}✓ Up to date${NC}"
        fi
    else
        echo "📦 MeticAI Web Interface"
        echo -e "   ${RED}✗ Not installed${NC}"
        has_updates=true
    fi
    echo ""
    
    if $has_updates; then
        return 0  # Updates available
    else
        return 1  # No updates
    fi
}

# Function to update main repository
update_main_repo() {
    echo -e "${YELLOW}Updating MeticAI main repository...${NC}"
    cd "$SCRIPT_DIR"
    
    local current_branch=$(get_current_branch "$SCRIPT_DIR")
    if git pull origin "$current_branch"; then
        echo -e "${GREEN}✓ MeticAI updated successfully${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to update MeticAI${NC}"
        return 1
    fi
}

# Function to update or install meticulous-mcp
update_mcp() {
    if [ -d "$SCRIPT_DIR/meticulous-source" ]; then
        echo -e "${YELLOW}Updating Meticulous MCP...${NC}"
        cd "$SCRIPT_DIR/meticulous-source"
        
        local current_branch=$(get_current_branch "$SCRIPT_DIR/meticulous-source")
        if git pull origin "$current_branch"; then
            echo -e "${GREEN}✓ Meticulous MCP updated successfully${NC}"
            return 0
        else
            echo -e "${RED}✗ Failed to update Meticulous MCP${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}Installing Meticulous MCP...${NC}"
        cd "$SCRIPT_DIR"
        if git clone "$MCP_FORK_URL" meticulous-source; then
            echo -e "${GREEN}✓ Meticulous MCP installed successfully${NC}"
            return 0
        else
            echo -e "${RED}✗ Failed to install Meticulous MCP${NC}"
            return 1
        fi
    fi
}

# Function to update or install meticai-web
update_web() {
    if [ -d "$SCRIPT_DIR/meticai-web" ]; then
        echo -e "${YELLOW}Updating MeticAI Web Interface...${NC}"
        cd "$SCRIPT_DIR/meticai-web"
        
        local current_branch=$(get_current_branch "$SCRIPT_DIR/meticai-web")
        if git pull origin "$current_branch"; then
            echo -e "${GREEN}✓ MeticAI Web updated successfully${NC}"
            return 0
        else
            echo -e "${RED}✗ Failed to update MeticAI Web${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}Installing MeticAI Web Interface...${NC}"
        cd "$SCRIPT_DIR"
        if git clone "$WEB_APP_URL" meticai-web; then
            echo -e "${GREEN}✓ MeticAI Web installed successfully${NC}"
            
            # Generate config.json if needed
            if [ -f "$SCRIPT_DIR/.env" ]; then
                # shellcheck disable=SC1091
                source "$SCRIPT_DIR/.env"
                mkdir -p meticai-web/public
                cat > meticai-web/public/config.json <<WEBCONFIG
{
  "serverUrl": "http://$PI_IP:8000"
}
WEBCONFIG
                echo -e "${GREEN}✓ Web app configured${NC}"
            fi
            return 0
        else
            echo -e "${RED}✗ Failed to install MeticAI Web${NC}"
            return 1
        fi
    fi
}

# Function to switch MCP repository
switch_mcp_repository() {
    echo -e "${YELLOW}MCP Repository Switcher${NC}"
    echo ""
    
    if [ ! -d "$SCRIPT_DIR/meticulous-source" ]; then
        echo -e "${RED}Error: meticulous-source directory not found${NC}"
        echo "Please run the installer first."
        return 1
    fi
    
    local current_url=$(get_remote_url "$SCRIPT_DIR/meticulous-source")
    echo "Current repository: $current_url"
    echo ""
    echo "Available options:"
    echo "1) Fork: $MCP_FORK_URL"
    echo "2) Main: $MCP_MAIN_URL (use when fork is merged upstream)"
    echo ""
    
    if [ "$AUTO_MODE" = false ]; then
        read -r -p "Choose repository (1/2) [1]: " REPO_CHOICE </dev/tty
        REPO_CHOICE=${REPO_CHOICE:-1}
    else
        echo "Auto mode: keeping current repository"
        return 0
    fi
    
    local new_url=""
    case "$REPO_CHOICE" in
        1)
            new_url="$MCP_FORK_URL"
            ;;
        2)
            new_url="$MCP_MAIN_URL"
            ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            return 1
            ;;
    esac
    
    if [ "$current_url" = "$new_url" ]; then
        echo -e "${GREEN}Already using selected repository${NC}"
        return 0
    fi
    
    echo ""
    echo -e "${YELLOW}Switching to: $new_url${NC}"
    
    # Backup current state
    echo "Backing up current installation..."
    local backup_dir="$SCRIPT_DIR/meticulous-source.backup.$(date +%s)"
    cp -r "$SCRIPT_DIR/meticulous-source" "$backup_dir"
    
    # Remove old and clone new
    rm -rf "$SCRIPT_DIR/meticulous-source"
    
    if git clone "$new_url" "$SCRIPT_DIR/meticulous-source"; then
        echo -e "${GREEN}✓ Repository switched successfully${NC}"
        echo "Backup saved to: $backup_dir"
        echo ""
        echo -e "${YELLOW}Note: You should rebuild containers for changes to take effect${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to clone new repository${NC}"
        echo "Restoring backup..."
        mv "$backup_dir" "$SCRIPT_DIR/meticulous-source"
        return 1
    fi
}

# Function to rebuild and restart containers
rebuild_containers() {
    echo -e "${YELLOW}Rebuilding and restarting containers...${NC}"
    cd "$SCRIPT_DIR"
    
    # Check if docker compose is available
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        echo -e "${RED}Error: Docker Compose not found${NC}"
        return 1
    fi
    
    # Stop containers
    echo "Stopping containers..."
    if sudo $COMPOSE_CMD down; then
        echo -e "${GREEN}✓ Containers stopped${NC}"
    else
        echo -e "${YELLOW}Warning: Failed to stop containers (they may not be running)${NC}"
    fi
    
    # Rebuild and start
    echo "Building and starting containers..."
    if sudo $COMPOSE_CMD up -d --build; then
        echo -e "${GREEN}✓ Containers rebuilt and started${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to rebuild containers${NC}"
        return 1
    fi
}

# Function to update version file
update_version_file() {
    cat > "$VERSION_FILE" <<EOF
{
  "last_check": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repositories": {
    "meticai": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR")",
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "meticulous-mcp": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR/meticulous-source")",
      "repo_url": "$(get_remote_url "$SCRIPT_DIR/meticulous-source")",
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "meticai-web": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR/meticai-web")",
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    }
  }
}
EOF
}

# Main execution flow
main() {
    cd "$SCRIPT_DIR"
    
    # Initialize version tracking
    initialize_versions_file
    
    # Handle MCP repository switch if requested
    if $SWITCH_MCP_REPO; then
        switch_mcp_repository
        exit $?
    fi
    
    # Check for updates
    if check_for_updates; then
        # Updates are available
        if $CHECK_ONLY; then
            echo -e "${YELLOW}Updates are available. Run without --check-only to apply them.${NC}"
            exit 0
        fi
        
        # Ask user if they want to proceed
        if [ "$AUTO_MODE" = false ]; then
            echo ""
            read -r -p "Do you want to apply these updates? (y/n) [y]: " APPLY_UPDATES </dev/tty
            APPLY_UPDATES=${APPLY_UPDATES:-y}
            
            if [[ ! "$APPLY_UPDATES" =~ ^[Yy]$ ]]; then
                echo "Update cancelled."
                exit 0
            fi
        fi
        
        echo ""
        echo -e "${YELLOW}Applying updates...${NC}"
        echo ""
        
        # Update each component
        local update_success=true
        
        # Note: We don't update main repo automatically as user might have local changes
        # update_main_repo || update_success=false
        
        update_mcp || update_success=false
        update_web || update_success=false
        
        # Update version file
        update_version_file
        
        if $update_success; then
            echo ""
            echo -e "${GREEN}✓ All updates applied successfully${NC}"
            echo ""
            
            # Ask about rebuilding containers
            if [ "$AUTO_MODE" = false ]; then
                read -r -p "Do you want to rebuild and restart containers now? (y/n) [y]: " REBUILD </dev/tty
                REBUILD=${REBUILD:-y}
                
                if [[ "$REBUILD" =~ ^[Yy]$ ]]; then
                    echo ""
                    rebuild_containers
                fi
            else
                echo "Auto mode: rebuilding containers..."
                rebuild_containers
            fi
        else
            echo ""
            echo -e "${RED}Some updates failed. Please check the errors above.${NC}"
            exit 1
        fi
        
    else
        # No updates available
        echo -e "${GREEN}✓ Everything is up to date!${NC}"
        
        # Update version file with current check time
        update_version_file
    fi
    
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}      Update check complete! ✨         ${NC}"
    echo -e "${GREEN}=========================================${NC}"
}

# Run main function
main
