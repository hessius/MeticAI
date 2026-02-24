#!/bin/bash

################################################################################
# MeticAI - macOS Uninstaller Wrapper Script (v2.0)
################################################################################
# 
# This script provides a GUI-based uninstallation experience for macOS users.
# Designed to be packaged with Platypus as a standalone .app bundle.
#
# Safety features:
#   - Detects install location from running Docker containers
#   - Falls back to user folder-chooser if container not running
#   - REFUSES to delete directories containing .git (dev checkouts)
#   - REFUSES to delete directories containing .meticai-dev marker
#   - "Keep Data" only removes configuration, never rm -rf
#
################################################################################

set -e

# Set PATH to ensure we can find Docker
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Default — only used as a hint for the folder picker
DEFAULT_INSTALL_DIR="${HOME}/MeticAI"

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

# Show text input dialog
show_input_dialog() {
    local prompt="$1"
    local default_value="$2"
    osascript <<EOF
tell application "System Events"
    activate
    set dialogResult to display dialog "$prompt" default answer "$default_value" buttons {"Cancel", "OK"} default button "OK" with title "MeticAI Uninstaller"
    return text returned of dialogResult
end tell
EOF
}

# Show a folder-chooser dialog
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
    osascript -e "display notification \"$message\" with title \"MeticAI Uninstaller\""
}

# Detect the install directory from running MeticAI Docker containers.
# Docker labels or `docker compose ls` can reveal the project directory.
detect_install_from_docker() {
    # Method 1: docker compose ls — lists project directories
    local project_dir=""
    if docker compose ls --format json 2>/dev/null | grep -q "meticai\|MeticAI"; then
        project_dir=$(docker compose ls --format json 2>/dev/null \
            | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    name = p.get('Name','').lower()
    if 'meticai' in name:
        # ConfigFiles is like '/path/docker-compose.yml,...'
        cf = p.get('ConfigFiles','').split(',')[0]
        import os.path
        print(os.path.dirname(cf))
        break
" 2>/dev/null)
    fi

    if [[ -n "$project_dir" ]] && [[ -d "$project_dir" ]]; then
        echo "$project_dir"
        return 0
    fi

    # Method 2: inspect running containers for the meticai label
    local container_id
    container_id=$(docker ps --filter "name=meticai" --format "{{.ID}}" 2>/dev/null | head -1)
    if [[ -n "$container_id" ]]; then
        project_dir=$(docker inspect "$container_id" \
            --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null)
        if [[ -n "$project_dir" ]] && [[ -d "$project_dir" ]]; then
            echo "$project_dir"
            return 0
        fi
    fi

    return 1
}

# Validate that a directory looks like a MeticAI installation (not a dev checkout)
validate_install_dir() {
    local dir="$1"

    # Safety: NEVER delete a git repository
    if [ -d "${dir}/.git" ]; then
        show_dialog "⛔ Safety Check Failed

The selected folder appears to be a Git repository (development checkout):
${dir}

The uninstaller will NOT delete development folders.
Please use 'git' or Finder to manage this directory manually." '"OK"' "OK" "stop"
        return 1
    fi

    # Safety: NEVER delete a folder with .meticai-dev marker
    if [ -f "${dir}/.meticai-dev" ]; then
        show_dialog "⛔ Safety Check Failed

The selected folder contains a .meticai-dev marker file:
${dir}

This folder is marked as a development environment and will NOT be deleted." '"OK"' "OK" "stop"
        return 1
    fi

    # Verify it looks like a MeticAI installation
    if [ ! -f "${dir}/docker-compose.yml" ] && [ ! -f "${dir}/.env" ]; then
        result=$(show_dialog "This folder does not appear to be a MeticAI installation:
${dir}

No docker-compose.yml or .env file was found.

Are you sure you want to proceed?" '"Cancel", "Proceed Anyway"' "Cancel" "caution")
        if [ "$result" != "Proceed Anyway" ]; then
            return 1
        fi
    fi

    return 0
}

# Main uninstallation flow
main() {
    # Welcome / confirmation
    result=$(show_dialog "MeticAI Uninstaller

This will help you remove MeticAI from your Mac.

Click Continue to begin." '"Cancel", "Continue"' "Continue" "caution")
    
    if [ "$result" != "Continue" ]; then
        exit 0
    fi

    # --- Detect install location ---
    local INSTALL_DIR=""

    show_progress "Looking for MeticAI installation..."
    INSTALL_DIR=$(detect_install_from_docker 2>/dev/null || true)

    if [[ -n "$INSTALL_DIR" ]]; then
        # Found from Docker — confirm with user
        result=$(show_dialog "MeticAI Installation Found

Detected MeticAI running from:
${INSTALL_DIR}

Is this the installation you want to remove?" '"Cancel", "Browse…", "Yes, Remove"' "Yes, Remove")

        case "$result" in
            "Yes, Remove")
                # proceed with detected dir
                ;;
            "Browse…")
                INSTALL_DIR=""  # fall through to folder picker below
                ;;
            *)
                exit 0
                ;;
        esac
    fi

    if [[ -z "$INSTALL_DIR" ]]; then
        # Try default location
        if [ -f "${DEFAULT_INSTALL_DIR}/docker-compose.yml" ] || [ -f "${DEFAULT_INSTALL_DIR}/.env" ]; then
            result=$(show_dialog "MeticAI Installation Found

Found an installation at the default location:
${DEFAULT_INSTALL_DIR}

Is this the installation you want to remove?" '"Cancel", "Browse…", "Yes, Remove"' "Yes, Remove")

            case "$result" in
                "Yes, Remove")
                    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
                    ;;
                "Browse…")
                    INSTALL_DIR=""
                    ;;
                *)
                    exit 0
                    ;;
            esac
        fi
    fi

    if [[ -z "$INSTALL_DIR" ]]; then
        # Ask user to locate their installation
        result=$(show_dialog "Locate MeticAI Installation

Could not automatically detect your MeticAI installation.

Please browse to the folder where MeticAI was installed." '"Cancel", "Browse…"' "Browse…")

        if [ "$result" != "Browse…" ]; then
            exit 0
        fi

        local chosen
        chosen=$(choose_folder "Select your MeticAI installation folder" "$HOME")
        if [ -z "$chosen" ]; then
            exit 0
        fi
        INSTALL_DIR="${chosen%/}"
    fi

    # --- Safety validation ---
    if ! validate_install_dir "$INSTALL_DIR"; then
        exit 1
    fi
    
    # --- Confirm uninstallation ---
    result=$(show_dialog "Confirm Uninstall

This will uninstall MeticAI from:
${INSTALL_DIR}

• Stop and remove Docker containers
• Remove configuration files

Are you sure?" '"Cancel", "Uninstall"' "Cancel" "caution")
    
    if [ "$result" != "Uninstall" ]; then
        exit 0
    fi
    
    # --- Ask about data ---
    result=$(show_dialog "Remove Data?

Would you like to also remove all MeticAI data?
(Profiles, shot history, settings stored in Docker volumes)

This cannot be undone." '"Keep Data", "Remove Everything"' "Keep Data" "caution")
    
    REMOVE_DATA="n"
    if [ "$result" = "Remove Everything" ]; then
        REMOVE_DATA="y"
    fi
    
    # --- Stop containers ---
    show_progress "Stopping MeticAI containers..."
    
    if [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
        cd "$INSTALL_DIR"
        # Source .env to get COMPOSE_FILES for proper teardown
        source .env 2>/dev/null || true
        eval "docker compose \${COMPOSE_FILES:--f docker-compose.yml} down" 2>/dev/null || true
        cd "$HOME"
    fi
    
    # --- Remove Docker volumes if requested ---
    if [ "$REMOVE_DATA" = "y" ]; then
        show_progress "Removing data volumes..."
        docker volume rm meticai-data 2>/dev/null || true
        docker volume rm mosquitto-data 2>/dev/null || true
        docker volume rm meticai-tailscale-state 2>/dev/null || true
    fi
    
    # --- Remove Docker image (optional) ---
    result=$(show_dialog "Remove Docker Image?

Would you like to also remove the MeticAI Docker image to free disk space?

(You can always re-download it later)" '"Keep Image", "Remove Image"' "Keep Image")

    if [ "$result" = "Remove Image" ]; then
        show_progress "Removing Docker image..."
        # Read tag from .env if available
        local tag="latest"
        if [ -f "${INSTALL_DIR}/.env" ]; then
            local env_tag
            env_tag=$(grep "^METICAI_TAG=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2)
            [ -n "$env_tag" ] && tag="$env_tag"
        fi
        docker rmi "ghcr.io/hessius/meticai:${tag}" 2>/dev/null || true
    fi

    # --- Remove installation files ---
    show_progress "Removing installation files..."
    
    if [ "$REMOVE_DATA" = "y" ]; then
        # Full removal — delete the entire directory
        rm -rf "$INSTALL_DIR"
    else
        # Keep data safe — only remove MeticAI-specific files, not the whole tree
        cd "$INSTALL_DIR" 2>/dev/null || true
        rm -f docker-compose.yml docker-compose.watchtower.yml \
              docker-compose.tailscale.yml docker-compose.homeassistant.yml \
              tailscale-serve.json .env \
              start.sh stop.sh update.sh uninstall.sh 2>/dev/null || true
        rm -rf docker/ 2>/dev/null || true
        cd "$HOME"

        # If the directory is now empty, remove it
        if [ -d "$INSTALL_DIR" ] && [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
            rmdir "$INSTALL_DIR" 2>/dev/null || true
        fi
    fi
    
    # --- Remove macOS app shortcut ---
    if [ -d "/Applications/MeticAI.app" ]; then
        show_progress "Removing Dock shortcut..."
        rm -rf "/Applications/MeticAI.app" 2>/dev/null || sudo rm -rf "/Applications/MeticAI.app" 2>/dev/null || true
    fi

    # --- Success ---
    if [ "$REMOVE_DATA" = "y" ]; then
        show_dialog "MeticAI Uninstalled ☕

All MeticAI files and data have been removed.

Thank you for using MeticAI!" '"OK"' "OK"
    else
        show_dialog "MeticAI Uninstalled ☕

MeticAI configuration has been removed. Your data is preserved
in the Docker volume 'meticai-data'.

To completely remove data later, run:
docker volume rm meticai-data

Thank you for using MeticAI!" '"OK"' "OK"
    fi
}

# Run main
main "$@"
