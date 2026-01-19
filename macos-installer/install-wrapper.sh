#!/bin/bash

################################################################################
# MeticAI - macOS Installer Wrapper Script
################################################################################
# 
# This script provides a GUI-based installation experience for macOS users
# by wrapping the web_install.sh script with AppleScript dialogs for input
# collection and progress display.
#
# This script is designed to be packaged with Platypus to create a standalone
# macOS .app bundle.
#
################################################################################

# Exit on error
set -e

# Logging functions
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo "ERROR: $1" >&2
}

# Display welcome dialog
show_welcome() {
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
}

# Check for prerequisites and offer to install if missing
check_prerequisites() {
    local missing_tools=()
    
    # Check for git
    if ! command -v git &> /dev/null; then
        missing_tools+=("Git")
    fi
    
    # Check for docker
    if ! command -v docker &> /dev/null; then
        missing_tools+=("Docker")
    fi
    
    if [ ${#missing_tools[@]} -gt 0 ]; then
        local missing_list=$(IFS=", "; echo "${missing_tools[*]}")
        
        osascript <<EOF
tell application "System Events"
    activate
    display dialog "Missing Prerequisites

The following required tools are not installed:
${missing_list}

Installation Instructions:

• Docker Desktop: Download from https://www.docker.com/products/docker-desktop
  - Install and make sure Docker Desktop is running before continuing

• Git: Install via Xcode Command Line Tools:
  - Open Terminal and run: xcode-select --install

Would you like to open the installation links?" buttons {"Cancel", "Open Links"} default button "Open Links" with icon caution with title "MeticAI Installer"
    
    if button returned of result is "Open Links" then
        do shell script "open 'https://www.docker.com/products/docker-desktop'"
    end if
    
    error number -128
end tell
EOF
        exit 1
    fi
}

# Get installation directory from user
get_install_directory() {
    local default_dir="$HOME/MeticAI"
    
    local install_dir=$(osascript <<EOF
tell application "System Events"
    activate
    set installPath to text returned of (display dialog "Choose Installation Location

Where would you like to install MeticAI?

Default: $default_dir" default answer "$default_dir" buttons {"Cancel", "Choose Folder", "Use Default"} default button "Use Default" with title "MeticAI Installer")
    
    if button returned of result is "Choose Folder" then
        set installPath to POSIX path of (choose folder with prompt "Select installation folder:")
        set installPath to installPath & "MeticAI"
    end if
    
    return installPath
end tell
EOF
)
    
    echo "$install_dir"
}

# Main installation flow
main() {
    log_message "Starting MeticAI macOS Installer"
    
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
    INSTALL_DIR=$(get_install_directory)
    
    if [ -z "$INSTALL_DIR" ]; then
        log_error "No installation directory selected"
        exit 1
    fi
    
    log_message "Installation directory: $INSTALL_DIR"
    
    # Create parent directory if needed
    PARENT_DIR=$(dirname "$INSTALL_DIR")
    if [ ! -d "$PARENT_DIR" ]; then
        log_message "Creating parent directory: $PARENT_DIR"
        mkdir -p "$PARENT_DIR"
    fi
    
    # Download and execute the web installer
    log_message "Downloading and executing web installer..."
    
    # Create a temporary script that will handle the installation
    TEMP_SCRIPT=$(mktemp)
    
    cat > "$TEMP_SCRIPT" <<'INSTALLER_SCRIPT'
#!/bin/bash

# This script runs the web installer with pre-configured settings
set -e

INSTALL_DIR="$1"

# Export environment variables to skip interactive prompts where possible
export METICAI_INSTALL_METHOD="macos_installer"
export SKIP_DOCK_SHORTCUT="false"  # Allow dock shortcut creation
export SKIP_REBUILD_WATCHER="false"  # Allow rebuild watcher installation

# Download the web installer
echo "Downloading MeticAI installer..."
TEMP_INSTALLER=$(mktemp)
if ! curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh -o "$TEMP_INSTALLER"; then
    echo "ERROR: Failed to download installer"
    exit 1
fi

chmod +x "$TEMP_INSTALLER"

# Set installation directory by pre-answering prompts
# The web installer will ask for location - we'll provide non-interactive answers
export LOCATION_CHOICE="3"
export CUSTOM_PATH="$INSTALL_DIR"

echo "Starting MeticAI installation..."
echo "Installation directory: $INSTALL_DIR"
echo ""

# Execute the installer
# Note: The installer will still be interactive for API key and IP addresses
# as these are sensitive/variable inputs that should be user-provided
exec "$TEMP_INSTALLER"
INSTALLER_SCRIPT
    
    chmod +x "$TEMP_SCRIPT"
    
    # Execute in a new Terminal window so users can see the installation progress
    # and provide inputs (API key, IP addresses, etc.)
    osascript <<EOF
tell application "Terminal"
    activate
    do script "$TEMP_SCRIPT \"$INSTALL_DIR\""
end tell
EOF
    
    # Show completion message
    osascript <<EOF
tell application "System Events"
    activate
    display dialog "MeticAI Installer

The installation will continue in Terminal.

Please follow the prompts in the Terminal window to:
• Enter your Google Gemini API Key
• Configure your Meticulous machine IP address
• Configure your server IP address

The Terminal window will show the installation progress.

When installation is complete, you'll see a QR code to access the MeticAI web interface." buttons {"OK"} default button "OK" with icon note with title "MeticAI Installer"
end tell
EOF
    
    log_message "Installation script launched in Terminal"
    log_message "macOS Installer wrapper completed successfully"
}

# Run main function
main
