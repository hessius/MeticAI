#!/bin/bash

################################################################################
# MeticAI - macOS Uninstaller Wrapper Script (v2.0)
################################################################################
# 
# This script provides a GUI-based uninstallation experience for macOS users.
# Designed to be packaged with Platypus as a standalone .app bundle.
#
################################################################################

set -e

# Set PATH to ensure we can find Docker
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Configuration
INSTALL_DIR="${HOME}/.meticai"

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

# Show dialog
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
    display dialog "$message" buttons {$buttons} default button "$default_button" with icon file iconPath with title "MeticAI Uninstaller"
    return button returned of result
end tell
EOF
    else
        osascript <<EOF
tell application "System Events"
    activate
    display dialog "$message" buttons {$buttons} default button "$default_button" with icon $icon with title "MeticAI Uninstaller"
    return button returned of result
end tell
EOF
    fi
}

# Show progress notification
show_progress() {
    local message="$1"
    osascript -e "display notification \"$message\" with title \"MeticAI Uninstaller\""
}

# Main uninstallation flow
main() {
    # Check if MeticAI is installed
    if [ ! -d "$INSTALL_DIR" ]; then
        show_dialog "MeticAI Not Found

No MeticAI installation was found at ~/.meticai

Nothing to uninstall." '"OK"' "OK" "note"
        exit 0
    fi
    
    # Confirmation dialog
    result=$(show_dialog "Uninstall MeticAI?

This will:
• Stop and remove Docker containers
• Remove configuration files
• Optionally remove all data (profiles, history)

Are you sure you want to continue?" '"Cancel", "Uninstall"' "Cancel" "caution")
    
    if [ "$result" != "Uninstall" ]; then
        exit 0
    fi
    
    # Ask about data
    result=$(show_dialog "Remove Data?

Would you like to also remove all MeticAI data?
(Profiles, shot history, settings)

This cannot be undone." '"Keep Data", "Remove Everything"' "Keep Data" "caution")
    
    REMOVE_DATA="n"
    if [ "$result" = "Remove Everything" ]; then
        REMOVE_DATA="y"
    fi
    
    # Stop containers
    show_progress "Stopping MeticAI containers..."
    
    if [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
        cd "$INSTALL_DIR"
        docker compose down 2>/dev/null || true
    fi
    
    # Remove Docker volume if requested
    if [ "$REMOVE_DATA" = "y" ]; then
        show_progress "Removing data volume..."
        docker volume rm meticai-data 2>/dev/null || true
    fi
    
    # Remove configuration
    show_progress "Removing configuration..."
    rm -rf "$INSTALL_DIR"
    
    # Success
    if [ "$REMOVE_DATA" = "y" ]; then
        show_dialog "MeticAI Uninstalled

All MeticAI files and data have been removed.

Thank you for using MeticAI! ☕" '"OK"' "OK"
    else
        show_dialog "MeticAI Uninstalled

MeticAI has been removed, but your data has been preserved
in the Docker volume 'meticai-data'.

To completely remove data later, run:
docker volume rm meticai-data

Thank you for using MeticAI! ☕" '"OK"' "OK"
    fi
}

# Run main
main "$@"
