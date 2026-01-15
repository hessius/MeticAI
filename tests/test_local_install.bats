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
    run grep -q "github.com/manonstreet/meticulous-mcp.git" "$SCRIPT_PATH"
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
    run grep -q "Would you like to add a MeticAI shortcut" "$SCRIPT_PATH"
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
    run grep -q "\[\[ -t 0 \]\]" "$SCRIPT_PATH"
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
