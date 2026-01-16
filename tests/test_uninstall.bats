#!/usr/bin/env bats
# Comprehensive tests for uninstall.sh script
#
# Tests cover:
# - Script syntax and structure
# - Shebang and permissions
# - Key functionality checks

# Test against the actual script location
SCRIPT_PATH="${BATS_TEST_DIRNAME}/../uninstall.sh"

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

@test "Script displays uninstaller banner" {
    run grep -q "MeticAI Uninstaller" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script asks for confirmation before uninstalling" {
    run grep -q "Are you sure you want to uninstall MeticAI?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script stops Docker containers" {
    run grep -q "docker compose down" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes Docker images" {
    run grep -q "docker rmi" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script filters MeticAI-related images" {
    run grep -q "grep -E.*meticai.*coffee-relay.*gemini-client.*meticulous-mcp" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes meticulous-source directory" {
    run grep -q "rm -rf meticulous-source" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes meticai-web directory" {
    run grep -q "rm -rf meticai-web" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes .env file" {
    run grep -q 'rm.*\.env' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes .versions.json file" {
    run grep -q 'rm.*\.versions\.json' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes .update-config.json file" {
    run grep -q 'rm.*\.update-config\.json' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes .rebuild-needed file" {
    run grep -q 'rm.*\.rebuild-needed' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes .rebuild-watcher.log file" {
    run grep -q 'rm.*\.rebuild-watcher\.log' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles macOS Dock shortcut removal" {
    run grep -q "/Applications/MeticAI.app" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes rebuild watcher service on macOS" {
    run grep -q "com.meticai.rebuild-watcher.plist" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses launchctl to unload service" {
    run grep -q "launchctl unload" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script asks before removing Docker" {
    run grep -q "Do you want to remove Docker?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script asks before removing git" {
    run grep -q "Do you want to remove git?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script asks before removing qrencode" {
    run grep -q "Do you want to remove qrencode?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script warns about external dependencies" {
    run grep -q "WARNING.*Only remove these if you don't use them for other projects" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays uninstallation summary" {
    run grep -q "Uninstallation Summary" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script tracks uninstalled items" {
    run grep -q "UNINSTALLED_ITEMS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script tracks kept items" {
    run grep -q "KEPT_ITEMS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script tracks failed items" {
    run grep -q "FAILED_ITEMS" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides instructions for directory deletion" {
    run grep -q "You can safely delete it if you no longer need it" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script has progress indicators (numbered steps)" {
    run grep -q "\[1/7\]" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "\[7/7\]" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects macOS platform for macOS-specific cleanup" {
    run grep -q 'OSTYPE.*darwin' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks for docker command before using it" {
    run grep -q "command -v docker" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles both 'docker compose' and 'docker-compose' commands" {
    run grep -q "docker compose down.*docker-compose down" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides option to cancel uninstallation" {
    run grep -q "Uninstallation cancelled" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defaults to NO for destructive operations" {
    # Check that default is 'n' for confirmation
    run grep -q 'CONFIRM=\${CONFIRM:-n}' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defaults to NO for removing external dependencies" {
    # Check Docker removal defaults to 'n'
    run grep -q 'REMOVE_DOCKER=\${REMOVE_DOCKER:-n}' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    # Check git removal defaults to 'n'
    run grep -q 'REMOVE_GIT=\${REMOVE_GIT:-n}' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles sudo for macOS app removal if needed" {
    run grep -q "sudo rm -rf.*APP_PATH" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects OS for appropriate package manager" {
    run grep -q "apt-get remove" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "dnf remove" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "yum remove" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses color codes for output" {
    run grep -q "GREEN=.*033" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "YELLOW=.*033" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "RED=.*033" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}
