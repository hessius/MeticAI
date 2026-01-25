#!/bin/bash

################################################################################
# MeticAI - macOS Uninstaller Wrapper Script (Fully GUI)
################################################################################
# 
# This script provides a completely GUI-based uninstallation experience for
# macOS users with NO Terminal window. All confirmations are collected via
# AppleScript dialogs, and uninstallation runs in the background with progress
# feedback via GUI.
#
# This script is designed to be packaged with Platypus to create a standalone
# macOS .app bundle.
#
################################################################################

# Exit on error
set -e

# Set PATH to ensure we can find Docker and other tools
# Docker Desktop installs to /Applications/Docker.app
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Logging functions
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo "ERROR: $1" >&2
}

# Show progress dialog (non-blocking)
show_progress() {
    local message="$1"
    echo "PROGRESS: $message"
}

# Get icon path for dialogs - set globally at startup
get_icon_path() {
    # Try to find the app bundle we're running from
    # Platypus bundles script in Contents/Resources/script
    # Manual bundles put it in Contents/MacOS/
    if [[ "$0" == *"/Contents/Resources/"* ]]; then
        # Platypus bundle - script is in Contents/Resources/script
        local bundle_path=$(echo "$0" | sed 's|/Contents/Resources/.*||')
        local icon_path="$bundle_path/Contents/Resources/AppIcon.icns"
        
        if [ -f "$icon_path" ]; then
            echo "$icon_path"
            return
        fi
    elif [[ "$0" == *"/Contents/MacOS/"* ]]; then
        # Manual bundle - script is in Contents/MacOS/
        local bundle_path=$(echo "$0" | sed 's|/Contents/MacOS/.*||')
        local icon_path="$bundle_path/Contents/Resources/AppIcon.icns"
        
        if [ -f "$icon_path" ]; then
            echo "$icon_path"
            return
        fi
    fi
    
    # Fallback to empty (use system icon)
    echo ""
}

# Set global icon path at startup
ICON_PATH=$(get_icon_path)

# Display welcome/confirmation dialog
show_welcome() {
    if [ -n "$ICON_PATH" ]; then
        osascript <<EOF
tell application "System Events"
    activate
    set iconPath to POSIX file "$ICON_PATH"
    set buttonReturned to button returned of (display dialog "MeticAI Uninstaller

This will remove MeticAI from your system, including:

• Docker containers and images
• Cloned repositories
• Configuration files
• macOS integrations (if installed)

Your Docker, Git, and other tools will be kept.

Are you sure you want to uninstall MeticAI?" buttons {"Cancel", "Uninstall"} default button "Cancel" with icon file iconPath with title "MeticAI Uninstaller")
    
    if buttonReturned is "Cancel" then
        error number -128
    end if
end tell
EOF
    else
        osascript <<EOF
tell application "System Events"
    activate
    set buttonReturned to button returned of (display dialog "MeticAI Uninstaller

This will remove MeticAI from your system, including:

• Docker containers and images
• Cloned repositories
• Configuration files
• macOS integrations (if installed)

Your Docker, Git, and other tools will be kept.

Are you sure you want to uninstall MeticAI?" buttons {"Cancel", "Uninstall"} default button "Cancel" with icon caution with title "MeticAI Uninstaller")
    
    if buttonReturned is "Cancel" then
        error number -128
    end if
end tell
EOF
    fi
}

# Find MeticAI installation directory
find_installation_dir() {
    local possible_locations=(
        "$HOME/MeticAI"
        "$HOME/Documents/MeticAI"
        "/Applications/MeticAI"
        "$(pwd)"
    )
    
    for dir in "${possible_locations[@]}"; do
        if [ -d "$dir" ] && [ -f "$dir/docker-compose.yml" ]; then
            echo "$dir"
            return
        fi
    done
    
    # Ask user to locate it
    local install_dir=$(osascript <<'EOF'
tell application "System Events"
    activate
    set installPath to POSIX path of (choose folder with prompt "Please locate your MeticAI installation folder:")
    return installPath
end tell
EOF
)
    
    if [ -n "$install_dir" ] && [ -d "$install_dir" ]; then
        echo "$install_dir"
    else
        echo ""
    fi
}

# Run the actual uninstallation
run_uninstallation() {
    local install_dir="$1"
    
    show_progress "Finding MeticAI installation..."
    
    if [ -z "$install_dir" ] || [ ! -d "$install_dir" ]; then
        echo "ERROR: MeticAI installation directory not found"
        return 1
    fi
    
    log_message "Uninstalling from: $install_dir"
    cd "$install_dir" || return 1
    
    # Stop and remove containers
    show_progress "Stopping Docker containers..."
    
    if command -v docker &> /dev/null; then
        # Check if Docker daemon is running
        if docker info &> /dev/null 2>&1; then
            log_message "Docker daemon is running, proceeding with container cleanup..."
            
            # Stop containers using docker-compose if file exists
            if [ -f "docker-compose.yml" ]; then
                log_message "Found docker-compose.yml, stopping containers..."
                docker compose down --volumes --remove-orphans 2>/dev/null || docker-compose down --volumes --remove-orphans 2>/dev/null || true
                
                # Also try to stop by project name
                docker compose -p meticai down --volumes --remove-orphans 2>/dev/null || true
            fi
            
            # Find ALL containers (running or stopped) related to MeticAI
            log_message "Searching for all MeticAI-related containers..."
            local all_containers=$(docker ps -aq --filter "name=meticai" --filter "name=coffee-relay" --filter "name=gemini-client" --filter "name=meticulous-mcp" 2>/dev/null || true)
            
            if [ -n "$all_containers" ]; then
                log_message "Found containers to remove: $(echo $all_containers | tr '\n' ' ')"
                echo "$all_containers" | xargs docker stop 2>/dev/null || true
                echo "$all_containers" | xargs docker rm -f 2>/dev/null || true
                log_message "Containers stopped and removed"
            else
                log_message "No MeticAI containers found by name filter"
            fi
            
            # Also check for containers in the current directory's compose project
            local dir_name=$(basename "$install_dir" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]_-')
            log_message "Checking for containers with project name: $dir_name"
            local project_containers=$(docker ps -aq --filter "label=com.docker.compose.project=$dir_name" 2>/dev/null || true)
            
            if [ -n "$project_containers" ]; then
                log_message "Found project containers: $(echo $project_containers | tr '\n' ' ')"
                echo "$project_containers" | xargs docker stop 2>/dev/null || true
                echo "$project_containers" | xargs docker rm -f 2>/dev/null || true
                log_message "Project containers stopped and removed"
            fi
            
            # Remove images
            show_progress "Removing Docker images..."
            local images=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "(meticai|coffee-relay|gemini-client|meticulous-mcp)" 2>/dev/null || true)
            
            if [ -n "$images" ]; then
                log_message "Removing Docker images: $images"
                echo "$images" | xargs docker rmi -f 2>/dev/null || true
            else
                log_message "No MeticAI images found"
            fi
            
            log_message "Docker cleanup completed"
        else
            log_message "Docker daemon not running, skipping container cleanup"
            show_progress "Docker not running - skipping container cleanup"
        fi
    else
        log_message "Docker not found, skipping container cleanup"
        show_progress "Docker not installed - skipping container cleanup"
    fi
    
    # Remove cloned repositories
    show_progress "Removing cloned repositories..."
    
    [ -d "meticulous-source" ] && rm -rf meticulous-source
    [ -d "meticai-web" ] && rm -rf meticai-web
    
    # Remove configuration files
    show_progress "Removing configuration files..."
    
    [ -f ".env" ] && rm -f .env
    [ -f ".versions.json" ] && rm -f .versions.json
    [ -f ".rebuild-needed" ] && rm -f .rebuild-needed
    [ -f ".rebuild-watcher.log" ] && rm -f .rebuild-watcher.log
    
    # Remove macOS integrations
    show_progress "Removing macOS integrations..."
    
    # Remove Dock shortcut if it exists (check both locations)
    if [ -d "/Applications/MeticAI.app" ]; then
        log_message "Removing /Applications/MeticAI.app"
        rm -rf "/Applications/MeticAI.app" 2>/dev/null || sudo rm -rf "/Applications/MeticAI.app" 2>/dev/null || true
    fi
    if [ -d "$HOME/Applications/MeticAI.app" ]; then
        log_message "Removing $HOME/Applications/MeticAI.app"
        rm -rf "$HOME/Applications/MeticAI.app"
    fi
    
    # Remove from Dock (refresh Dock to remove orphaned items)
    killall Dock 2>/dev/null || true
    
    # Remove rebuild watcher service (macOS)
    if [ -f "$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist" ]; then
        launchctl unload "$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist" 2>/dev/null || true
        rm -f "$HOME/Library/LaunchAgents/com.meticai.rebuild-watcher.plist"
    fi
    
    # Ask about removing the installation directory
    show_progress "Finalizing uninstallation..."
    
    local remove_dir
    if [ -n "$ICON_PATH" ]; then
        remove_dir=$(osascript -e "tell application \"System Events\"" -e "activate" -e "set iconPath to POSIX file \"$ICON_PATH\"" -e "set buttonReturned to button returned of (display dialog \"Remove Installation Directory?\" & return & return & \"Do you want to remove the MeticAI installation directory?\" & return & return & \"$install_dir\" & return & return & \"This will delete all files in this directory.\" buttons {\"Keep Directory\", \"Remove Directory\"} default button \"Keep Directory\" with icon file iconPath with title \"MeticAI Uninstaller\")" -e "return buttonReturned" -e "end tell")
    else
        remove_dir=$(osascript <<EOF
tell application "System Events"
    activate
    set buttonReturned to button returned of (display dialog "Remove Installation Directory?

Do you want to remove the MeticAI installation directory?

$install_dir

This will delete all files in this directory." buttons {"Keep Directory", "Remove Directory"} default button "Keep Directory" with icon caution with title "MeticAI Uninstaller")
    
    return buttonReturned
end tell
EOF
)
    fi
    
    if [ "$remove_dir" = "Remove Directory" ]; then
        cd "$HOME" || cd /
        rm -rf "$install_dir"
        log_message "Removed installation directory: $install_dir"
    else
        log_message "Kept installation directory: $install_dir"
    fi
    
    show_progress "Uninstallation complete!"
    
    return 0
}

# Main uninstallation flow
main() {
    log_message "Starting MeticAI macOS Uninstaller (Fully GUI mode)"
    
    # Show welcome/confirmation dialog
    if ! show_welcome; then
        log_message "Uninstallation cancelled by user"
        exit 0
    fi
    
    # Find installation directory
    log_message "Finding MeticAI installation..."
    show_progress "Locating MeticAI installation..."
    INSTALL_DIR=$(find_installation_dir)
    
    if [ -z "$INSTALL_DIR" ]; then
        log_error "Could not find MeticAI installation"
        if [ -n "$ICON_PATH" ]; then
            osascript -e "tell application \"System Events\"" -e "activate" -e "display dialog \"Installation Not Found\" & return & return & \"Could not locate MeticAI installation directory.\" & return & return & \"Please make sure MeticAI is installed before running the uninstaller.\" buttons {\"OK\"} default button \"OK\" with icon stop with title \"MeticAI Uninstaller\"" -e "end tell"
        else
            osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "Installation Not Found

Could not locate MeticAI installation directory.

Please make sure MeticAI is installed before running the uninstaller." buttons {"OK"} default button "OK" with icon stop with title "MeticAI Uninstaller"
end tell
EOF
        fi
        exit 1
    fi
    
    log_message "Installation directory: $INSTALL_DIR"
    
    # Show starting dialog - inform user it will auto-close
    if [ -n "$ICON_PATH" ]; then
        osascript -e "tell application \"System Events\"" -e "activate" -e "set iconPath to POSIX file \"$ICON_PATH\"" -e "display dialog \"Starting Uninstallation\" & return & return & \"MeticAI will now be uninstalled.\" & return & return & \"This dialog will close automatically.\" buttons {\"OK\"} default button \"OK\" with icon file iconPath giving up after 5" -e "end tell" &
    else
        osascript -e 'tell application "System Events" to display dialog "Starting Uninstallation\n\nMeticAI will now be uninstalled.\n\nThis dialog will close automatically." buttons {"OK"} default button "OK" with icon caution giving up after 5' &
    fi
    
    sleep 1
    
    # Create temporary directory for uninstallation logs
    UNINSTALL_LOG=$(mktemp)
    trap 'rm -f "$UNINSTALL_LOG"' EXIT INT TERM
    
    # Run the uninstallation
    log_message "Running uninstallation..."
    show_progress "Uninstalling MeticAI..."
    
    if run_uninstallation "$INSTALL_DIR" > "$UNINSTALL_LOG" 2>&1; then
        log_message "Uninstallation completed successfully"
        
        # Show success dialog with custom icon
        if [ -n "$ICON_PATH" ]; then
            osascript <<EOF
tell application "System Events"
    activate
    set iconPath to POSIX file "$ICON_PATH"
    display dialog "Uninstallation Complete! ✓

MeticAI has been successfully uninstalled.

• Docker containers removed
• Docker images removed
• Repositories removed
• Configuration files removed
• macOS integrations removed

Docker, Git, and other tools have been kept on your system." buttons {"OK"} default button "OK" with icon file iconPath with title "MeticAI Uninstaller"
end tell
EOF
        else
            osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "Uninstallation Complete! ✓

MeticAI has been successfully uninstalled.

• Docker containers removed
• Docker images removed
• Repositories removed
• Configuration files removed
• macOS integrations removed

Docker, Git, and other tools have been kept on your system." buttons {"OK"} default button "OK" with icon note with title "MeticAI Uninstaller"
end tell
EOF
        fi
        
    else
        log_error "Uninstallation failed"
        
        # Show error dialog
        local error_details=$(tail -20 "$UNINSTALL_LOG" | sed 's/"/\\"/g')
        osascript <<EOF
tell application "System Events"
    activate
    display dialog "Uninstallation Failed

An error occurred during uninstallation.

Please check the uninstallation log for details:
$UNINSTALL_LOG

Last error lines:
${error_details:0:200}

Would you like to view the full log?" buttons {"Close", "View Log"} default button "View Log" with icon stop with title "MeticAI Uninstaller"
    
    if button returned of result is "View Log" then
        do shell script "open -a Console '$UNINSTALL_LOG'"
    end if
end tell
EOF
        exit 1
    fi
    
    log_message "macOS Uninstaller completed successfully"
}

# Run main function
main
