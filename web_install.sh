#!/bin/bash

################################################################################
# MeticAI - Remote Web Installer
################################################################################
# 
# This script enables remote installation of MeticAI without requiring users
# to manually clone the repository first.
#
# USAGE:
#   curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh | bash
#
# WHAT IT DOES:
#   1. Checks for prerequisites (Git, curl)
#   2. Clones the MeticAI repository
#   3. Executes the local-install.sh script from the cloned repository
#
# REQUIREMENTS:
#   - curl (for downloading the script)
#   - Git (will be installed if missing)
#   - Internet connection
#
################################################################################

# Determine script directory for sourcing common library
# Since this might be piped to bash, we need to handle different scenarios
if [ -n "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
else
    SCRIPT_DIR="$(pwd)"
fi

# Only source common.sh if it exists (won't exist during curl | bash)
if [ -f "$SCRIPT_DIR/scripts/lib/common.sh" ]; then
    source "$SCRIPT_DIR/scripts/lib/common.sh"
else
    # Fallback color definitions for when common.sh is not available
    GREEN='\033[0;32m'
    BLUE='\033[0;34m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    NC='\033[0m'
    
    log_info() { echo -e "${BLUE}$1${NC}"; }
    log_success() { echo -e "${GREEN}✓ $1${NC}"; }
    log_error() { echo -e "${RED}✗ $1${NC}" >&2; }
    log_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
fi

# Configuration
REPO_URL="https://github.com/hessius/MeticAI.git"
INSTALL_DIR="MeticAI"
BRANCH="main"

log_info "========================================="
log_info "   ☕️ MeticAI Remote Installer 🤖    "
log_info "========================================="
echo ""

# Detect if script is being run from a local git repository
# If local-install.sh exists in current directory, we're likely in the repo
if [ -f "./local-install.sh" ] && [ -d "./.git" ]; then
    log_warning "Detected local repository installation."
    log_warning "Running local-install.sh directly..."
    echo ""
    exec ./local-install.sh
fi

# From here on, we're running in remote/web installation mode
log_warning "Remote installation mode detected."
echo "This will clone the MeticAI repository and run the installer."
echo ""

# Ask user for installation location
log_warning "Where would you like to install MeticAI?"
echo "1) Current directory ($(pwd))"
echo "2) Home directory ($HOME)"
echo "3) Custom path"
read -r -p "Enter your choice (1/2/3) [1]: " LOCATION_CHOICE </dev/tty
LOCATION_CHOICE=${LOCATION_CHOICE:-1}

case "$LOCATION_CHOICE" in
    1)
        # Current directory - optionally allow subfolder name
        read -r -p "Enter folder name [MeticAI]: " FOLDER_NAME </dev/tty
        FOLDER_NAME=${FOLDER_NAME:-MeticAI}
        INSTALL_DIR="$(pwd)/$FOLDER_NAME"
        ;;
    2)
        # Home directory
        read -r -p "Enter folder name [MeticAI]: " FOLDER_NAME </dev/tty
        FOLDER_NAME=${FOLDER_NAME:-MeticAI}
        INSTALL_DIR="$HOME/$FOLDER_NAME"
        ;;
    3)
        # Custom path
        read -r -p "Enter full path for installation: " CUSTOM_PATH </dev/tty
        while [[ -z "$CUSTOM_PATH" ]]; do
            log_error "Path cannot be empty."
            read -r -p "Enter full path for installation: " CUSTOM_PATH </dev/tty
        done
        # Expand tilde if present
        CUSTOM_PATH="${CUSTOM_PATH/#\~/$HOME}"
        INSTALL_DIR="$CUSTOM_PATH"
        ;;
    *)
        log_warning "Invalid choice, using current directory."
        INSTALL_DIR="$(pwd)/MeticAI"
        ;;
esac

echo ""
log_success "Installation directory: $INSTALL_DIR"
echo ""

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS=$ID
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    else
        OS="unknown"
    fi
    echo "$OS"
}

# Install git based on OS
install_git() {
    local os
    os=$(detect_os)
    log_warning "Installing git..."
    
    case "$os" in
        macos)
            if command -v brew &> /dev/null; then
                if brew install git; then
                    log_success "Git installed successfully."
                else
                    log_error "Failed to install git via Homebrew."
                    exit 1
                fi
            else
                log_warning "Homebrew not found. Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                
                # Source Homebrew environment for both Intel and Apple Silicon Macs
                if [ -f /opt/homebrew/bin/brew ]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [ -f /usr/local/bin/brew ]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
                
                if command -v brew &> /dev/null && brew install git; then
                    log_success "Git installed successfully."
                else
                    log_error "Failed to install git. Please install manually."
                    echo "Visit: https://git-scm.com/downloads"
                    exit 1
                fi
            fi
            ;;
        ubuntu|debian|raspbian)
            if sudo apt-get update && sudo apt-get install -y git; then
                log_success "Git installed successfully."
            else
                log_error "Failed to install git. Please install manually."
                exit 1
            fi
            ;;
        fedora|rhel|centos)
            if command -v dnf &> /dev/null; then
                if sudo dnf install -y git; then
                    log_success "Git installed successfully."
                else
                    log_error "Failed to install git. Please install manually."
                    exit 1
                fi
            elif command -v yum &> /dev/null; then
                if sudo yum install -y git; then
                    log_success "Git installed successfully."
                else
                    log_error "Failed to install git. Please install manually."
                    exit 1
                fi
            else
                log_error "No supported package manager found. Please install git manually."
                exit 1
            fi
            ;;
        arch|manjaro)
            if sudo pacman -Sy --noconfirm git; then
                log_success "Git installed successfully."
            else
                log_error "Failed to install git. Please install manually."
                exit 1
            fi
            ;;
        *)
            log_error "Unsupported OS for automatic installation. Please install git manually."
            echo "Visit: https://git-scm.com/downloads"
            exit 1
            ;;
    esac
}

# Check for curl (should exist if user ran this script via curl)
if ! command -v curl &> /dev/null; then
    log_error "Error: curl is not installed."
    echo "curl is required for remote installation."
    echo "Please install curl and try again."
    exit 1
fi
log_success "curl found."

# Check and install git if needed
if ! command -v git &> /dev/null; then
    log_error "Error: git is not installed."
    read -r -p "Would you like to install git now? (y/n) [y]: " INSTALL_GIT </dev/tty
    INSTALL_GIT=${INSTALL_GIT:-y}
    
    if [[ "$INSTALL_GIT" =~ ^[Yy]$ ]]; then
        install_git
    else
        log_error "Error: git is required. Please install it manually and run this script again."
        exit 1
    fi
else
    log_success "Git found."
fi

echo ""

# Check if directory already exists
if [ -d "$INSTALL_DIR" ]; then
    log_warning "Warning: Directory '$INSTALL_DIR' already exists."
    
    # Check for preserved files from previous installation
    PRESERVED_FILES=""
    if [ -f "$INSTALL_DIR/.env" ]; then
        PRESERVED_FILES="${PRESERVED_FILES}.env (configuration), "
    fi
    if [ -d "$INSTALL_DIR/data" ] && [ "$(ls -A "$INSTALL_DIR/data" 2>/dev/null)" ]; then
        PRESERVED_FILES="${PRESERVED_FILES}data/ (profile history), "
    fi
    if [ -d "$INSTALL_DIR/logs" ]; then
        PRESERVED_FILES="${PRESERVED_FILES}logs/, "
    fi
    
    if [ -n "$PRESERVED_FILES" ]; then
        log_success "Found preserved files from previous installation: ${PRESERVED_FILES%,*}"
    fi
    
    read -r -p "Do you want to remove it and clone fresh? (y/n) [y]: " REMOVE_DIR </dev/tty
    REMOVE_DIR=${REMOVE_DIR:-y}
    
    if [[ "$REMOVE_DIR" =~ ^[Yy]$ ]]; then
        echo "Removing existing directory (preserving .env, data/, logs/)..."
        
        # Preserve .env, data, and logs by moving them temporarily
        TEMP_PRESERVE_DIR=$(mktemp -d)
        if [ -f "$INSTALL_DIR/.env" ]; then
            cp "$INSTALL_DIR/.env" "$TEMP_PRESERVE_DIR/.env"
            log_info "Preserving .env file"
        fi
        if [ -d "$INSTALL_DIR/data" ]; then
            cp -r "$INSTALL_DIR/data" "$TEMP_PRESERVE_DIR/data"
            log_info "Preserving data/ directory"
        fi
        if [ -d "$INSTALL_DIR/logs" ]; then
            cp -r "$INSTALL_DIR/logs" "$TEMP_PRESERVE_DIR/logs"
            log_info "Preserving logs/ directory"
        fi
        
        rm -rf "$INSTALL_DIR"
    else
        log_warning "Using existing directory. Attempting to update..."
        cd "$INSTALL_DIR" || exit 1
        
        # Try to pull latest changes
        if git pull origin "$BRANCH" 2>/dev/null; then
            log_success "Repository updated."
        else
            log_warning "Could not update repository. Continuing with existing version."
        fi
        
        # Execute the local installer
        if [ -f "./local-install.sh" ]; then
            echo ""
            log_success "Starting local installer..."
            echo ""
            exec ./local-install.sh
        else
            log_error "Error: local-install.sh not found in existing directory."
            exit 1
        fi
    fi
fi

# Create parent directory if needed (for custom paths)
PARENT_DIR=$(dirname "$INSTALL_DIR")
if [ ! -d "$PARENT_DIR" ]; then
    log_warning "Creating parent directory: $PARENT_DIR"
    if mkdir -p "$PARENT_DIR"; then
        log_success "Parent directory created."
    else
        log_error "Error: Failed to create parent directory."
        echo "Please check permissions and try again."
        exit 1
    fi
fi

# Clone the repository
log_warning "Cloning MeticAI repository..."
if git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"; then
    log_success "Repository cloned successfully."
    
    # Checkout the latest stable release instead of main branch
    # Use the common.sh version if available, otherwise skip
    if [ -f "$INSTALL_DIR/scripts/lib/common.sh" ]; then
        source "$INSTALL_DIR/scripts/lib/common.sh"
        checkout_latest_release "$INSTALL_DIR" "MeticAI"
    fi
    
    # Restore preserved files from previous installation
    if [ -n "${TEMP_PRESERVE_DIR:-}" ] && [ -d "$TEMP_PRESERVE_DIR" ]; then
        if [ -f "$TEMP_PRESERVE_DIR/.env" ]; then
            cp "$TEMP_PRESERVE_DIR/.env" "$INSTALL_DIR/.env"
            log_success "Restored .env file from previous installation"
        fi
        if [ -d "$TEMP_PRESERVE_DIR/data" ]; then
            cp -r "$TEMP_PRESERVE_DIR/data" "$INSTALL_DIR/data"
            log_success "Restored data/ directory (profile history) from previous installation"
        fi
        if [ -d "$TEMP_PRESERVE_DIR/logs" ]; then
            cp -r "$TEMP_PRESERVE_DIR/logs" "$INSTALL_DIR/logs"
            log_success "Restored logs/ directory from previous installation"
        fi
        rm -rf "$TEMP_PRESERVE_DIR"
    fi
else
    log_error "Error: Failed to clone repository."
    echo "Please check your internet connection and try again."
    # Clean up temp directory if cloning failed
    if [ -n "${TEMP_PRESERVE_DIR:-}" ] && [ -d "$TEMP_PRESERVE_DIR" ]; then
        rm -rf "$TEMP_PRESERVE_DIR"
    fi
    exit 1
fi

# Change to the cloned directory
cd "$INSTALL_DIR" || exit 1

# Verify local-install.sh exists
if [ ! -f "./local-install.sh" ]; then
    log_error "Error: local-install.sh not found in cloned repository."
    exit 1
fi

# Make sure local-install.sh is executable
chmod +x ./local-install.sh
# Also make uninstall.sh executable for later use
chmod +x ./uninstall.sh

# Execute the local installer
echo ""
log_success "Starting local installer..."
log_info "Note: To uninstall MeticAI later, run './uninstall.sh' from $INSTALL_DIR"
echo ""
# Set environment variable to indicate we're in web install mode
export METICAI_INSTALL_METHOD="web_install.sh"
exec ./local-install.sh
