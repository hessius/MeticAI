#!/bin/bash

################################################################################
# MeticAI - macOS Installer Wrapper Script (v2.0)
################################################################################
# 
# This script provides a GUI-based installation experience for macOS users.
# It wraps the new simplified install.sh script with AppleScript dialogs.
#
# This script is designed to be packaged with Platypus to create a standalone
# macOS .app bundle.
#
################################################################################

set -e

# Set PATH to ensure we can find Docker and other tools
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Configuration
DEFAULT_INSTALL_DIR="${HOME}/MeticAI"
INSTALL_DIR=""  # Set by user during install flow
# NOTE: Using version/2.0.0 branch for pre-release testing.
# Revert to main before final release.
REPO_URL="https://raw.githubusercontent.com/hessius/MeticAI/version/2.0.0"
METICAI_TAG="2.0.0"

# Colors for terminal output (when run manually)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get icon path for dialogs
get_icon_path() {
    if [[ "$0" == *"/Contents/Resources/"* ]]; then
        local bundle_path=$(echo "$0" | sed 's|/Contents/Resources/.*||')
        local icon_path="$bundle_path/Contents/Resources/AppIcon.icns"
        [ -f "$icon_path" ] && echo "$icon_path"
    elif [[ "$0" == *"/Contents/MacOS/"* ]]; then
        local bundle_path=$(echo "$0" | sed 's|/Contents/MacOS/.*||')
        local icon_path="$bundle_path/Contents/Resources/AppIcon.icns"
        [ -f "$icon_path" ] && echo "$icon_path"
    fi
}

ICON_PATH=$(get_icon_path)

# Show dialog with optional icon
show_dialog() {
    local message="$1"
    local buttons="${2:-OK}"
    local default_button="${3:-OK}"
    local icon="${4:-note}"
    
    if [ -n "$ICON_PATH" ]; then
        osascript <<EOF
tell application "System Events"
    activate
    set iconPath to POSIX file "$ICON_PATH"
    display dialog "$message" buttons {$buttons} default button "$default_button" with icon file iconPath with title "MeticAI Installer"
    return button returned of result
end tell
EOF
    else
        osascript <<EOF
tell application "System Events"
    activate
    display dialog "$message" buttons {$buttons} default button "$default_button" with icon $icon with title "MeticAI Installer"
    return button returned of result
end tell
EOF
    fi
}

# Show text input dialog
show_input_dialog() {
    local prompt="$1"
    local default_value="$2"
    
    osascript <<EOF
tell application "System Events"
    activate
    set dialogResult to display dialog "$prompt" default answer "$default_value" buttons {"Cancel", "OK"} default button "OK" with title "MeticAI Installer"
    return text returned of dialogResult
end tell
EOF
}

# Show a folder-chooser dialog, returns selected path
choose_folder() {
    local prompt_text="$1"
    local default_dir="$2"
    osascript <<EOF 2>/dev/null
tell application "System Events"
    activate
    set chosenFolder to choose folder with prompt "$prompt_text" default location POSIX file "$default_dir"
    return POSIX path of chosenFolder
end tell
EOF
}

# Show progress notification
show_progress() {
    local message="$1"
    osascript -e "display notification \"$message\" with title \"MeticAI Installer\""
}

# Auto-detect Meticulous machine on the network
detect_meticulous() {
    local detected=""

    # Method 1: dns-sd (Bonjour) — most reliable on macOS
    if command -v dns-sd &>/dev/null; then
        local dns_output
        dns_output=$(timeout 4 dns-sd -B _http._tcp local 2>/dev/null || true)
        if echo "$dns_output" | grep -qi "meticulous"; then
            # Found via Bonjour — resolve the hostname
            detected=$(resolve_meticulous_ip "meticulous")
            if [[ -n "$detected" ]]; then
                echo "$detected"
                return 0
            fi
        fi
    fi

    # Method 2: Try resolving meticulous.local directly
    detected=$(resolve_meticulous_ip "meticulous")
    if [[ -n "$detected" ]]; then
        echo "$detected"
        return 0
    fi

    return 1
}

# Resolve meticulous.local to an IP
resolve_meticulous_ip() {
    local name="${1:-meticulous}"
    local hostname="${name}.local"
    local ip=""

    # dscacheutil (macOS native)
    if command -v dscacheutil &>/dev/null; then
        ip=$(dscacheutil -q host -a name "$hostname" 2>/dev/null | grep "^ip_address:" | head -1 | awk '{print $2}')
        [[ -n "$ip" ]] && { echo "$ip"; return 0; }
    fi

    # ping fallback
    ip=$(ping -c 1 -t 2 "$hostname" 2>/dev/null | grep -oE '\([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\)' | head -1 | tr -d '()')
    [[ -n "$ip" ]] && { echo "$ip"; return 0; }

    return 1
}

# Show error and exit
show_error() {
    local message="$1"
    osascript <<EOF
tell application "System Events"
    activate
    display alert "Installation Error" message "$message" as critical buttons {"OK"} default button "OK"
end tell
EOF
    exit 1
}

# Check if Docker is installed and running
check_docker() {
    if ! command -v docker &> /dev/null; then
        return 1
    fi
    if ! docker info &> /dev/null 2>&1; then
        return 2
    fi
    return 0
}

# Main installation flow
main() {
    # Welcome dialog
    show_dialog "Welcome to MeticAI Installer

This will install MeticAI - your AI Barista for the Meticulous Espresso Machine.

The installation will:
• Check for Docker Desktop
• Configure your API key and machine IP
• Start MeticAI in Docker

Click Continue to begin." '"Cancel", "Continue"' "Continue"
    
    if [ $? -ne 0 ]; then
        exit 0
    fi
    
    # Check Docker
    show_progress "Checking for Docker..."
    
    if ! check_docker; then
        docker_status=$?
        
        if [ $docker_status -eq 1 ]; then
            # Docker not installed
            result=$(show_dialog "Docker Desktop Required

Docker Desktop is not installed. MeticAI requires Docker to run.

Would you like to download Docker Desktop now?" '"Cancel", "Download Docker"' "Download Docker" "caution")
            
            if [ "$result" = "Download Docker" ]; then
                open "https://www.docker.com/products/docker-desktop/"
            fi
            show_error "Please install Docker Desktop and run this installer again."
        else
            # Docker installed but not running
            show_dialog "Docker Desktop Not Running

Please start Docker Desktop before continuing.

You can find it in your Applications folder." '"OK"' "OK" "caution"
            show_error "Please start Docker Desktop and run this installer again."
        fi
    fi
    
    show_progress "Docker is ready!"
    
    # --- Choose installation location ---
    # Check if there's already an install at the default path
    if [ -f "${DEFAULT_INSTALL_DIR}/.env" ]; then
        INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    else
        # Ask user for install location (dialog with default path + Browse option)
        result=$(show_dialog "Choose Installation Location

MeticAI files will be stored in this folder.
Default: ${DEFAULT_INSTALL_DIR}

Click Browse to choose a different folder, or Continue to use the default." '"Cancel", "Browse…", "Continue"' "Continue")

        case "$result" in
            "Browse…")
                # Ensure the default parent directory exists for the folder picker
                mkdir -p "${DEFAULT_INSTALL_DIR%/*}"
                chosen=$(choose_folder "Choose a folder for MeticAI" "${DEFAULT_INSTALL_DIR%/*}")
                if [ -z "$chosen" ]; then
                    show_error "No folder selected. Installation cancelled."
                fi
                # Append MeticAI subfolder if user picked a parent
                chosen="${chosen%/}"
                if [[ "$(basename "$chosen")" != "MeticAI" && "$(basename "$chosen")" != "meticai" ]]; then
                    INSTALL_DIR="${chosen}/MeticAI"
                else
                    INSTALL_DIR="$chosen"
                fi
                ;;
            "Continue")
                INSTALL_DIR="$DEFAULT_INSTALL_DIR"
                ;;
            *)
                exit 0
                ;;
        esac
    fi

    # Check for existing installation at chosen path
    if [ -f "${INSTALL_DIR}/.env" ]; then
        result=$(show_dialog "Existing Installation Found

MeticAI is already installed at ${INSTALL_DIR}

What would you like to do?" '"Cancel", "Reinstall", "Update"' "Update")
        
        case "$result" in
            "Update")
                show_progress "Updating MeticAI..."
                cd "$INSTALL_DIR"
                docker compose pull
                docker compose up -d
                
                IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
                show_dialog "MeticAI Updated!

Access MeticAI at:
http://${IP}:3550

The services are now running in the background." '"OK"' "OK"
                
                # Open browser
                open "http://${IP}:3550"
                exit 0
                ;;
            "Reinstall")
                show_progress "Removing existing installation..."
                cd "$INSTALL_DIR"
                docker compose down 2>/dev/null || true
                ;;
            *)
                exit 0
                ;;
        esac
    fi
    
    # Get Gemini API Key
    GEMINI_API_KEY=$(show_input_dialog "Enter your Gemini API Key

Get a free key at: https://aistudio.google.com/app/apikey

Paste your API key below:" "")
    
    if [ -z "$GEMINI_API_KEY" ]; then
        show_error "Gemini API Key is required. Installation cancelled."
    fi
    
    # Auto-detect Meticulous machine
    show_progress "Scanning network for Meticulous machine..."
    DETECTED_IP=$(detect_meticulous 2>/dev/null || true)

    if [ -n "$DETECTED_IP" ]; then
        # Machine found — let user confirm or override
        METICULOUS_IP=$(show_input_dialog "Meticulous Machine Found! ✅\n\nDetected your machine at: ${DETECTED_IP}\n\nPress OK to use this address, or change it below:" "$DETECTED_IP")
    else
        # Not found — ask user to enter manually
        METICULOUS_IP=$(show_input_dialog "Meticulous Machine Not Found\n\nCould not auto-detect your machine on the network.\nPlease enter its IP address manually.\n\nTip: Check the Meticulous app or your router's device list." "meticulous.local")
    fi

    if [ -z "$METICULOUS_IP" ]; then
        METICULOUS_IP="meticulous.local"
    fi
    
    # Ask about optional features
    result=$(show_dialog "Optional Features

Would you like to enable automatic updates?
(Watchtower will check for updates every 6 hours)" '"No", "Yes"' "Yes")
    
    ENABLE_WATCHTOWER="n"
    if [ "$result" = "Yes" ]; then
        ENABLE_WATCHTOWER="y"
    fi
    
    # Create installation directory
    show_progress "Installing MeticAI..."
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    
    # Create .env file
    cat > .env << EOF
# MeticAI Configuration
# Generated by macOS Installer on $(date)

GEMINI_API_KEY=${GEMINI_API_KEY}
METICULOUS_IP=${METICULOUS_IP}
METICAI_TAG=${METICAI_TAG}
EOF
    
    # Build compose files list
    COMPOSE_FILES="-f docker-compose.yml"
    
    if [ "$ENABLE_WATCHTOWER" = "y" ]; then
        WATCHTOWER_TOKEN=$(openssl rand -hex 16)
        echo "WATCHTOWER_TOKEN=${WATCHTOWER_TOKEN}" >> .env
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.watchtower.yml"
    fi
    
    echo "COMPOSE_FILES=\"$COMPOSE_FILES\"" >> .env
    
    # Download compose files
    show_progress "Downloading configuration..."
    curl -fsSL "${REPO_URL}/docker-compose.yml" -o docker-compose.yml
    curl -fsSL "${REPO_URL}/docker-compose.watchtower.yml" -o docker-compose.watchtower.yml 2>/dev/null || true
    curl -fsSL "${REPO_URL}/docker-compose.tailscale.yml" -o docker-compose.tailscale.yml 2>/dev/null || true
    
    # Pull and start
    show_progress "Pulling Docker images (this may take a few minutes)..."
    eval "docker compose ${COMPOSE_FILES} pull"
    
    show_progress "Starting MeticAI..."
    eval "docker compose ${COMPOSE_FILES} up -d"
    
    # Wait for startup
    sleep 5
    
    # Get IP for access
    IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
    
    # Success!
    show_dialog "Installation Complete! ☕

MeticAI is now running.

Access the web interface at:
http://${IP}:3550

The services will start automatically when Docker Desktop runs.

Click OK to open the web interface." '"OK"' "OK"
    
    # Open browser
    open "http://${IP}:3550"
}

# Run main
main "$@"
