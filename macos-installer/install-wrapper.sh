#!/bin/bash

################################################################################
# MeticAI - macOS Installer Wrapper Script (Fully GUI)
################################################################################
# 
# This script provides a completely GUI-based installation experience for macOS
# users with NO Terminal window. All inputs are collected via AppleScript dialogs,
# and installation runs in the background with progress feedback via GUI.
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

# Get icon path for dialogs
get_icon_path() {
    # Try to find the app bundle we're running from
    if [[ "$0" == *"/Contents/MacOS/"* ]]; then
        # We're running from inside an app bundle
        local bundle_path=$(echo "$0" | sed 's|/Contents/MacOS/.*||')
        local icon_path="$bundle_path/Contents/Resources/AppIcon.icns"
        
        if [ -f "$icon_path" ]; then
            echo "$icon_path"
            return
        fi
    fi
    
    # Fallback to system icon
    echo ""
}

# Display welcome dialog
show_welcome() {
    local icon_path=$(get_icon_path)
    
    if [ -n "$icon_path" ]; then
        osascript <<EOF
tell application "System Events"
    activate
    set iconPath to POSIX file "$icon_path"
    display dialog "Welcome to MeticAI Installer

This installer will guide you through setting up MeticAI - your AI Barista for the Meticulous Espresso Machine.

The installation will:
• Check for prerequisites (Git, Docker)
• Download MeticAI from GitHub
• Guide you through configuration
• Launch the MeticAI services

Click OK to continue." buttons {"Cancel", "OK"} default button "OK" with icon file iconPath with title "MeticAI Installer"
    
    if button returned of result is "Cancel" then
        error number -128
    end if
end tell
EOF
    else
        osascript <<EOF
tell application "System Events"
    activate
    display dialog "Welcome to MeticAI Installer

This installer will guide you through setting up MeticAI - your AI Barista for the Meticulous Espresso Machine.

The installation will:
• Check for prerequisites (Git, Docker)
• Download MeticAI from GitHub
• Guide you through configuration
• Launch the MeticAI services

Click OK to continue." buttons {"Cancel", "OK"} default button "OK" with icon note with title "MeticAI Installer"
    
    if button returned of result is "Cancel" then
        error number -128
    end if
end tell
EOF
    fi
}

# Check for prerequisites and offer to install if missing
check_prerequisites() {
    local missing_tools=()
    local docker_not_running=false
    
    log_message "Checking prerequisites..."
    log_message "PATH: $PATH"
    
    # Check for git
    if ! command -v git &> /dev/null; then
        log_message "Git not found"
        missing_tools+=("Git")
    else
        log_message "Git found at: $(command -v git)"
    fi
    
    # Check for docker - both installed AND running
    if ! command -v docker &> /dev/null; then
        log_message "Docker command not found in PATH"
        missing_tools+=("Docker Desktop")
    else
        local docker_path=$(command -v docker)
        log_message "Docker found at: $docker_path"
        
        # Docker command exists, but check if daemon is running
        if ! docker info &> /dev/null 2>&1; then
            log_message "Docker daemon not responding to 'docker info'"
            docker_not_running=true
        else
            log_message "Docker daemon is running"
        fi
    fi
    
    log_message "Prerequisite check complete. Missing tools: ${missing_tools[*]:-none}, Docker not running: $docker_not_running"
    if [ ${#missing_tools[@]} -gt 0 ] || [ "$docker_not_running" = true ]; then
        local missing_list=$(IFS=", "; echo "${missing_tools[*]}")
        
        if [ "$docker_not_running" = true ] && [ ${#missing_tools[@]} -eq 0 ]; then
            # Docker is installed but not running
            osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "Docker Desktop Not Running

Docker Desktop is installed but not running.

Please start Docker Desktop before continuing with the installation.

You can find Docker Desktop in your Applications folder." buttons {"Cancel", "OK"} default button "OK" with icon caution with title "MeticAI Installer"
end tell
EOF
            exit 1
        else
            # Some tools are missing
            local dialog_result=$(osascript <<EOF
tell application "System Events"
    activate
    set dialogResult to display dialog "Missing Prerequisites

The following required tools are not installed:
${missing_list}

Choose what to do:
• Install Docker Desktop: Download from Docker website
• Install Git: Via Xcode Command Line Tools

Click a button to open the installation page:" buttons {"Cancel", "Install Docker Desktop", "Install Git"} default button "Install Docker Desktop" with icon caution with title "MeticAI Installer"
    
    return button returned of dialogResult
end tell
EOF
)
            
            if [ "$dialog_result" = "Install Docker Desktop" ]; then
                open "https://www.docker.com/products/docker-desktop"
                osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "Opening Docker Desktop Download Page

After installing Docker Desktop:
1. Launch Docker Desktop
2. Wait for it to start (whale icon in menu bar)
3. Run MeticAI Installer again

Click OK to exit installer." buttons {"OK"} default button "OK" with icon note with title "MeticAI Installer"
end tell
EOF
                exit 0
            elif [ "$dialog_result" = "Install Git" ]; then
                # For Git, we need to explain the process since it's via xcode-select
                osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "Installing Git via Xcode Command Line Tools

To install Git:
1. Open Terminal
2. Run: xcode-select --install
3. Follow the installation prompts
4. After installation, run MeticAI Installer again

Click OK to exit installer." buttons {"OK"} default button "OK" with icon note with title "MeticAI Installer"
end tell
EOF
                exit 0
            else
                exit 0
            fi
        fi
    fi
}

# Get installation directory from user
get_install_directory() {
    local default_dir="$HOME/MeticAI"
    
    local install_dir=$(osascript <<EOF
tell application "System Events"
    activate
    set dialogResult to display dialog "Choose Installation Location

Where would you like to install MeticAI?

Default: $default_dir" default answer "$default_dir" buttons {"Cancel", "Choose Folder", "Use Default"} default button "Use Default" with title "MeticAI Installer"
    
    set installPath to text returned of dialogResult
    set buttonPressed to button returned of dialogResult
    
    if buttonPressed is "Choose Folder" then
        set selectedFolder to POSIX path of (choose folder with prompt "Select installation folder:")
        set installPath to selectedFolder & "MeticAI"
    end if
    
    return installPath
end tell
EOF
)
    
    echo "$install_dir"
}

# Get Gemini API key from user
get_api_key() {
    local api_key=""
    local continue_input=false
    
    while [ -z "$api_key" ]; do
        local result=$(osascript <<'EOF'
tell application "System Events"
    activate
    set dialogResult to display dialog "Google Gemini API Key

Please enter your Google Gemini API Key.

This key is required for MeticAI to function.

Click 'Get API Key' to open the Google AI Studio page in your browser." default answer "" buttons {"Cancel", "Get API Key", "Continue"} default button "Continue" with title "MeticAI Installer" with icon note
    
    set buttonPressed to button returned of dialogResult
    set apiKey to text returned of dialogResult
    
    return buttonPressed & "|" & apiKey
end tell
EOF
)
        
        local button=$(echo "$result" | cut -d'|' -f1)
        local key=$(echo "$result" | cut -d'|' -f2-)
        
        if [ "$button" = "Get API Key" ]; then
            # Open the Google AI Studio page
            open "https://aistudio.google.com/app/apikey"
            # Continue the loop to show dialog again
            continue
        elif [ "$button" = "Cancel" ]; then
            exit 0
        else
            # Continue button pressed
            if [ -z "$key" ]; then
                osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "API Key Required

You must provide a Google Gemini API Key to continue.

Please try again." buttons {"OK"} default button "OK" with icon stop with title "MeticAI Installer"
end tell
EOF
            else
                api_key="$key"
            fi
        fi
    done
    
    echo "$api_key"
}

# Get Meticulous machine IP address
get_meticulous_ip() {
    local met_ip=$(osascript <<'EOF'
tell application "System Events"
    activate
    set metIP to text returned of (display dialog "Meticulous Machine IP Address

Please enter the IP address of your Meticulous Espresso Machine.

Example: 192.168.1.100

You can find this in your machine's network settings or router." default answer "" buttons {"Cancel", "Continue"} default button "Continue" with title "MeticAI Installer" with icon note)
    
    return metIP
end tell
EOF
)
    
    # Validate not empty and looks like an IP
    if [ -z "$met_ip" ]; then
        osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "IP Address Required

You must provide the IP address of your Meticulous machine.

Please try again." buttons {"OK"} default button "OK" with icon stop with title "MeticAI Installer"
end tell
EOF
        exit 1
    fi
    
    echo "$met_ip"
}

# Get server IP address (with auto-detection)
get_server_ip() {
    # Try to auto-detect
    local detected_ip=""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        detected_ip=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}' | xargs ipconfig getifaddr 2>/dev/null || echo "")
        
        if [ -z "$detected_ip" ]; then
            for interface in en0 en1 en2 en3 en4; do
                detected_ip=$(ipconfig getifaddr "$interface" 2>/dev/null || echo "")
                if [ -n "$detected_ip" ]; then
                    break
                fi
            done
        fi
    fi
    
    # If detected, offer to use it
    if [ -n "$detected_ip" ]; then
        local response=$(osascript <<EOF
tell application "System Events"
    activate
    set buttonReturned to button returned of (display dialog "Server IP Address Detected

Your server IP address appears to be:
$detected_ip

Would you like to use this address?" buttons {"Use Different", "Use This"} default button "Use This" with title "MeticAI Installer" with icon note)
    
    return buttonReturned
end tell
EOF
)
        
        if [ "$response" = "Use This" ]; then
            echo "$detected_ip"
            return
        fi
    fi
    
    # Ask user to input
    local server_ip=$(osascript <<'EOF'
tell application "System Events"
    activate
    set serverIP to text returned of (display dialog "Server IP Address

Please enter the IP address of this server (the computer running MeticAI).

Example: 192.168.1.50

This is needed so you can access the MeticAI web interface." default answer "" buttons {"Cancel", "Continue"} default button "Continue" with title "MeticAI Installer" with icon note)
    
    return serverIP
end tell
EOF
)
    
    if [ -z "$server_ip" ]; then
        osascript <<'EOF'
tell application "System Events"
    activate
    display dialog "IP Address Required

You must provide the server IP address.

Please try again." buttons {"OK"} default button "OK" with icon stop with title "MeticAI Installer"
end tell
EOF
        exit 1
    fi
    
    echo "$server_ip"
}

# Main installation flow
main() {
    log_message "Starting MeticAI macOS Installer (Fully GUI mode)"
    
    # Show welcome dialog
    if ! show_welcome; then
        log_message "Installation cancelled by user"
        exit 0
    fi
    
    # Check prerequisites
    log_message "Checking prerequisites..."
    check_prerequisites
    
    # Get installation directory
    log_message "Getting installation directory..."
    show_progress "Getting installation location..."
    INSTALL_DIR=$(get_install_directory)
    
    if [ -z "$INSTALL_DIR" ]; then
        log_error "No installation directory selected"
        exit 1
    fi
    
    log_message "Installation directory: $INSTALL_DIR"
    
    # Get API key
    show_progress "Collecting configuration..."
    GEMINI_API_KEY=$(get_api_key)
    log_message "API key collected"
    
    # Get Meticulous IP
    METICULOUS_IP=$(get_meticulous_ip)
    log_message "Meticulous IP: $METICULOUS_IP"
    
    # Get Server IP
    SERVER_IP=$(get_server_ip)
    log_message "Server IP: $SERVER_IP"
    
    # Show installation starting dialog
    osascript <<EOF &
tell application "System Events"
    activate
    display dialog "Starting Installation

MeticAI will now be installed with the following configuration:

Location: $INSTALL_DIR
Server IP: $SERVER_IP
Meticulous IP: $METICULOUS_IP

The installation will run in the background and may take several minutes.

Please click OK and wait for the installation to complete." buttons {"OK"} default button "OK" with icon note with title "MeticAI Installer" giving up after 10
end tell
EOF
    
    sleep 2
    
    # Create parent directory if needed
    PARENT_DIR=$(dirname "$INSTALL_DIR")
    if [ ! -d "$PARENT_DIR" ]; then
        log_message "Creating parent directory: $PARENT_DIR"
        mkdir -p "$PARENT_DIR"
    fi
    
    # Run installation in background
    log_message "Running installation..."
    show_progress "Installing MeticAI..."
    
    # Create temporary directory for installation logs
    INSTALL_LOG=$(mktemp)
    trap 'rm -f "$INSTALL_LOG"' EXIT INT TERM
    
    # Run the installation silently
    if run_installation "$INSTALL_DIR" "$GEMINI_API_KEY" "$METICULOUS_IP" "$SERVER_IP" > "$INSTALL_LOG" 2>&1; then
        log_message "Installation completed successfully"
        
        # Show success dialog with custom icon
        local icon_path=$(get_icon_path)
        
        if [ -n "$icon_path" ]; then
            osascript <<EOF
tell application "System Events"
    activate
    set iconPath to POSIX file "$icon_path"
    display dialog "Installation Complete! ✓

MeticAI has been successfully installed!

🌐 Web Interface:
   http://$SERVER_IP:3550

📱 You can access this from any device on your network.

☕️ Start using MeticAI:
   1. Open the web interface in your browser
   2. Upload a photo of your coffee bag
   3. Let AI create the perfect espresso profile!

The web interface should open automatically in a moment." buttons {"OK"} default button "OK" with icon file iconPath with title "MeticAI Installer"
end tell
EOF
        else
            osascript <<EOF
tell application "System Events"
    activate
    display dialog "Installation Complete! ✓

MeticAI has been successfully installed!

🌐 Web Interface:
   http://$SERVER_IP:3550

📱 You can access this from any device on your network.

☕️ Start using MeticAI:
   1. Open the web interface in your browser
   2. Upload a photo of your coffee bag
   3. Let AI create the perfect espresso profile!

The web interface should open automatically in a moment." buttons {"OK"} default button "OK" with icon note with title "MeticAI Installer"
end tell
EOF
        fi
        
        # Open web interface
        sleep 2
        open "http://$SERVER_IP:3550" 2>/dev/null || true
        
    else
        log_error "Installation failed"
        
        # Show error dialog
        local error_details=$(tail -20 "$INSTALL_LOG" | sed 's/"/\\"/g')
        osascript <<EOF
tell application "System Events"
    activate
    display dialog "Installation Failed

An error occurred during installation.

Please check the installation log for details:
$INSTALL_LOG

You can try:
• Ensuring Docker Desktop is running
• Checking your internet connection
• Running the installer again

Last error lines:
${error_details:0:200}

Would you like to view the full log?" buttons {"Close", "View Log"} default button "View Log" with icon stop with title "MeticAI Installer"
    
    if button returned of result is "View Log" then
        do shell script "open -a Console '$INSTALL_LOG'"
    end if
end tell
EOF
        exit 1
    fi
    
    log_message "macOS Installer completed successfully"
}

# Run the actual installation by delegating to local-install.sh
run_installation() {
    local install_dir="$1"
    local api_key="$2"
    local meticulous_ip="$3"
    local server_ip="$4"
    
    echo "PROGRESS:5"
    echo "Cloning MeticAI repository..."
    
    # Clone the repository if it doesn't exist
    if [ -d "$install_dir" ]; then
        rm -rf "$install_dir"
    fi
    
    if ! git clone -b main https://github.com/hessius/MeticAI.git "$install_dir"; then
        echo "ERROR: Failed to clone repository"
        return 1
    fi
    
    cd "$install_dir" || return 1
    
    echo "PROGRESS:15"
    echo "Running installer..."
    
    # Export environment variables for non-interactive mode
    export METICAI_NON_INTERACTIVE=true
    export METICAI_PROGRESS_FORMAT=platypus
    export GEMINI_API_KEY="$api_key"
    export METICULOUS_IP="$meticulous_ip"
    export PI_IP="$server_ip"
    export SKIP_PREVIOUS_INSTALL_CHECK=true
    export FORCE_RECLONE=true
    export SKIP_DOCK_SHORTCUT=false  # We want the dock shortcut
    export SKIP_REBUILD_WATCHER=true  # Skip interactive watcher install
    
    # Run local-install.sh in non-interactive mode
    if ! ./local-install.sh; then
        echo "ERROR: Installation failed"
        return 1
    fi
    
    echo "PROGRESS:100"
    echo "Installation complete!"
    
    return 0
}

# Run main function
main