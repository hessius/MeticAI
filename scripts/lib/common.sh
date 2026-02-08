#!/bin/bash

################################################################################
# MeticAI - Common Shell Library
################################################################################
# Shared functions and utilities for MeticAI shell scripts
# 
# USAGE:
#   source "$(dirname "$0")/scripts/lib/common.sh"
#   # or from subdirectory:
#   source "$(dirname "$0")/../scripts/lib/common.sh"
#
################################################################################

# Text Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

################################################################################
# Logging Functions
################################################################################

# Log info message in blue
log_info() {
    local message="$1"
    echo -e "${BLUE}$message${NC}"
}

# Log success message in green
log_success() {
    local message="$1"
    echo -e "${GREEN}✓ $message${NC}"
}

# Log error message in red
log_error() {
    local message="$1"
    echo -e "${RED}✗ $message${NC}" >&2
}

# Log warning message in yellow
log_warning() {
    local message="$1"
    echo -e "${YELLOW}⚠ $message${NC}"
}

# Progress output function (supports Platypus progress bar format)
show_progress() {
    local message="$1"
    local percent="${2:-}"
    
    if [ "$METICAI_PROGRESS_FORMAT" = "platypus" ]; then
        if [ -n "$percent" ]; then
            echo "PROGRESS:$percent"
        fi
        echo "$message"
    else
        echo -e "${YELLOW}$message${NC}"
    fi
}

################################################################################
# System Utility Functions
################################################################################

# Run command with sudo only when needed and available
# Some systems (like Puppy OS) are single-user and don't have sudo
run_privileged() {
    if [ "$(id -u)" -eq 0 ]; then
        # Already root, no sudo needed
        "$@"
    elif command -v sudo &> /dev/null; then
        # Not root but sudo is available
        sudo "$@"
    else
        # Not root and no sudo - try anyway (will fail if permissions needed)
        "$@"
    fi
}

################################################################################
# Prerequisite Checks
################################################################################

# Check if Docker is installed and running
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        return 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        return 1
    fi
    
    log_success "Docker is installed and running"
    return 0
}

# Check if Docker Compose is available (either as plugin or standalone)
check_docker_compose() {
    if docker compose version &> /dev/null; then
        log_success "Docker Compose (plugin) is available"
        return 0
    elif command -v docker-compose &> /dev/null; then
        log_success "Docker Compose (standalone) is available"
        return 0
    else
        log_error "Docker Compose is not available"
        return 1
    fi
}

# Check if Git is installed
check_git() {
    if ! command -v git &> /dev/null; then
        log_error "Git is not installed"
        return 1
    fi
    
    log_success "Git is installed"
    return 0
}

# Check all prerequisites (Docker, Docker Compose, Git)
check_prerequisites() {
    local all_ok=true
    
    if ! check_docker; then
        all_ok=false
    fi
    
    if ! check_docker_compose; then
        all_ok=false
    fi
    
    if ! check_git; then
        all_ok=false
    fi
    
    if [ "$all_ok" = false ]; then
        log_error "Please install missing prerequisites before continuing"
        return 1
    fi
    
    return 0
}

################################################################################
# Docker Utility Functions
################################################################################

# Stop and remove Docker containers
# Usage: stop_containers "container1" "container2" ...
stop_containers() {
    local containers=("$@")
    
    for container in "${containers[@]}"; do
        if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
            log_info "Stopping and removing container: $container"
            docker stop "$container" &> /dev/null || true
            docker rm "$container" &> /dev/null || true
            log_success "Removed $container"
        fi
    done
}

# Get the Docker Compose command (either 'docker compose' or 'docker-compose')
get_compose_command() {
    if docker compose version &> /dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose &> /dev/null; then
        echo "docker-compose"
    else
        log_error "Docker Compose not found"
        return 1
    fi
}

################################################################################
# Git Utility Functions
################################################################################

# Checkout the latest release tag for a repository
# This ensures users get stable, tested versions instead of potentially unstable main branch
# Usage: checkout_latest_release "/path/to/repo" "repo-name"
checkout_latest_release() {
    local dir="$1"
    local repo_name="$2"
    local original_dir="$PWD"
    
    cd "$dir" || return 1
    
    # Fetch all tags
    git fetch --tags 2>/dev/null
    
    # Get the latest version tag (format: vX.Y.Z or X.Y.Z)
    local latest_tag
    latest_tag=$(git tag -l --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$' | head -n1)
    
    if [ -n "$latest_tag" ]; then
        if [ "$METICAI_NON_INTERACTIVE" = "true" ]; then
            show_progress "Checking out $repo_name release $latest_tag..."
        else
            log_warning "Checking out latest release: $latest_tag"
        fi
        if git checkout "$latest_tag" 2>/dev/null; then
            log_success "$repo_name set to stable release $latest_tag"
            cd "$original_dir" || true
            return 0
        else
            log_warning "Could not checkout tag, staying on main branch"
            cd "$original_dir" || true
            return 1
        fi
    else
        log_warning "No release tags found for $repo_name, using main branch"
        cd "$original_dir" || true
        return 1
    fi
}

################################################################################
# Validation Functions
################################################################################

# Validate IP address format
validate_ip() {
    local ip="$1"
    if [[ $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        return 0
    else
        return 1
    fi
}

# Validate that a string is not empty
validate_not_empty() {
    local value="$1"
    if [ -z "$value" ]; then
        return 1
    else
        return 0
    fi
}

################################################################################
# File Utility Functions
################################################################################

# Check if a file exists and is readable
check_file_exists() {
    local file="$1"
    if [ -f "$file" ] && [ -r "$file" ]; then
        return 0
    else
        return 1
    fi
}

# Create directory if it doesn't exist
ensure_directory() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" || {
            log_error "Failed to create directory: $dir"
            return 1
        }
        log_success "Created directory: $dir"
    fi
    return 0
}
