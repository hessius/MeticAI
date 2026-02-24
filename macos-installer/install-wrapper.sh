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

# Auto-detect Meticulous machine on the network via Bonjour.
# The machine advertises as "meticulous<Name>._http._tcp.local."
# We browse for HTTP services, find the one whose name starts with
# "meticulous", then look it up to extract its IP.
# Writes result to /tmp/meticai-result.txt and returns 0 on success.
detect_meticulous() {
    local result_file="/tmp/meticai-result.txt"
    rm -f "$result_file"

    local tmpfile
    tmpfile=$(mktemp /tmp/meticai-detect.XXXXXX)

    # --- Step 1: Browse Bonjour for HTTP services ---
    # dns-sd never exits on its own — run it, wait, force-kill.
    dns-sd -B _http._tcp local > "$tmpfile" 2>/dev/null &
    local pid=$!
    sleep 3
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null

    # Find the service instance whose name starts with "meticulous" (case-insensitive)
    local service_name
    service_name=$(grep -i 'meticulous' "$tmpfile" | awk '{for(i=7;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ *$//' | head -1)
    rm -f "$tmpfile"

    if [[ -z "$service_name" ]]; then
        return 1
    fi

    # --- Step 2: Lookup the service to resolve hostname & IP ---
    local lookup_file
    lookup_file=$(mktemp /tmp/meticai-lookup.XXXXXX)
    dns-sd -L "$service_name" _http._tcp local > "$lookup_file" 2>/dev/null &
    pid=$!
    sleep 3
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null

    # Extract IPv4 from the ips=[...] field (e.g. ips=\['192.168.50.168',...\])
    local ip
    ip=$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$lookup_file" | head -1)

    if [[ -z "$ip" ]]; then
        # Fallback: extract the hostname from "can be reached at <host>.local.:port"
        local hostname
        hostname=$(grep 'can be reached at' "$lookup_file" | sed 's/.*can be reached at //' | sed 's/\.:.*/:/' | cut -d: -f1)
        rm -f "$lookup_file"
        if [[ -n "$hostname" ]]; then
            ip=$(resolve_hostname_to_ip "$hostname")
        fi
    else
        rm -f "$lookup_file"
    fi

    if [[ -n "$ip" ]]; then
        echo "$ip" > "$result_file"
        return 0
    fi
    return 1
}

# Resolve a .local hostname to an IP address
resolve_hostname_to_ip() {
    local hostname="$1"
    local ip=""

    # Append .local if not already present
    [[ "$hostname" != *.local ]] && hostname="${hostname}.local"

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
    local existing_note=""
    if [ -f "${DEFAULT_INSTALL_DIR}/.env" ]; then
        existing_note="\n\n⚠️ An existing installation was found at the default location."
    fi

    result=$(show_dialog "Choose Installation Location

MeticAI files will be stored in this folder.
Default: ${DEFAULT_INSTALL_DIR}${existing_note}

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

    # Check for old v1 installation (multi-container setup)
    local IS_V1=false
    if [ -d "$INSTALL_DIR" ]; then
        if [ -f "$INSTALL_DIR/rebuild-watcher.sh" ] || [ -f "$INSTALL_DIR/local-install.sh" ]; then
            IS_V1=true
        elif [ -f "$INSTALL_DIR/docker-compose.yml" ] && grep -q "meticai-server\|meticai-web" "$INSTALL_DIR/docker-compose.yml" 2>/dev/null; then
            IS_V1=true
        fi
    fi

    if [ "$IS_V1" = "true" ]; then
        result=$(show_dialog "Old MeticAI v1 Installation Detected

An older MeticAI v1 installation was found at:
${INSTALL_DIR}

MeticAI v2.0 uses a completely new unified-container architecture. A fresh install is recommended.

Would you like to stop the old containers and proceed with a fresh install?" '"Cancel", "Fresh Install"' "Fresh Install" "caution")

        if [ "$result" != "Fresh Install" ]; then
            exit 0
        fi
        show_progress "Stopping old containers..."
        cd "$INSTALL_DIR" 2>/dev/null && docker compose down 2>/dev/null || true
        cd "$HOME"
    fi

    # Check for existing v2 installation at chosen path
    if [ "$IS_V1" = "false" ] && [ -f "${INSTALL_DIR}/.env" ]; then
        result=$(show_dialog "Existing Installation Found

MeticAI is already installed at ${INSTALL_DIR}

What would you like to do?" '"Cancel", "Reinstall", "Update"' "Update")
        
        case "$result" in
            "Update")
                show_progress "Updating MeticAI..."
                cd "$INSTALL_DIR"
                source .env 2>/dev/null || true
                eval "docker compose \${COMPOSE_FILES:--f docker-compose.yml} pull"
                eval "docker compose \${COMPOSE_FILES:--f docker-compose.yml} up -d"
                
                local update_ip=""
                local iface
                iface=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}')
                if [ -n "$iface" ]; then
                    update_ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
                fi
                if [ -z "$update_ip" ]; then
                    for iface in en0 en1 en2 en3 en4; do
                        update_ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
                        [ -n "$update_ip" ] && break
                    done
                fi
                update_ip=${update_ip:-localhost}

                show_dialog "MeticAI Updated!

Access MeticAI at:
http://${update_ip}:3550

The services are now running in the background." '"OK"' "OK"
                
                # Open browser
                open "http://${update_ip}:3550"
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
    # Run detection directly (not in a subshell) so dns-sd can be killed.
    # Result is written to /tmp/meticai-result.txt.
    DETECTED_IP=""
    if detect_meticulous 2>/dev/null; then
        DETECTED_IP=$(cat /tmp/meticai-result.txt 2>/dev/null)
        rm -f /tmp/meticai-result.txt
    fi

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
    
    # ---- Optional Features ----

    # Watchtower (automatic updates)
    result=$(show_dialog "Optional Features — Automatic Updates

Would you like to enable automatic updates?
(Watchtower will check for updates every 6 hours)" '"No", "Yes"' "Yes")
    
    ENABLE_WATCHTOWER="n"
    if [ "$result" = "Yes" ]; then
        ENABLE_WATCHTOWER="y"
    fi

    # Tailscale (remote access)
    result=$(show_dialog "Optional Features — Remote Access

Would you like to enable Tailscale for remote access?

This lets you access MeticAI from anywhere using a free Tailscale account.

Learn more: https://tailscale.com" '"No", "Yes"' "No")

    ENABLE_TAILSCALE="n"
    TAILSCALE_AUTHKEY=""
    if [ "$result" = "Yes" ]; then
        ENABLE_TAILSCALE="y"
        TAILSCALE_AUTHKEY=$(show_input_dialog "Tailscale Auth Key

Get an auth key from:
https://login.tailscale.com/admin/settings/keys

Paste your auth key below:" "")

        if [ -z "$TAILSCALE_AUTHKEY" ]; then
            show_dialog "No auth key provided — Tailscale will be skipped." '"OK"' "OK" "caution"
            ENABLE_TAILSCALE="n"
        fi
    fi

    # Home Assistant MQTT
    result=$(show_dialog "Optional Features — Home Assistant

Would you like to enable Home Assistant MQTT integration?

This exposes the MQTT broker on port 1883 for Home Assistant to connect to." '"No", "Yes"' "No")

    ENABLE_HA="n"
    if [ "$result" = "Yes" ]; then
        ENABLE_HA="y"
    fi
    
    # Create installation directory
    show_progress "Installing MeticAI..."
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    # Download compose files and config
    show_progress "Downloading configuration..."
    curl -fsSL "${REPO_URL}/docker-compose.yml" -o docker-compose.yml
    curl -fsSL "${REPO_URL}/docker-compose.watchtower.yml" -o docker-compose.watchtower.yml 2>/dev/null || true
    curl -fsSL "${REPO_URL}/docker-compose.tailscale.yml" -o docker-compose.tailscale.yml 2>/dev/null || true
    curl -fsSL "${REPO_URL}/docker-compose.homeassistant.yml" -o docker-compose.homeassistant.yml 2>/dev/null || true
    curl -fsSL "${REPO_URL}/tailscale-serve.json" -o tailscale-serve.json 2>/dev/null || true
    mkdir -p docker
    curl -fsSL "${REPO_URL}/docker/mosquitto-external.conf" -o docker/mosquitto-external.conf 2>/dev/null || true

    # Build compose files list
    COMPOSE_FILES="-f docker-compose.yml"

    # Create .env file
    cat > .env << EOF
# MeticAI Configuration
# Generated by macOS Installer on $(date)

# Required
GEMINI_API_KEY=${GEMINI_API_KEY}
METICULOUS_IP=${METICULOUS_IP}

# Image tag
METICAI_TAG=${METICAI_TAG}
EOF
    
    if [ "$ENABLE_WATCHTOWER" = "y" ]; then
        WATCHTOWER_TOKEN=$(openssl rand -hex 16)
        echo "WATCHTOWER_TOKEN=${WATCHTOWER_TOKEN}" >> .env
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.watchtower.yml"
    fi

    if [ "$ENABLE_TAILSCALE" = "y" ] && [ -n "$TAILSCALE_AUTHKEY" ]; then
        echo "TAILSCALE_AUTHKEY=${TAILSCALE_AUTHKEY}" >> .env
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tailscale.yml"
    fi

    if [ "$ENABLE_HA" = "y" ]; then
        COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.homeassistant.yml"
    fi
    
    echo "" >> .env
    echo "# Compose files to load" >> .env
    echo "COMPOSE_FILES=\"$COMPOSE_FILES\"" >> .env

    # Verify all referenced compose files exist
    local missing_files=false
    for cf in $COMPOSE_FILES; do
        if [[ "$cf" == "-f" ]]; then continue; fi
        if [[ ! -f "$cf" ]]; then
            missing_files=true
            break
        fi
    done
    if [[ "$missing_files" == "true" ]]; then
        show_dialog "Warning: Some optional compose files could not be downloaded. Proceeding with base configuration only." '"OK"' "OK" "caution"
        COMPOSE_FILES="-f docker-compose.yml"
        sed -i '' "s|^COMPOSE_FILES=.*|COMPOSE_FILES=\"$COMPOSE_FILES\"|" .env
    fi

    # Generate convenience scripts
    cat > start.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} up -d
SCRIPT_END
    chmod +x start.sh

    cat > stop.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down
SCRIPT_END
    chmod +x stop.sh

    cat > update.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
echo "Pulling latest MeticAI image..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} pull
echo "Restarting..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} up -d
echo "Updated!"
SCRIPT_END
    chmod +x update.sh

    cat > uninstall.sh << 'SCRIPT_END'
#!/bin/bash
cd "$(dirname "$0")"
source .env 2>/dev/null
echo ""
echo "  MeticAI Uninstaller"
echo "  ==================="
echo ""
INSTALL_PATH="$(pwd)"

# Safety: refuse to operate on git repos or dev checkouts
if [[ -d "${INSTALL_PATH}/.git" ]]; then
    echo "  ⛔ ERROR: This directory is a Git repository."
    echo "  The uninstaller will NOT modify development checkouts."
    echo "  Use git or your file manager to manage this directory."
    exit 1
fi
if [[ -f "${INSTALL_PATH}/.meticai-dev" ]]; then
    echo "  ⛔ ERROR: This directory has a .meticai-dev marker."
    echo "  It is marked as a development environment and will not be modified."
    exit 1
fi

echo "This will stop MeticAI and remove all files from ${INSTALL_PATH}."
echo "Your data (profiles, history) is stored in a Docker volume and will be preserved."
echo ""
read -p "Are you sure? (y/N): " CONFIRM < /dev/tty
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi
echo ""
echo "Stopping containers..."
docker compose ${COMPOSE_FILES:--f docker-compose.yml} down 2>/dev/null || true
read -p "Also remove data volume (profiles, history, settings)? (y/N): " REMOVE_DATA < /dev/tty
if [[ "$REMOVE_DATA" =~ ^[Yy]$ ]]; then
    echo "Removing data volumes..."
    docker volume rm meticai-data 2>/dev/null || true
    docker volume rm mosquitto-data 2>/dev/null || true
    docker volume rm meticai-tailscale-state 2>/dev/null || true
    echo "Data volumes removed"
fi
read -p "Also remove the MeticAI Docker image? (y/N): " REMOVE_IMAGE < /dev/tty
if [[ "$REMOVE_IMAGE" =~ ^[Yy]$ ]]; then
    docker rmi "ghcr.io/hessius/meticai:${METICAI_TAG:-latest}" 2>/dev/null || true
    echo "Image removed"
fi
if [[ -d "/Applications/MeticAI.app" ]]; then
    echo "Removing macOS app shortcut..."
    rm -rf "/Applications/MeticAI.app" 2>/dev/null || sudo rm -rf "/Applications/MeticAI.app" 2>/dev/null || true
fi
echo ""
echo "MeticAI has been uninstalled."
echo "To remove the installation directory: rm -rf ${INSTALL_PATH}"
echo ""
SCRIPT_END
    chmod +x uninstall.sh

    # Pull and start
    show_progress "Pulling Docker images (this may take a few minutes)..."
    eval "docker compose ${COMPOSE_FILES} pull"
    
    show_progress "Starting MeticAI..."
    eval "docker compose ${COMPOSE_FILES} up -d"
    
    # Wait for startup
    sleep 10
    
    # Get server IP — try default route interface, then en0-en4 fallback
    local server_ip=""
    local iface
    iface=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}')
    if [ -n "$iface" ]; then
        server_ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
    fi
    if [ -z "$server_ip" ]; then
        for iface in en0 en1 en2 en3 en4; do
            server_ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
            [ -n "$server_ip" ] && break
        done
    fi
    server_ip=${server_ip:-localhost}

    # Offer macOS Dock shortcut
    result=$(show_dialog "Add Dock Shortcut?

Would you like to add a MeticAI shortcut to your Dock?

This creates a simple app that opens the MeticAI web interface." '"No", "Yes"' "Yes")

    if [ "$result" = "Yes" ]; then
        local APP_PATH="/Applications/MeticAI.app"
        local APP_URL="http://${server_ip}:3550"

        mkdir -p "${APP_PATH}/Contents/MacOS"
        mkdir -p "${APP_PATH}/Contents/Resources"

        cat > "${APP_PATH}/Contents/MacOS/MeticAI" << APPEOF
#!/bin/bash
open "${APP_URL}"
APPEOF
        chmod +x "${APP_PATH}/Contents/MacOS/MeticAI"

        # Download the proper .icns icon
        curl -fsSL "${REPO_URL}/resources/MeticAI.icns" \
            -o "${APP_PATH}/Contents/Resources/AppIcon.icns" 2>/dev/null || true

        cat > "${APP_PATH}/Contents/Info.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>MeticAI</string>
    <key>CFBundleIdentifier</key>
    <string>com.meticai.app</string>
    <key>CFBundleName</key>
    <string>MeticAI</string>
    <key>CFBundleVersion</key>
    <string>2.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
</dict>
</plist>
PLISTEOF

        # Add the app to the Dock
        # Uses defaults to append a persistent-apps entry
        defaults write com.apple.dock persistent-apps -array-add \
            "<dict>
                <key>tile-data</key>
                <dict>
                    <key>file-data</key>
                    <dict>
                        <key>_CFURLString</key>
                        <string>file://${APP_PATH}/</string>
                        <key>_CFURLStringType</key>
                        <integer>15</integer>
                    </dict>
                    <key>file-label</key>
                    <string>MeticAI</string>
                    <key>file-type</key>
                    <integer>41</integer>
                </dict>
                <key>tile-type</key>
                <string>file-tile</string>
            </dict>"
        killall Dock 2>/dev/null || true
    fi

    # Build feature summary for success dialog
    local features=""
    [ "$ENABLE_WATCHTOWER" = "y" ] && features="${features}\n• Automatic updates (Watchtower)"
    [ "$ENABLE_TAILSCALE" = "y" ] && features="${features}\n• Remote access (Tailscale)"
    [ "$ENABLE_HA" = "y" ] && features="${features}\n• Home Assistant MQTT (port 1883)"
    [ -n "$features" ] && features="\n\nEnabled features:${features}"
    
    # Success!
    show_dialog "Installation Complete! ☕

MeticAI is now running.

Access the web interface at:
http://${server_ip}:3550${features}

Useful scripts in ${INSTALL_DIR}:
• start.sh / stop.sh / update.sh / uninstall.sh

The services will start automatically when Docker Desktop runs.

Click OK to open the web interface." '"OK"' "OK"
    
    # Open browser
    open "http://${server_ip}:3550"
}

# Run main
main "$@"
