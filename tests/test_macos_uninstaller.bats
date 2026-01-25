#!/usr/bin/env bats
# Tests for macOS uninstaller app scripts
#
# Tests cover:
# - Script existence and permissions
# - Script syntax validation
# - Key functionality checks
# - Configuration correctness

# Test against actual script locations
INSTALLER_DIR="${BATS_TEST_DIRNAME}/../macos-installer"
UNINSTALL_WRAPPER_SCRIPT="$INSTALLER_DIR/uninstall-wrapper.sh"
UNINSTALL_BUILD_SCRIPT="$INSTALLER_DIR/build-uninstaller-app.sh"

# --- Uninstall Wrapper Script Tests ---

@test "uninstall-wrapper.sh exists and is readable" {
    [ -f "$UNINSTALL_WRAPPER_SCRIPT" ]
    [ -r "$UNINSTALL_WRAPPER_SCRIPT" ]
}

@test "uninstall-wrapper.sh has correct shebang" {
    run head -n 1 "$UNINSTALL_WRAPPER_SCRIPT"
    [[ "$output" == "#!/bin/bash" ]]
}

@test "uninstall-wrapper.sh is executable" {
    [ -x "$UNINSTALL_WRAPPER_SCRIPT" ]
}

@test "uninstall-wrapper.sh has valid bash syntax" {
    run bash -n "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh contains welcome dialog function" {
    run grep -q "show_welcome()" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh uses osascript for dialogs" {
    run grep -q "osascript" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh has find_installation_dir function" {
    run grep -q "find_installation_dir()" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh has run_uninstallation function" {
    run grep -q "run_uninstallation()" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh has logging functions" {
    run grep -q "log_message()" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
    run grep -q "log_error()" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh runs uninstallation in background (no Terminal)" {
    run grep -q "run_uninstallation" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
    # Verify it does NOT open Terminal
    run grep -q 'tell application "Terminal"' "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -ne 0 ]
}

@test "uninstall-wrapper.sh handles Docker containers" {
    run grep -q "docker compose down" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh removes Docker images" {
    run grep -q "docker images" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh removes repositories" {
    run grep -q "meticulous-source" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
    run grep -q "meticai-web" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh removes configuration files" {
    run grep -q ".env" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "uninstall-wrapper.sh error handling uses set -e" {
    run grep -q "set -e" "$UNINSTALL_WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

# --- Uninstall Build Script Tests ---

@test "build-uninstaller-app.sh exists and is readable" {
    [ -f "$UNINSTALL_BUILD_SCRIPT" ]
    [ -r "$UNINSTALL_BUILD_SCRIPT" ]
}

@test "build-uninstaller-app.sh has correct shebang" {
    run head -n 1 "$UNINSTALL_BUILD_SCRIPT"
    [[ "$output" == "#!/bin/bash" ]]
}

@test "build-uninstaller-app.sh is executable" {
    [ -x "$UNINSTALL_BUILD_SCRIPT" ]
}

@test "build-uninstaller-app.sh has valid bash syntax" {
    run bash -n "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh defines APP_NAME" {
    run grep -q 'APP_NAME="MeticAI Uninstaller"' "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh defines BUNDLE_ID" {
    run grep -q 'BUNDLE_ID="com.meticai.uninstaller"' "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh checks for Platypus" {
    run grep -q "command -v platypus" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh has manual bundle creation fallback" {
    run grep -q "Manual .app bundle creation" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh creates Info.plist" {
    run grep -q "Info.plist" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh references icon file" {
    run grep -q "MeticAI.icns" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh creates output directory" {
    run grep -q "mkdir -p.*OUTPUT_DIR" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh includes DMG creation instructions" {
    run grep -q "hdiutil create" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh creates proper app structure" {
    run grep -q "Contents/MacOS" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
    run grep -q "Contents/Resources" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-uninstaller-app.sh makes executable chmod +x" {
    run grep -q "chmod +x" "$UNINSTALL_BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}
