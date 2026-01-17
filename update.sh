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
#   --switch-mcp-repo   Check and apply central repository configuration
#   --help              Show this help message
#
# WHAT IT DOES:
#   1. Checks for updates to MeticAI main repository
#   2. Checks for updates to meticulous-mcp dependency
#   3. Checks for updates to meticai-web dependency
#   4. Automatically switches MCP repo based on central configuration
#   5. Optionally applies updates and rebuilds containers
#
# REPOSITORY SWITCHING:
#   The MCP repository URL is now controlled centrally via .update-config.json
#   When maintainers update this file, all users will automatically switch to
#   the new repository on their next update. No manual intervention required.
#
# DEPENDENCIES:
#   - Git
#   - Docker & Docker Compose
#   - curl or wget (for fetching central config)
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
CONFIG_URL="https://raw.githubusercontent.com/hessius/MeticAI/main/.update-config.json"
LOCAL_CONFIG_FILE="$SCRIPT_DIR/.update-config.json"

# Default URLs (used if config fetch fails)
MCP_FORK_URL="https://github.com/manonstreet/meticulous-mcp.git"
MCP_MAIN_URL="https://github.com/meticulous/meticulous-mcp.git"  # Placeholder for when fork merges
WEB_APP_URL="https://github.com/hessius/MeticAI-web.git"

# Global variables for update status (populated by check_for_updates)
UPDATE_AVAILABLE=false
METICAI_UPDATE_AVAILABLE=false
MCP_UPDATE_AVAILABLE=false
WEB_UPDATE_AVAILABLE=false
METICAI_REMOTE_HASH=""
MCP_REMOTE_HASH=""
WEB_REMOTE_HASH=""

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

# Function to fetch central configuration
fetch_central_config() {
    # Try to fetch the central config file
    if command -v curl &> /dev/null; then
        curl -fsSL "$CONFIG_URL" -o "$LOCAL_CONFIG_FILE" 2>/dev/null
        return $?
    elif command -v wget &> /dev/null; then
        wget -q -O "$LOCAL_CONFIG_FILE" "$CONFIG_URL" 2>/dev/null
        return $?
    else
        return 1
    fi
}

# Function to get preferred MCP repository URL from config
get_preferred_mcp_url() {
    # Try to fetch latest config
    fetch_central_config 2>/dev/null
    
    # Try to read from local config file
    if [ -f "$LOCAL_CONFIG_FILE" ]; then
        # Try new JSON structure first (v1.1+)
        local preferred_url=$(grep -A 1 '"meticulous-mcp"' "$LOCAL_CONFIG_FILE" | grep '"url"' | sed 's/.*"url"[^"]*"\([^"]*\)".*/\1/')
        
        # Fallback to old structure (v1.0)
        if [ -z "$preferred_url" ] || [ "$preferred_url" = "url" ]; then
            preferred_url=$(grep '"mcp_repo_url"' "$LOCAL_CONFIG_FILE" | sed 's/.*"mcp_repo_url"[^"]*"\([^"]*\)".*/\1/')
        fi
        
        if [ -n "$preferred_url" ] && [ "$preferred_url" != "url" ] && [ "$preferred_url" != "mcp_repo_url" ]; then
            echo "$preferred_url"
            return 0
        fi
    fi
    
    # Fallback to fork URL if config not available
    echo "$MCP_FORK_URL"
    return 0
}

# Function to get preferred Web App repository URL from config
get_preferred_web_url() {
    # Try to fetch latest config
    fetch_central_config 2>/dev/null
    
    # Try to read from local config file
    if [ -f "$LOCAL_CONFIG_FILE" ]; then
        # Extract web app URL from new JSON structure (v1.1+)
        local preferred_url=$(grep -A 1 '"meticai-web"' "$LOCAL_CONFIG_FILE" | grep '"url"' | sed 's/.*"url"[^"]*"\([^"]*\)".*/\1/')
        
        if [ -n "$preferred_url" ] && [ "$preferred_url" != "url" ]; then
            echo "$preferred_url"
            return 0
        fi
    fi
    
    # Fallback to default URL if config not available
    echo "$WEB_APP_URL"
    return 0
}

# Function to check if MCP repository needs switching
check_and_switch_mcp_repo() {
    if [ ! -d "$SCRIPT_DIR/meticulous-source" ]; then
        # Not installed yet, will use preferred URL during installation
        return 0
    fi
    
    local current_url=$(get_remote_url "$SCRIPT_DIR/meticulous-source")
    local preferred_url=$(get_preferred_mcp_url)
    
    # Normalize URLs for comparison (remove trailing slashes and .git)
    current_url=$(echo "$current_url" | sed 's/\.git$//' | sed 's/\/$//')
    preferred_url=$(echo "$preferred_url" | sed 's/\.git$//' | sed 's/\/$//')
    
    if [ "$current_url" != "$preferred_url" ]; then
        echo -e "${YELLOW}Repository switch detected!${NC}"
        echo "Current:  $current_url"
        echo "Required: $preferred_url"
        echo ""
        
        # Automatically switch in auto mode, or prompt in interactive mode
        local should_switch=false
        if [ "$AUTO_MODE" = true ]; then
            should_switch=true
            echo "Auto mode: switching automatically..."
        else
            read -r -p "Switch to required repository? (y/n) [y]: " SWITCH_CONFIRM </dev/tty
            SWITCH_CONFIRM=${SWITCH_CONFIRM:-y}
            if [[ "$SWITCH_CONFIRM" =~ ^[Yy]$ ]]; then
                should_switch=true
            fi
        fi
        
        if [ "$should_switch" = true ]; then
            perform_mcp_repo_switch "$preferred_url"
            return $?
        else
            echo -e "${YELLOW}Keeping current repository${NC}"
            return 0
        fi
    fi
    
    return 0
}

# Function to perform the actual repository switch
perform_mcp_repo_switch() {
    local new_url="$1"
    
    echo ""
    echo -e "${YELLOW}Switching MCP repository to: $new_url${NC}"
    
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
        echo -e "${YELLOW}Note: Containers will be rebuilt to apply changes${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to clone new repository${NC}"
        echo "Restoring backup..."
        mv "$backup_dir" "$SCRIPT_DIR/meticulous-source"
        return 1
    fi
}

# Function to check if Web App repository needs switching
check_and_switch_web_repo() {
    if [ ! -d "$SCRIPT_DIR/meticai-web" ]; then
        # Not installed yet, will use preferred URL during installation
        return 0
    fi
    
    local current_url=$(get_remote_url "$SCRIPT_DIR/meticai-web")
    local preferred_url=$(get_preferred_web_url)
    
    # Normalize URLs for comparison (remove trailing slashes and .git)
    current_url=$(echo "$current_url" | sed 's/\.git$//' | sed 's/\/$//')
    preferred_url=$(echo "$preferred_url" | sed 's/\.git$//' | sed 's/\/$//')
    
    if [ "$current_url" != "$preferred_url" ]; then
        echo -e "${YELLOW}Web App repository switch detected!${NC}"
        echo "Current:  $current_url"
        echo "Required: $preferred_url"
        echo ""
        
        # Automatically switch in auto mode, or prompt in interactive mode
        local should_switch=false
        if [ "$AUTO_MODE" = true ]; then
            should_switch=true
            echo "Auto mode: switching automatically..."
        else
            read -r -p "Switch to required repository? (y/n) [y]: " SWITCH_CONFIRM </dev/tty
            SWITCH_CONFIRM=${SWITCH_CONFIRM:-y}
            if [[ "$SWITCH_CONFIRM" =~ ^[Yy]$ ]]; then
                should_switch=true
            fi
        fi
        
        if [ "$should_switch" = true ]; then
            perform_web_repo_switch "$preferred_url"
            return $?
        else
            echo -e "${YELLOW}Keeping current repository${NC}"
            return 0
        fi
    fi
    
    return 0
}

# Function to perform the actual Web App repository switch
perform_web_repo_switch() {
    local new_url="$1"
    
    echo ""
    echo -e "${YELLOW}Switching Web App repository to: $new_url${NC}"
    
    # Backup current state
    echo "Backing up current installation..."
    local backup_dir="$SCRIPT_DIR/meticai-web.backup.$(date +%s)"
    cp -r "$SCRIPT_DIR/meticai-web" "$backup_dir"
    
    # Remove old and clone new
    rm -rf "$SCRIPT_DIR/meticai-web"
    
    if git clone "$new_url" "$SCRIPT_DIR/meticai-web"; then
        echo -e "${GREEN}✓ Repository switched successfully${NC}"
        echo "Backup saved to: $backup_dir"
        
        # Regenerate config.json if .env exists
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
        
        echo ""
        echo -e "${YELLOW}Note: Containers will be rebuilt to apply changes${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to clone new repository${NC}"
        echo "Restoring backup..."
        mv "$backup_dir" "$SCRIPT_DIR/meticai-web"
        return 1
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
    METICAI_REMOTE_HASH="$meticai_remote"
    
    if [ "$meticai_current" != "$meticai_remote" ] && [ "$meticai_remote" != "not-a-git-repo" ]; then
        echo -e "   ${YELLOW}⚠ Update available${NC}"
        echo "   Current: ${meticai_current:0:8}"
        echo "   Latest:  ${meticai_remote:0:8}"
        has_updates=true
        METICAI_UPDATE_AVAILABLE=true
    else
        echo -e "   ${GREEN}✓ Up to date${NC}"
        METICAI_UPDATE_AVAILABLE=false
    fi
    echo ""
    
    # Check meticulous-mcp
    if [ -d "$SCRIPT_DIR/meticulous-source" ]; then
        echo "📦 Meticulous MCP"
        local mcp_current=$(get_commit_hash "$SCRIPT_DIR/meticulous-source")
        local mcp_branch=$(get_current_branch "$SCRIPT_DIR/meticulous-source")
        local mcp_remote=$(get_remote_hash "$SCRIPT_DIR/meticulous-source" "$mcp_branch")
        local mcp_url=$(get_remote_url "$SCRIPT_DIR/meticulous-source")
        MCP_REMOTE_HASH="$mcp_remote"
        
        echo "   Repository: $mcp_url"
        if [ "$mcp_current" != "$mcp_remote" ] && [ "$mcp_remote" != "not-a-git-repo" ]; then
            echo -e "   ${YELLOW}⚠ Update available${NC}"
            echo "   Current: ${mcp_current:0:8}"
            echo "   Latest:  ${mcp_remote:0:8}"
            has_updates=true
            MCP_UPDATE_AVAILABLE=true
        else
            echo -e "   ${GREEN}✓ Up to date${NC}"
            MCP_UPDATE_AVAILABLE=false
        fi
    else
        echo "📦 Meticulous MCP"
        echo -e "   ${RED}✗ Not installed${NC}"
        has_updates=true
        MCP_UPDATE_AVAILABLE=true
        MCP_REMOTE_HASH="not-installed"
    fi
    echo ""
    
    # Check meticai-web
    if [ -d "$SCRIPT_DIR/meticai-web" ]; then
        echo "📦 MeticAI Web Interface"
        local web_current=$(get_commit_hash "$SCRIPT_DIR/meticai-web")
        local web_branch=$(get_current_branch "$SCRIPT_DIR/meticai-web")
        local web_remote=$(get_remote_hash "$SCRIPT_DIR/meticai-web" "$web_branch")
        WEB_REMOTE_HASH="$web_remote"
        
        if [ "$web_current" != "$web_remote" ] && [ "$web_remote" != "not-a-git-repo" ]; then
            echo -e "   ${YELLOW}⚠ Update available${NC}"
            echo "   Current: ${web_current:0:8}"
            echo "   Latest:  ${web_remote:0:8}"
            has_updates=true
            WEB_UPDATE_AVAILABLE=true
        else
            echo -e "   ${GREEN}✓ Up to date${NC}"
            WEB_UPDATE_AVAILABLE=false
        fi
    else
        echo "📦 MeticAI Web Interface"
        echo -e "   ${RED}✗ Not installed${NC}"
        has_updates=true
        WEB_UPDATE_AVAILABLE=true
        WEB_REMOTE_HASH="not-installed"
    fi
    echo ""
    
    # Store overall update status in global variable
    UPDATE_AVAILABLE=$has_updates
    
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
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        echo -e "${YELLOW}Warning: You have uncommitted changes. Stashing them...${NC}"
        git stash push -m "Auto-stash before MeticAI update $(date +%Y-%m-%d_%H:%M:%S)"
        local stashed=true
    fi
    
    # Try fast-forward first, then rebase if needed
    if git pull --ff-only origin "$current_branch" 2>/dev/null; then
        echo -e "${GREEN}✓ MeticAI updated successfully${NC}"
        [ "$stashed" = true ] && git stash pop 2>/dev/null || true
        return 0
    fi
    
    # Fast-forward failed, try rebase
    echo -e "${YELLOW}Fast-forward not possible, attempting rebase...${NC}"
    if git pull --rebase origin "$current_branch"; then
        echo -e "${GREEN}✓ MeticAI updated successfully (with rebase)${NC}"
        [ "$stashed" = true ] && git stash pop 2>/dev/null || true
        return 0
    else
        echo -e "${RED}✗ Failed to update MeticAI${NC}"
        echo -e "${YELLOW}You may have local changes that conflict with remote.${NC}"
        echo -e "${YELLOW}Please resolve manually: git pull --rebase origin $current_branch${NC}"
        [ "$stashed" = true ] && git stash pop 2>/dev/null || true
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
        
        # Use preferred URL from central config
        local preferred_url=$(get_preferred_mcp_url)
        
        if git clone "$preferred_url" meticulous-source; then
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
        
        # Use preferred URL from central config
        local preferred_url=$(get_preferred_web_url)
        
        if git clone "$preferred_url" meticai-web; then
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

# Function to rebuild and restart containers
rebuild_containers() {
    echo -e "${YELLOW}Rebuilding and restarting containers...${NC}"
    cd "$SCRIPT_DIR"
    
    # Ensure .versions.json exists as a file (not directory) before Docker mounts it
    # Docker will create a directory if the file doesn't exist, causing mount errors
    if [ -d "$SCRIPT_DIR/.versions.json" ]; then
        echo -e "${YELLOW}Fixing .versions.json (was directory, converting to file)...${NC}"
        rm -rf "$SCRIPT_DIR/.versions.json"
    fi
    if [ ! -f "$SCRIPT_DIR/.versions.json" ]; then
        echo '{}' > "$SCRIPT_DIR/.versions.json"
    fi
    
    # Check if docker compose is available
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        echo -e "${RED}Error: Docker Compose not found${NC}"
        return 1
    fi
    
    # Determine if we need sudo (not needed inside containers or if user has docker access)
    SUDO_PREFIX=""
    if ! docker info &> /dev/null; then
        # Docker not accessible, try with sudo
        if command -v sudo &> /dev/null && sudo docker info &> /dev/null; then
            SUDO_PREFIX="sudo"
        else
            echo -e "${RED}Error: Cannot access Docker daemon${NC}"
            return 1
        fi
    fi
    
    # Check if we're running inside a container (to avoid stopping ourselves)
    INSIDE_CONTAINER=false
    if [ -f "/.dockerenv" ] || grep -q docker /proc/1/cgroup 2>/dev/null; then
        INSIDE_CONTAINER=true
        echo -e "${YELLOW}Running inside container - will rebuild without stopping self${NC}"
    fi
    
    if [ "$INSIDE_CONTAINER" = true ]; then
        # When inside container, we can only rebuild containers that don't have
        # host filesystem mounts (due to Docker Desktop path restrictions on macOS).
        # Use explicit project name to match the host-started containers.
        local PROJECT_NAME="meticai"
        echo "Rebuilding containers..."
        
        # Note: gemini-client and meticai-web have volume mounts that reference
        # host paths. When running docker compose from inside a container, these
        # paths resolve incorrectly. Only meticulous-mcp can be rebuilt this way.
        
        # Build and restart meticulous-mcp (no problematic mounts)
        echo "  Building meticulous-mcp..."
        if $SUDO_PREFIX $COMPOSE_CMD -p "$PROJECT_NAME" up -d --build --force-recreate --no-deps meticulous-mcp 2>&1; then
            echo -e "${GREEN}  ✓ meticulous-mcp rebuilt${NC}"
        else
            echo -e "${YELLOW}  Warning: Failed to rebuild meticulous-mcp${NC}"
        fi
        
        # Create a flag file to signal the host-side rebuild watcher
        # The rebuild-watcher.sh script on the host will pick this up
        local REBUILD_FLAG="$SCRIPT_DIR/.rebuild-needed"
        cat > "$REBUILD_FLAG" <<REBUILD_EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "reason": "Container update triggered from web UI",
  "containers": ["coffee-relay", "gemini-client", "meticai-web"]
}
REBUILD_EOF
        
        echo ""
        echo -e "${YELLOW}Note: Some containers require host-side rebuild.${NC}"
        echo -e "${YELLOW}Rebuild flag created at: $REBUILD_FLAG${NC}"
        echo ""
        echo -e "${BLUE}Options to complete the update:${NC}"
        echo -e "  1. If rebuild-watcher is installed, it will auto-rebuild"
        echo -e "  2. Run on host: ./rebuild-watcher.sh"
        echo -e "  3. Run on host: docker compose up -d --build"
        echo ""
        echo -e "${GREEN}✓ Available containers rebuilt${NC}"
        return 0
    else
        # Standard rebuild when running on host
        echo "Stopping containers..."
        if $SUDO_PREFIX $COMPOSE_CMD down --remove-orphans 2>/dev/null; then
            echo -e "${GREEN}✓ Containers stopped${NC}"
        else
            echo -e "${YELLOW}Warning: Failed to stop containers (they may not be running)${NC}"
        fi
        
        # Rebuild and start
        echo "Building and starting containers..."
        if $SUDO_PREFIX $COMPOSE_CMD up -d --build; then
            echo -e "${GREEN}✓ Containers rebuilt and started${NC}"
            return 0
        else
            echo -e "${RED}✗ Failed to rebuild containers${NC}"
            return 1
        fi
    fi
}

# Function to update version file
update_version_file() {
    cat > "$VERSION_FILE" <<EOF
{
  "last_check": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "update_available": $UPDATE_AVAILABLE,
  "repositories": {
    "meticai": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR")",
      "remote_hash": "$METICAI_REMOTE_HASH",
      "update_available": $METICAI_UPDATE_AVAILABLE,
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "meticulous-mcp": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR/meticulous-source")",
      "remote_hash": "$MCP_REMOTE_HASH",
      "update_available": $MCP_UPDATE_AVAILABLE,
      "repo_url": "$(get_remote_url "$SCRIPT_DIR/meticulous-source")",
      "last_updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "meticai-web": {
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR/meticai-web")",
      "remote_hash": "$WEB_REMOTE_HASH",
      "update_available": $WEB_UPDATE_AVAILABLE,
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
    
    # Handle MCP repository switch if requested (deprecated - now automatic)
    if $SWITCH_MCP_REPO; then
        echo -e "${YELLOW}Note: Repository switching is now automatic based on central configuration.${NC}"
        echo -e "${YELLOW}Checking for required repositories...${NC}"
        echo ""
        check_and_switch_mcp_repo
        check_and_switch_web_repo
        exit $?
    fi
    
    # Check if repositories need switching (automatic based on central config)
    check_and_switch_mcp_repo
    check_and_switch_web_repo
    
    # Check for updates
    if check_for_updates; then
        # Updates are available - always save status to version file
        update_version_file
        
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
        
        # Update main repo first (contains update script, docker-compose, etc.)
        if [ "$METICAI_UPDATE_AVAILABLE" = true ]; then
            update_main_repo || update_success=false
        fi
        
        update_mcp || update_success=false
        update_web || update_success=false
        
        # Update version file again after applying updates (to clear update_available flags)
        # Re-check to update the global variables
        check_for_updates >/dev/null 2>&1 || true
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
