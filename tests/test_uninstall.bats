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
    run grep -q "grep -E.*meticai.*coffee-relay" "$SCRIPT_PATH"
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

@test "Script does NOT remove .update-config.json (it's a source file)" {
    # .update-config.json is a source file committed to the repository
    # and should NOT be removed during uninstallation
    run grep -q 'update-config.json is a source file' "$SCRIPT_PATH"
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

@test "Script removes rebuild watcher service on Linux" {
    run grep -q "meticai-rebuild-watcher.path" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses systemctl to stop Linux service" {
    run grep -q "systemctl stop meticai-rebuild-watcher" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script removes systemd service file on Linux" {
    run grep -q "meticai-rebuild-watcher.service" "$SCRIPT_PATH"
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

@test "Script checks for METICAI_CALLED_FROM_INSTALLER environment variable" {
    run grep -q 'METICAI_CALLED_FROM_INSTALLER.*==.*true' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script prompts to restart installation when called from installer" {
    run grep -q "Restart Installation Flow" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q "Would you like to restart the installation process now?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses METICAI_INSTALL_METHOD to determine which script to run" {
    run grep -q 'METICAI_INSTALL_METHOD.*==.*web_install.sh' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defaults install script to local-install.sh" {
    run grep -q 'INSTALL_SCRIPT=.*local-install.sh' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script unsets environment variables before restarting installer" {
    run grep -q 'unset METICAI_CALLED_FROM_INSTALLER' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -q 'unset METICAI_INSTALL_METHOD' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script uses exec to restart installer" {
    run grep -q 'exec.*INSTALL_SCRIPT' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script shows directory cleanup message only for standalone uninstall" {
    run grep -q "This directory.*still contains the MeticAI source code" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides option not to restart installation" {
    run grep -q "Installation not restarted" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defaults to YES for restarting installation" {
    run grep -q 'RESTART_INSTALL=\${RESTART_INSTALL:-y}' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script validates install script exists before executing it" {
    run grep -q 'if \[ ! -f "$INSTALL_SCRIPT" \]; then' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks if install script is executable" {
    run grep -q 'if \[ ! -x "$INSTALL_SCRIPT" \]; then' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script makes install script executable if needed" {
    run grep -q 'chmod +x "$INSTALL_SCRIPT"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides web install curl command when web method used" {
    run grep -q 'curl -fsSL.*WEB_INSTALL_URL.*bash' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script defines WEB_INSTALL_URL constant" {
    run grep -q 'WEB_INSTALL_URL="https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}
