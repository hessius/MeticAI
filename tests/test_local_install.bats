#!/usr/bin/env bats
# Comprehensive tests for local-install.sh script
#
# Tests cover:
# - Script syntax and structure
# - Shebang and permissions
# - Key functionality checks

# Test against the actual script location
SCRIPT_PATH="${BATS_TEST_DIRNAME}/../local-install.sh"

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
    run grep -q "aistudio.google.com/app/apikey" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script auto-detects server IP" {
    run grep -q "hostname -I" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "Script provides test command after installation" {
    run grep -q "curl -X POST" "$SCRIPT_PATH"
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

@test "Script exits on docker not found" {
    run grep -q "Error: docker is not installed" "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}
