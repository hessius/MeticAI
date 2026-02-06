#!/usr/bin/env bats
# Comprehensive tests for local-install.sh script
#
# Tests cover:
# - Script syntax and structure
# - Shebang and permissions
# - Key functionality checks

# Test against the actual script location
SCRIPT_PATH="${BATS_TEST_DIRNAME}/../local-install.sh"

@test "Script file exists and is readable" {
    [ -f "$SCRIPT_PATH" ]
    [ -r "$SCRIPT_PATH" ]
}

@test "Script has correct shebang" {
    run head -n 1 "$SCRIPT_PATH"
    [[ "$output" == "#!/bin/bash" ]]
}

@test "Script is executable" {
    [ -x "$SCRIPT_PATH" ]
}

@test "Script has valid bash syntax" {
    run bash -n "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains prerequisite checks for git" {
    run grep -q "command -v git" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains prerequisite checks for docker" {
    run grep -q "command -v docker" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains prerequisite checks for qrencode" {
    run grep -q "command -v qrencode" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script prompts to install qrencode in prerequisites section" {
    run grep -q "Would you like to install qrencode now?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script marks qrencode as optional dependency" {
    run grep -q "qrencode is not installed (used for QR code generation)" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script continues installation if qrencode install fails" {
    run grep -q "Warning: qrencode installation failed. QR code may not be available" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script validates API key is not empty" {
    run grep -q "API Key cannot be empty" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script validates IP address is not empty" {
    run grep -q "IP Address cannot be empty" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script creates .env file with proper variables" {
    run grep -q "GEMINI_API_KEY=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "METICULOUS_IP=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "PI_IP=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script clones meticulous-mcp repository" {
    run grep -q "github.com/hessius/meticulous-mcp.git" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses docker compose commands" {
    run grep -q "docker compose" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays welcome banner" {
    run grep -q "Barista AI Installer" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script shows progress indicators" {
    run grep -q "\[1/4\]" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "\[2/4\]" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "\[3/4\]" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "\[4/4\]" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles existing meticulous-source directory" {
    run grep -q "already exists" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides API key link to users" {
    run grep -q "aistudio.google.com/app/api-keys" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script auto-detects server IP" {
    run grep -q "detect_ip" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script scans for Meticulous machines on network" {
    run grep -q "scan_for_meticulous" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks for existing .env file at start" {
    run grep -q "Found existing .env file" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script asks to use existing .env configuration" {
    run grep -q "Do you want to use this existing configuration" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script can skip configuration if .env exists" {
    run grep -q "SKIP_ENV_CREATION" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script presents multiple Meticulous devices as choices" {
    run grep -q "Select device" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays found Meticulous devices with hostname and IP" {
    run grep -q "Scanning network for Meticulous machines" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script falls back to manual IP input if auto-detection fails" {
    run grep -q "No Meticulous devices found automatically" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses avahi-browse for network scanning on Linux" {
    run grep -q "avahi-browse" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses ARP cache for network scanning" {
    run grep -q "arp -a" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script tries to resolve .local mDNS domains" {
    run grep -q ".local" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides test command after installation" {
    run grep -q "curl -X POST" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script test command uses analyze_and_profile endpoint" {
    run grep -q "analyze_and_profile" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays success message on completion" {
    run grep -q "Installation Complete" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script exits on git not found" {
    run grep -q "Error: git is not installed" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains macOS dock shortcut creation function" {
    run grep -q "create_macos_dock_shortcut" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script prompts for dock shortcut on macOS" {
    run grep -q "Would you like to add MeticAI to your Dock?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script creates .app bundle structure for macOS" {
    run grep -q "Applications/.*\.app" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script creates Info.plist for macOS app" {
    run grep -q "Info.plist" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script only offers dock shortcut on macOS" {
    run grep -q 'if \[\[ "$OSTYPE" == "darwin"\* \]\]; then' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script validates URL format in dock shortcut" {
    run grep -q "Invalid URL format" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks for interactive mode before prompting" {
    run grep -q "\[\[ -c /dev/tty \]\]" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script supports SKIP_DOCK_SHORTCUT environment variable" {
    run grep -q "SKIP_DOCK_SHORTCUT" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script exits on docker not found" {
    run grep -q "Error: docker is not installed" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script supports macOS detection" {
    run grep -q "darwin" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script has cross-platform IP detection" {
    run grep -q "ipconfig getifaddr" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles macOS git installation" {
    run grep -q "brew install git" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains QR code generation function" {
    run grep -q "generate_qr_code()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "QR code function tries qrencode first" {
    run grep -q "command -v qrencode" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "QR code function has Python fallback" {
    run grep -q "command -v python3" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "QR code function displays web app message" {
    run grep -q "Scan to Access Web App" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "QR code function shows fallback message when unavailable" {
    run grep -q "QR code not available on this system" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains qrencode installation function" {
    run grep -q "install_qrencode()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script attempts to install qrencode when missing" {
    run grep -q "Attempting to install" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script runs apt-get update before installing qrencode on Debian systems" {
    # Verify that apt-get update is part of qrencode installation for ubuntu/debian/raspbian
    run bash -c "sed -n '/ubuntu|debian|raspbian)/,/;;/p' '$SCRIPT_PATH' | grep -q 'apt-get update.*&&.*apt-get install.*qrencode'"
    [ "$status" -eq 0 ]
}

@test "QR code function is called after successful installation" {
    run grep -q "generate_qr_code \"http://\$PI_IP:3550\"" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "QR code generation is optional and non-blocking" {
    # Verify function doesn't use 'exit' commands which would block installation
    run grep "generate_qr_code" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    # Check that the function doesn't contain 'exit 1' which would block installation
    run bash -c "grep -A 50 'generate_qr_code()' '$SCRIPT_PATH' | grep -c 'exit 1'"
    [ "$output" -eq 0 ]
}

@test "Script contains function to detect running containers" {
    run grep -q "detect_running_containers()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains function to stop and remove containers" {
    run grep -q "stop_and_remove_containers()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script contains function to detect previous installation" {
    run grep -q "detect_previous_installation()" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks for running MeticAI containers early in installation" {
    run grep -q "Checking for existing MeticAI installations" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects meticulous-mcp-server container" {
    run grep -q "meticulous-mcp-server" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects gemini-client container" {
    run grep -q "gemini-client" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects coffee-relay container" {
    run grep -q "coffee-relay" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects meticai-web container" {
    run grep -q "meticai-web" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script prompts to run uninstall script when previous installation found" {
    run grep -q "Would you like to run the uninstall script now?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script offers to continue anyway if previous installation found" {
    run grep -q "Continue with installation anyway?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defaults to cancelling installation when previous install detected" {
    run grep -q 'CONTINUE_ANYWAY=\${CONTINUE_ANYWAY:-n}' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script recommends running uninstall script first" {
    run grep -q "Run the uninstall script first to clean up" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects .env file as installation artifact" {
    run bash -c "grep -A 20 'detect_previous_installation()' '$SCRIPT_PATH' | grep -q '\\.env'"
    [ "$status" -eq 0 ]
}

@test "Script detects meticulous-source directory as installation artifact" {
    run bash -c "grep -A 20 'detect_previous_installation()' '$SCRIPT_PATH' | grep -q 'meticulous-source'"
    [ "$status" -eq 0 ]
}

@test "Script detects meticai-web directory as installation artifact" {
    run bash -c "grep -A 20 'detect_previous_installation()' '$SCRIPT_PATH' | grep -q 'meticai-web'"
    [ "$status" -eq 0 ]
}

@test "Script detects macOS Dock shortcut as installation artifact" {
    run bash -c "grep -A 30 'detect_previous_installation()' '$SCRIPT_PATH' | grep -q 'Applications/MeticAI.app'"
    [ "$status" -eq 0 ]
}

@test "Script detects rebuild watcher service as installation artifact" {
    run bash -c "grep -A 30 'detect_previous_installation()' '$SCRIPT_PATH' | grep -q 'com.meticai.rebuild-watcher.plist'"
    [ "$status" -eq 0 ]
}

@test "Script detects Linux systemd rebuild watcher as installation artifact" {
    run bash -c "grep -A 35 'detect_previous_installation()' '$SCRIPT_PATH' | grep -q 'meticai-rebuild-watcher.path'"
    [ "$status" -eq 0 ]
}

@test "Script stops containers before proceeding if user chooses to continue" {
    run grep -q "stop_and_remove_containers" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses docker compose down to stop containers" {
    run bash -c "grep -A 10 'stop_and_remove_containers()' '$SCRIPT_PATH' | grep -q 'docker compose down'"
    [ "$status" -eq 0 ]
}

@test "Script has fallback to stop containers individually" {
    run bash -c "grep -A 20 'stop_and_remove_containers()' '$SCRIPT_PATH' | grep -q 'docker stop'"
    [ "$status" -eq 0 ]
}

@test "Script checks for uninstall.sh existence before offering to run it" {
    run grep -q 'if \[ -f "./uninstall.sh" \]; then' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script makes uninstall.sh executable before running it" {
    run grep -q 'chmod +x ./uninstall.sh' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides GitHub URL if uninstall.sh is missing" {
    run grep -q "https://raw.githubusercontent.com/hessius/MeticAI/main/uninstall.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script exits gracefully when user declines to continue" {
    run grep -q "Installation cancelled. Please clean up first and try again" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays found containers with formatting" {
    run grep -q "Found running MeticAI containers:" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays found installation artifacts with formatting" {
    run grep -q "Found existing MeticAI installation artifacts:" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks for previous installations before prerequisites" {
    # Verify that the previous installation check comes before prerequisite checks
    local check_line=$(grep -n "Checking for existing MeticAI installations" "$SCRIPT_PATH" | cut -d: -f1)
    local prereq_line=$(grep -n "\[1/4\] Checking and installing prerequisites" "$SCRIPT_PATH" | cut -d: -f1)
    [ "$check_line" -lt "$prereq_line" ]
}

@test "Script offers automatic cleanup when uninstall.sh is missing" {
    run grep -q "Would you like automatic cleanup?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script explains automatic cleanup option clearly" {
    run grep -q "Automatic cleanup (recommended):" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides manual cleanup instructions when uninstall.sh missing" {
    run grep -q "Manual cleanup:" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles older installations without uninstall.sh" {
    run grep -q "This appears to be an older MeticAI installation without the uninstall script" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script automatic cleanup removes meticulous-source directory" {
    run bash -c "grep -A 50 'AUTO_CLEANUP.*=~.*Yy' '$SCRIPT_PATH' | grep -q 'rm -rf meticulous-source'"
    [ "$status" -eq 0 ]
}

@test "Script automatic cleanup removes meticai-web directory" {
    run bash -c "grep -A 50 'AUTO_CLEANUP.*=~.*Yy' '$SCRIPT_PATH' | grep -q 'rm -rf meticai-web'"
    [ "$status" -eq 0 ]
}

@test "Script automatic cleanup preserves .env file" {
    run bash -c "grep -A 50 'AUTO_CLEANUP.*=~.*Yy' '$SCRIPT_PATH' | grep -q 'Keeping .env file for configuration reuse'"
    [ "$status" -eq 0 ]
}

@test "Script provides direct download link for uninstall script" {
    run grep -q "https://raw.githubusercontent.com/hessius/MeticAI/main/uninstall.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script skips continue prompt after automatic cleanup" {
    run grep -q 'if \[\[ "$CONTINUE_ANYWAY" != "y" \]\]; then' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script sets METICAI_INSTALL_METHOD environment variable when calling uninstall" {
    run grep -q 'export METICAI_INSTALL_METHOD="local-install.sh"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script only sets METICAI_INSTALL_METHOD if not already set" {
    run grep -q 'if \[\[ -z "$METICAI_INSTALL_METHOD" \]\]; then' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script preserves METICAI_INSTALL_METHOD from web_install.sh" {
    # Check that the conditional logic exists to preserve the value
    run bash -c "grep -A2 'if \[\[ -z \"\$METICAI_INSTALL_METHOD\" \]\]; then' '$SCRIPT_PATH' | grep -q 'export METICAI_INSTALL_METHOD=\"local-install.sh\"'"
    [ "$status" -eq 0 ]
}

@test "Script sets METICAI_CALLED_FROM_INSTALLER environment variable when calling uninstall" {
    run grep -q 'export METICAI_CALLED_FROM_INSTALLER="true"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}
