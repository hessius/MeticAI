#!/usr/bin/env bats
# Comprehensive tests for web_install.sh script
#
# Tests cover:
# - Script syntax and structure
# - Shebang and permissions
# - Key functionality checks for remote installation

# Test against the actual script location
SCRIPT_PATH="${BATS_TEST_DIRNAME}/../web_install.sh"

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

@test "Script contains repository URL configuration" {
    run grep -q "REPO_URL=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script references github.com/hessius/MeticAI" {
    run grep -q "github.com/hessius/MeticAI" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks for curl" {
    run grep -q "command -v curl" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script checks for git" {
    run grep -q "command -v git" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script can install git if missing" {
    run grep -q "install_git" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script detects local repository mode" {
    run grep -q "local-install.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles existing installation directory" {
    run grep -q "already exists" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script clones repository with git clone" {
    run grep -q "git clone" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script changes to installation directory" {
    run grep -q 'cd "$INSTALL_DIR"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script executes local-install.sh after cloning" {
    run grep -q "exec ./local-install.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script displays remote installation banner" {
    run grep -q "MeticAI Remote Installer" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides error handling for clone failures" {
    run grep -q "Failed to clone repository" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script makes local-install.sh executable" {
    run grep -q "chmod +x ./local-install.sh" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script supports branch configuration" {
    run grep -q "BRANCH=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script has remote installation mode detection" {
    run grep -q "Remote installation mode" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides installation directory configuration" {
    run grep -q "INSTALL_DIR=" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script asks for installation location choice" {
    run grep -q "Where would you like to install MeticAI?" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script offers current directory option" {
    run grep -q "Current directory" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script offers home directory option" {
    run grep -q "Home directory" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script offers custom path option" {
    run grep -q "Custom path" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script handles custom path with tilde expansion" {
    run grep -q 'CUSTOM_PATH="\${CUSTOM_PATH/#\\~/$HOME}"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script creates parent directory if needed" {
    run grep -q "Creating parent directory" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script shows selected installation directory" {
    run grep -q "Installation directory:" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script sets METICAI_INSTALL_METHOD environment variable for web install" {
    run grep -q 'export METICAI_INSTALL_METHOD="web_install.sh"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}
