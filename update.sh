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

# Text Colors removed - now using common.sh

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common library
source "$SCRIPT_DIR/scripts/lib/common.sh"

VERSION_FILE="$SCRIPT_DIR/.versions.json"
CONFIG_URL="https://raw.githubusercontent.com/hessius/MeticAI/main/.update-config.json"
LOCAL_CONFIG_FILE="$SCRIPT_DIR/.update-config.json"

# Default URLs (used if config fetch fails)
MCP_FORK_URL="https://github.com/hessius/meticulous-mcp.git"
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
METICAI_LOCAL_VERSION=""
METICAI_REMOTE_VERSION=""
WEB_LOCAL_VERSION=""
WEB_REMOTE_VERSION=""

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
            log_error "Unknown option: $1"
            echo "Run with --help for usage information"
            exit 1
            ;;
    esac
done

log_info "========================================="
log_info "      ☕️ MeticAI Update Manager 🔄     "
log_info "========================================="
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
        # Try to fetch first (may fail due to permissions)
        local fetch_result
        fetch_result=$(cd "$dir" && git fetch origin "$branch" 2>&1)
        
        # If fetch failed due to permissions, try ls-remote as fallback
        if echo "$fetch_result" | grep -q "Permission denied"; then
            local remote_url
            remote_url=$(cd "$dir" && git config --get remote.origin.url 2>/dev/null)
            if [ -n "$remote_url" ] && [ "$remote_url" != "unknown" ]; then
                # Use ls-remote which doesn't require write access
                git ls-remote "$remote_url" "refs/heads/$branch" 2>/dev/null | awk '{print $1}'
                return
            fi
        fi
        
        # Try to get the remote hash
        cd "$dir" && git rev-parse "origin/$branch" 2>/dev/null
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
        local url
        url=$(cd "$dir" && git config --get remote.origin.url 2>/dev/null)
        if [ -n "$url" ]; then
            echo "$url"
        else
            echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

# Function to read local VERSION file
get_local_version() {
    local dir="$1"
    local version_file="$dir/VERSION"
    if [ -f "$version_file" ]; then
        cat "$version_file" | tr -d '[:space:]'
    else
        echo "0.0.0"
    fi
}

# Function to fetch remote VERSION file from GitHub
get_remote_version() {
    local repo_owner="$1"
    local repo_name="$2"
    local branch="${3:-main}"
    local url="https://raw.githubusercontent.com/${repo_owner}/${repo_name}/${branch}/VERSION"
    
    local version
    if command -v curl &> /dev/null; then
        version=$(curl -fsSL "$url" 2>/dev/null | tr -d '[:space:]')
    elif command -v wget &> /dev/null; then
        version=$(wget -qO- "$url" 2>/dev/null | tr -d '[:space:]')
    fi
    
    if [ -n "$version" ] && [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
        echo "$version"
    else
        echo "0.0.0"
    fi
}

# Function to compare semantic versions
# Returns 0 if version1 > version2, 1 otherwise
version_greater_than() {
    local version1="$1"
    local version2="$2"
    
    # Handle edge cases
    if [ "$version1" = "$version2" ]; then
        return 1
    fi
    if [ "$version1" = "0.0.0" ]; then
        return 1
    fi
    if [ "$version2" = "0.0.0" ]; then
        return 0
    fi
    
    # Split versions into arrays
    IFS='.' read -ra v1_parts <<< "$version1"
    IFS='.' read -ra v2_parts <<< "$version2"
    
    # Compare each part
    for i in 0 1 2; do
        local v1_part="${v1_parts[$i]:-0}"
        local v2_part="${v2_parts[$i]:-0}"
        
        # Remove any non-numeric suffix (e.g., -beta)
        v1_part="${v1_part%%[!0-9]*}"
        v2_part="${v2_part%%[!0-9]*}"
        
        if [ "$v1_part" -gt "$v2_part" ] 2>/dev/null; then
            return 0
        elif [ "$v1_part" -lt "$v2_part" ] 2>/dev/null; then
            return 1
        fi
    done
    
    return 1  # Versions are equal
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
    
    # Handle case where remote is not configured (unknown)
    if [ "$current_url" = "unknown" ]; then
        log_warning "MCP repository has no remote configured. Setting up remote..."
        if cd "$SCRIPT_DIR/meticulous-source" && git remote add origin "$preferred_url" 2>/dev/null; then
            log_success "Remote 'origin' configured to: $preferred_url"
            git fetch origin 2>/dev/null || true
        elif cd "$SCRIPT_DIR/meticulous-source" && git remote set-url origin "$preferred_url" 2>/dev/null; then
            log_success "Remote 'origin' updated to: $preferred_url"
            git fetch origin 2>/dev/null || true
        fi
        cd "$SCRIPT_DIR"
        return 0
    fi
    
    # Normalize URLs for comparison (remove trailing slashes and .git)
    local current_normalized=$(echo "$current_url" | sed 's/\.git$//' | sed 's/\/$//')
    local preferred_normalized=$(echo "$preferred_url" | sed 's/\.git$//' | sed 's/\/$//')
    
    if [ "$current_normalized" != "$preferred_normalized" ]; then
        log_warning "Repository switch detected!"
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
            log_warning "Keeping current repository"
            return 0
        fi
    fi
    
    return 0
}

# Function to perform the actual repository switch
perform_mcp_repo_switch() {
    local new_url="$1"
    
    echo ""
    log_warning "Switching MCP repository to: $new_url"
    
    # Backup current state
    echo "Backing up current installation..."
    local backup_dir="$SCRIPT_DIR/meticulous-source.backup.$(date +%s)"
    cp -r "$SCRIPT_DIR/meticulous-source" "$backup_dir"
    
    # Remove old and clone new
    rm -rf "$SCRIPT_DIR/meticulous-source"
    
    if git clone "$new_url" "$SCRIPT_DIR/meticulous-source"; then
        log_success "Repository switched successfully"
        echo "Backup saved to: $backup_dir"
        echo ""
        log_warning "Note: Containers will be rebuilt to apply changes"
        return 0
    else
        log_error "Failed to clone new repository"
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
    
    # Handle case where remote is not configured (unknown)
    if [ "$current_url" = "unknown" ]; then
        log_warning "Web App repository has no remote configured. Setting up remote..."
        if cd "$SCRIPT_DIR/meticai-web" && git remote add origin "$preferred_url" 2>/dev/null; then
            log_success "Remote 'origin' configured to: $preferred_url"
            git fetch origin 2>/dev/null || true
        elif cd "$SCRIPT_DIR/meticai-web" && git remote set-url origin "$preferred_url" 2>/dev/null; then
            log_success "Remote 'origin' updated to: $preferred_url"
            git fetch origin 2>/dev/null || true
        fi
        cd "$SCRIPT_DIR"
        return 0
    fi
    
    # Normalize URLs for comparison (remove trailing slashes and .git)
    local current_normalized=$(echo "$current_url" | sed 's/\.git$//' | sed 's/\/$//')
    local preferred_normalized=$(echo "$preferred_url" | sed 's/\.git$//' | sed 's/\/$//')
    
    if [ "$current_normalized" != "$preferred_normalized" ]; then
        log_warning "Web App repository switch detected!"
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
            log_warning "Keeping current repository"
            return 0
        fi
    fi
    
    return 0
}

# Function to perform the actual Web App repository switch
perform_web_repo_switch() {
    local new_url="$1"
    
    echo ""
    log_warning "Switching Web App repository to: $new_url"
    
    # Backup current state
    echo "Backing up current installation..."
    local backup_dir="$SCRIPT_DIR/meticai-web.backup.$(date +%s)"
    cp -r "$SCRIPT_DIR/meticai-web" "$backup_dir"
    
    # Remove old and clone new
    rm -rf "$SCRIPT_DIR/meticai-web"
    
    if git clone "$new_url" "$SCRIPT_DIR/meticai-web"; then
        log_success "Repository switched successfully"
        echo "Backup saved to: $backup_dir"
        
        # Regenerate config.json if .env exists
        if [ -f "$SCRIPT_DIR/.env" ]; then
            # shellcheck disable=SC1091
            source "$SCRIPT_DIR/.env"
            mkdir -p meticai-web/public
            # Fix: Remove config.json if it's a directory (both locations)
            if [ -d "meticai-web/config.json" ]; then
                rm -rf meticai-web/config.json
            fi
            if [ -d "meticai-web/public/config.json" ]; then
                rm -rf meticai-web/public/config.json
            fi
            cat > meticai-web/public/config.json <<WEBCONFIG
{
  "serverUrl": "http://$PI_IP:8000"
}
WEBCONFIG
            # Also create in meticai-web root for standalone docker-compose usage
            cp meticai-web/public/config.json meticai-web/config.json
            log_success "Web app configured"
        fi
        
        echo ""
        log_warning "Note: Containers will be rebuilt to apply changes"
        return 0
    else
        log_error "Failed to clone new repository"
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
        log_success "Version tracking initialized"
    fi
}

# Function to check if updates are available
check_for_updates() {
    local has_updates=false
    
    log_warning "Checking for updates..."
    echo ""
    
    # Check main MeticAI repo (using semantic versioning)
    echo "📦 MeticAI Main Repository"
    METICAI_LOCAL_VERSION=$(get_local_version "$SCRIPT_DIR")
    METICAI_REMOTE_VERSION=$(get_remote_version "hessius" "MeticAI" "main")
    
    if version_greater_than "$METICAI_REMOTE_VERSION" "$METICAI_LOCAL_VERSION"; then
        log_warning "   Update available"
        echo "   Current: v${METICAI_LOCAL_VERSION}"
        echo "   Latest:  v${METICAI_REMOTE_VERSION}"
        has_updates=true
        METICAI_UPDATE_AVAILABLE=true
    else
        log_success "   Up to date (v${METICAI_LOCAL_VERSION})"
        METICAI_UPDATE_AVAILABLE=false
    fi
    echo ""
    
    # Check meticulous-mcp (still uses commit-based checking - external dependency)
    if [ -d "$SCRIPT_DIR/meticulous-source" ]; then
        echo "📦 Meticulous MCP"
        local mcp_current=$(get_commit_hash "$SCRIPT_DIR/meticulous-source")
        local mcp_branch=$(get_current_branch "$SCRIPT_DIR/meticulous-source")
        local mcp_remote=$(get_remote_hash "$SCRIPT_DIR/meticulous-source" "$mcp_branch")
        local mcp_url=$(get_remote_url "$SCRIPT_DIR/meticulous-source")
        MCP_REMOTE_HASH="$mcp_remote"
        
        echo "   Repository: $mcp_url"
        if [ "$mcp_current" != "$mcp_remote" ] && [ "$mcp_remote" != "not-a-git-repo" ]; then
            log_warning "   Update available"
            echo "   Current: ${mcp_current:0:8}"
            echo "   Latest:  ${mcp_remote:0:8}"
            has_updates=true
            MCP_UPDATE_AVAILABLE=true
        else
            log_success "   Up to date"
            MCP_UPDATE_AVAILABLE=false
        fi
    else
        echo "📦 Meticulous MCP"
        log_error "   Not installed"
        has_updates=true
        MCP_UPDATE_AVAILABLE=true
        MCP_REMOTE_HASH="not-installed"
    fi
    echo ""
    
    # Check meticai-web (using semantic versioning)
    if [ -d "$SCRIPT_DIR/meticai-web" ]; then
        echo "📦 MeticAI Web Interface"
        WEB_LOCAL_VERSION=$(get_local_version "$SCRIPT_DIR/meticai-web")
        WEB_REMOTE_VERSION=$(get_remote_version "hessius" "MeticAI-web" "main")
        
        if version_greater_than "$WEB_REMOTE_VERSION" "$WEB_LOCAL_VERSION"; then
            log_warning "   Update available"
            echo "   Current: v${WEB_LOCAL_VERSION}"
            echo "   Latest:  v${WEB_REMOTE_VERSION}"
            has_updates=true
            WEB_UPDATE_AVAILABLE=true
        else
            log_success "   Up to date (v${WEB_LOCAL_VERSION})"
            WEB_UPDATE_AVAILABLE=false
        fi
    else
        echo "📦 MeticAI Web Interface"
        log_error "   Not installed"
        has_updates=true
        WEB_UPDATE_AVAILABLE=true
        WEB_REMOTE_VERSION="not-installed"
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
    log_warning "Updating MeticAI main repository..."
    cd "$SCRIPT_DIR"
    
    local current_branch=$(get_current_branch "$SCRIPT_DIR")
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        log_warning "Warning: You have uncommitted changes. Stashing them..."
        git stash push -m "Auto-stash before MeticAI update $(date +%Y-%m-%d_%H:%M:%S)"
        local stashed=true
    fi
    
    # Try fast-forward first, then rebase if needed
    if git pull --ff-only origin "$current_branch" 2>/dev/null; then
        log_success "MeticAI updated successfully"
        [ "$stashed" = true ] && git stash pop 2>/dev/null || true
        return 0
    fi
    
    # Fast-forward failed, try rebase
    log_warning "Fast-forward not possible, attempting rebase..."
    if git pull --rebase origin "$current_branch"; then
        log_success "MeticAI updated successfully (with rebase)"
        [ "$stashed" = true ] && git stash pop 2>/dev/null || true
        return 0
    else
        log_error "Failed to update MeticAI"
        log_warning "You may have local changes that conflict with remote."
        log_warning "Please resolve manually: git pull --rebase origin $current_branch"
        [ "$stashed" = true ] && git stash pop 2>/dev/null || true
        return 1
    fi
}

# Function to update or install meticulous-mcp
update_mcp() {
    if [ -d "$SCRIPT_DIR/meticulous-source" ]; then
        log_warning "Updating Meticulous MCP..."
        cd "$SCRIPT_DIR/meticulous-source"
        
        local current_branch=$(get_current_branch "$SCRIPT_DIR/meticulous-source")
        if git pull origin "$current_branch"; then
            log_success "Meticulous MCP updated successfully"
            return 0
        else
            log_error "Failed to update Meticulous MCP"
            return 1
        fi
    else
        log_warning "Installing Meticulous MCP..."
        cd "$SCRIPT_DIR"
        
        # Use preferred URL from central config
        local preferred_url=$(get_preferred_mcp_url)
        
        if git clone "$preferred_url" meticulous-source; then
            log_success "Meticulous MCP installed successfully"
            return 0
        else
            log_error "Failed to install Meticulous MCP"
            return 1
        fi
    fi
}

# Function to update or install meticai-web
update_web() {
    if [ -d "$SCRIPT_DIR/meticai-web" ]; then
        log_warning "Updating MeticAI Web Interface..."
        cd "$SCRIPT_DIR/meticai-web"
        
        local current_branch=$(get_current_branch "$SCRIPT_DIR/meticai-web")
        if git pull origin "$current_branch"; then
            log_success "MeticAI Web updated successfully"
            return 0
        else
            log_error "Failed to update MeticAI Web"
            return 1
        fi
    else
        log_warning "Installing MeticAI Web Interface..."
        cd "$SCRIPT_DIR"
        
        # Use preferred URL from central config
        local preferred_url=$(get_preferred_web_url)
        
        if git clone "$preferred_url" meticai-web; then
            log_success "MeticAI Web installed successfully"
            
            # Generate config.json if needed
            if [ -f "$SCRIPT_DIR/.env" ]; then
                # shellcheck disable=SC1091
                source "$SCRIPT_DIR/.env"
                mkdir -p meticai-web/public
                # Fix: Remove config.json if it's a directory (both locations)
                if [ -d "meticai-web/config.json" ]; then
                    rm -rf meticai-web/config.json
                fi
                if [ -d "meticai-web/public/config.json" ]; then
                    rm -rf meticai-web/public/config.json
                fi
                cat > meticai-web/public/config.json <<WEBCONFIG
{
  "serverUrl": "http://$PI_IP:8000"
}
WEBCONFIG
                # Also create in meticai-web root for standalone docker-compose usage
                cp meticai-web/public/config.json meticai-web/config.json
                log_success "Web app configured"
            fi
            return 0
        else
            log_error "Failed to install MeticAI Web"
            return 1
        fi
    fi
}

# Function to rebuild and restart containers
rebuild_containers() {
    log_warning "Rebuilding and restarting containers..."
    cd "$SCRIPT_DIR"
    
    # Ensure .versions.json exists as a file (not directory) before Docker mounts it
    # Docker will create a directory if the file doesn't exist, causing mount errors
    if [ -d "$SCRIPT_DIR/.versions.json" ]; then
        log_warning "Fixing .versions.json (was directory, converting to file)..."
        rm -rf "$SCRIPT_DIR/.versions.json"
    fi
    if [ ! -f "$SCRIPT_DIR/.versions.json" ]; then
        echo '{}' > "$SCRIPT_DIR/.versions.json"
    fi
    
    # Ensure .rebuild-needed exists as a file for the trigger-update endpoint
    if [ -d "$SCRIPT_DIR/.rebuild-needed" ]; then
        log_warning "Fixing .rebuild-needed (was directory, converting to file)..."
        rm -rf "$SCRIPT_DIR/.rebuild-needed"
    fi
    if [ ! -f "$SCRIPT_DIR/.rebuild-needed" ]; then
        touch "$SCRIPT_DIR/.rebuild-needed"
    fi
    
    # Ensure .update-check-requested exists as a file
    if [ -d "$SCRIPT_DIR/.update-check-requested" ]; then
        rm -rf "$SCRIPT_DIR/.update-check-requested"
    fi
    if [ ! -f "$SCRIPT_DIR/.update-check-requested" ]; then
        touch "$SCRIPT_DIR/.update-check-requested"
    fi
    
    # Ensure .update-requested exists as a file
    if [ -d "$SCRIPT_DIR/.update-requested" ]; then
        rm -rf "$SCRIPT_DIR/.update-requested"
    fi
    if [ ! -f "$SCRIPT_DIR/.update-requested" ]; then
        touch "$SCRIPT_DIR/.update-requested"
    fi
    
    # Ensure .restart-requested exists as a file
    if [ -d "$SCRIPT_DIR/.restart-requested" ]; then
        rm -rf "$SCRIPT_DIR/.restart-requested"
    fi
    if [ ! -f "$SCRIPT_DIR/.restart-requested" ]; then
        touch "$SCRIPT_DIR/.restart-requested"
    fi
    
    # Check if docker compose is available
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        log_error "Error: Docker Compose not found"
        return 1
    fi
    
    # Determine if we need sudo (not needed inside containers or if user has docker access)
    SUDO_PREFIX=""
    if ! docker info &> /dev/null; then
        # Docker not accessible, try with sudo
        if command -v sudo &> /dev/null && sudo docker info &> /dev/null; then
            SUDO_PREFIX="sudo"
        else
            log_error "Error: Cannot access Docker daemon"
            return 1
        fi
    fi
    
    # Check if we're running inside a container (to avoid stopping ourselves)
    INSIDE_CONTAINER=false
    if [ -f "/.dockerenv" ] || grep -q docker /proc/1/cgroup 2>/dev/null; then
        INSIDE_CONTAINER=true
        log_warning "Running inside container - will rebuild without stopping self"
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
            log_success "  meticulous-mcp rebuilt"
        else
            log_warning "  Warning: Failed to rebuild meticulous-mcp"
        fi
        
        # Create a flag file to signal the host-side rebuild watcher
        # The rebuild-watcher.sh script on the host will pick this up
        local REBUILD_FLAG="$SCRIPT_DIR/.rebuild-needed"
        cat > "$REBUILD_FLAG" <<REBUILD_EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "reason": "Container update triggered from web UI",
  "containers": ["meticai-server", "gemini-client", "meticai-web"]
}
REBUILD_EOF
        
        echo ""
        log_warning "Note: Some containers require host-side rebuild."
        log_warning "Rebuild flag created at: $REBUILD_FLAG"
        echo ""
        log_info "Options to complete the update:"
        echo -e "  1. If rebuild-watcher is installed, it will auto-rebuild"
        echo -e "  2. Run on host: ./rebuild-watcher.sh"
        echo -e "  3. Run on host: docker compose up -d --build"
        echo ""
        log_success "Available containers rebuilt"
        return 0
    else
        # Standard rebuild when running on host
        echo "Stopping containers..."
        if $SUDO_PREFIX $COMPOSE_CMD down --remove-orphans 2>/dev/null; then
            log_success "Containers stopped"
        else
            log_warning "Warning: Failed to stop containers (they may not be running)"
        fi
        
        # Pre-create directories so Docker doesn't create them as root
        mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/logs"
        
        # Final safety check: ensure config.json files are not directories
        # This catches cases where a previous failed install left directories behind
        if [ -d "$SCRIPT_DIR/meticai-web/config.json" ]; then
            rm -rf "$SCRIPT_DIR/meticai-web/config.json"
            if [ -f "$SCRIPT_DIR/.env" ]; then
                # shellcheck disable=SC1091
                source "$SCRIPT_DIR/.env"
                echo '{"serverUrl": "http://'"$PI_IP"':8000"}' > "$SCRIPT_DIR/meticai-web/config.json"
            else
                echo '{"serverUrl": "http://localhost:8000"}' > "$SCRIPT_DIR/meticai-web/config.json"
            fi
        fi
        if [ -d "$SCRIPT_DIR/meticai-web/public/config.json" ]; then
            rm -rf "$SCRIPT_DIR/meticai-web/public/config.json"
            if [ -f "$SCRIPT_DIR/.env" ]; then
                # shellcheck disable=SC1091
                source "$SCRIPT_DIR/.env"
                echo '{"serverUrl": "http://'"$PI_IP"':8000"}' > "$SCRIPT_DIR/meticai-web/public/config.json"
            else
                echo '{"serverUrl": "http://localhost:8000"}' > "$SCRIPT_DIR/meticai-web/public/config.json"
            fi
        fi
        
        # Rebuild and start
        echo "Building and starting containers..."
        if $SUDO_PREFIX $COMPOSE_CMD up -d --build; then
            log_success "Containers rebuilt and started"
            
            # Fix permissions if we used sudo
            if [ -n "$SUDO_PREFIX" ]; then
                echo "Fixing file ownership..."
                sudo chown -R "$(id -u):$(id -g)" "$SCRIPT_DIR/data" "$SCRIPT_DIR/logs" \
                    "$SCRIPT_DIR/.versions.json" "$SCRIPT_DIR/.rebuild-needed" \
                    "$SCRIPT_DIR/meticulous-source" "$SCRIPT_DIR/meticai-web" 2>/dev/null || true
            fi
            
            return 0
        else
            log_error "Failed to rebuild containers"
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
      "current_version": "$METICAI_LOCAL_VERSION",
      "remote_version": "$METICAI_REMOTE_VERSION",
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR")",
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
      "current_version": "$WEB_LOCAL_VERSION",
      "remote_version": "$WEB_REMOTE_VERSION",
      "current_hash": "$(get_commit_hash "$SCRIPT_DIR/meticai-web")",
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
    
    # Ensure required files exist as files (not directories) before any operations
    # This prevents Docker from creating directories when mounting
    if [ -d "$SCRIPT_DIR/.versions.json" ]; then
        rm -rf "$SCRIPT_DIR/.versions.json"
    fi
    if [ ! -f "$SCRIPT_DIR/.versions.json" ]; then
        echo '{}' > "$SCRIPT_DIR/.versions.json"
    fi
    if [ -d "$SCRIPT_DIR/.rebuild-needed" ]; then
        rm -rf "$SCRIPT_DIR/.rebuild-needed"
    fi
    if [ ! -f "$SCRIPT_DIR/.rebuild-needed" ]; then
        touch "$SCRIPT_DIR/.rebuild-needed"
    fi
    if [ -d "$SCRIPT_DIR/.update-check-requested" ]; then
        rm -rf "$SCRIPT_DIR/.update-check-requested"
    fi
    if [ ! -f "$SCRIPT_DIR/.update-check-requested" ]; then
        touch "$SCRIPT_DIR/.update-check-requested"
    fi
    if [ -d "$SCRIPT_DIR/.update-requested" ]; then
        rm -rf "$SCRIPT_DIR/.update-requested"
    fi
    if [ ! -f "$SCRIPT_DIR/.update-requested" ]; then
        touch "$SCRIPT_DIR/.update-requested"
    fi
    if [ -d "$SCRIPT_DIR/.restart-requested" ]; then
        rm -rf "$SCRIPT_DIR/.restart-requested"
    fi
    if [ ! -f "$SCRIPT_DIR/.restart-requested" ]; then
        touch "$SCRIPT_DIR/.restart-requested"
    fi
    
    # Fix common permission issues with git directories
    # This can happen when docker or sudo operations create files as root
    for subdir in "meticulous-source" "meticai-web"; do
        if [ -d "$SCRIPT_DIR/$subdir/.git" ]; then
            # Check if current user can write to .git directory
            if ! touch "$SCRIPT_DIR/$subdir/.git/.permission-test" 2>/dev/null; then
                log_warning "Fixing permissions for $subdir..."
                if command -v sudo &>/dev/null; then
                    sudo chown -R "$(id -u):$(id -g)" "$SCRIPT_DIR/$subdir" 2>/dev/null || true
                fi
            else
                rm -f "$SCRIPT_DIR/$subdir/.git/.permission-test" 2>/dev/null
            fi
        fi
    done
    
    # Initialize version tracking
    initialize_versions_file
    
    # Handle MCP repository switch if requested (deprecated - now automatic)
    if $SWITCH_MCP_REPO; then
        log_warning "Note: Repository switching is now automatic based on central configuration."
        log_warning "Checking for required repositories..."
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
            log_warning "Updates are available. Run without --check-only to apply them."
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
        log_warning "Applying updates..."
        echo ""
        
        # Update each component
        local update_success=true
        
        # Update main repo first (contains update script, docker-compose, etc.)
        if [ "$METICAI_UPDATE_AVAILABLE" = true ]; then
            update_main_repo || update_success=false
        fi
        
        # Update MCP (external dependency - always update if available)
        if [ "$MCP_UPDATE_AVAILABLE" = true ]; then
            update_mcp || update_success=false
        fi
        
        # Update web interface (version-based)
        if [ "$WEB_UPDATE_AVAILABLE" = true ]; then
            update_web || update_success=false
        fi
        
        # Update version file again after applying updates (to clear update_available flags)
        # Re-check to update the global variables
        check_for_updates >/dev/null 2>&1 || true
        update_version_file
        
        if $update_success; then
            echo ""
            log_success "All updates applied successfully"
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
            log_error "Some updates failed. Please check the errors above."
            exit 1
        fi
        
    else
        # No updates available
        log_success "Everything is up to date!"
        
        # Update version file with current check time
        update_version_file
    fi
    
    echo ""
    log_success "========================================="
    log_success "      Update check complete! ✨         "
    log_success "========================================="
}

# Run main function
main
