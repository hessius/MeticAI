#!/usr/bin/env bats
# Tests for macOS installer scripts
#
# Tests cover:
# - Script existence and permissions
# - Script syntax validation
# - Key functionality checks
# - Configuration correctness

# Test against actual script locations
INSTALLER_DIR="${BATS_TEST_DIRNAME}/../macos-installer"
WRAPPER_SCRIPT="$INSTALLER_DIR/install-wrapper.sh"
BUILD_SCRIPT="$INSTALLER_DIR/build-macos-app.sh"
README_FILE="$INSTALLER_DIR/README.md"

# --- Wrapper Script Tests ---

@test "install-wrapper.sh exists and is readable" {
    [ -f "$WRAPPER_SCRIPT" ]
    [ -r "$WRAPPER_SCRIPT" ]
}

@test "install-wrapper.sh has correct shebang" {
    run head -n 1 "$WRAPPER_SCRIPT"
    [[ "$output" == "#!/bin/bash" ]]
}

@test "install-wrapper.sh is executable" {
    [ -x "$WRAPPER_SCRIPT" ]
}

@test "install-wrapper.sh has valid bash syntax" {
    run bash -n "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh contains welcome dialog function" {
    run grep -q "show_welcome()" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh contains prerequisite check function" {
    run grep -q "check_prerequisites()" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh checks for git" {
    run grep -q "command -v git" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh checks for docker" {
    run grep -q "command -v docker" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh uses osascript for dialogs" {
    run grep -q "osascript" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh clones repository directly (not via web_install.sh)" {
    run grep -q "git clone.*github.com/hessius/MeticAI" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh collects API key via dialog" {
    run grep -q "get_api_key()" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh collects Meticulous IP via dialog" {
    run grep -q "get_meticulous_ip()" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh collects Server IP via dialog" {
    run grep -q "get_server_ip()" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh has logging functions" {
    run grep -q "log_message()" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
    run grep -q "log_error()" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "install-wrapper.sh runs installation in background (no Terminal)" {
    run grep -q "run_installation" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
    # Verify it does NOT open Terminal
    run grep -q 'tell application "Terminal"' "$WRAPPER_SCRIPT"
    [ "$status" -ne 0 ]
}

# --- Build Script Tests ---

@test "build-macos-app.sh exists and is readable" {
    [ -f "$BUILD_SCRIPT" ]
    [ -r "$BUILD_SCRIPT" ]
}

@test "build-macos-app.sh has correct shebang" {
    run head -n 1 "$BUILD_SCRIPT"
    [[ "$output" == "#!/bin/bash" ]]
}

@test "build-macos-app.sh is executable" {
    [ -x "$BUILD_SCRIPT" ]
}

@test "build-macos-app.sh has valid bash syntax" {
    run bash -n "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh defines APP_NAME" {
    run grep -q 'APP_NAME="MeticAI Installer"' "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh defines BUNDLE_ID" {
    run grep -q 'BUNDLE_ID="com.meticai.installer"' "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh checks for Platypus" {
    run grep -q "command -v platypus" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh has manual bundle creation fallback" {
    run grep -q "Manual .app bundle creation" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh creates Info.plist" {
    run grep -q "Info.plist" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh references icon file" {
    run grep -q "MeticAI.icns" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh creates output directory" {
    run grep -q "mkdir -p.*OUTPUT_DIR" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build-macos-app.sh includes DMG creation instructions" {
    run grep -q "hdiutil create" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

# --- README Tests ---

@test "macOS installer README exists and is readable" {
    [ -f "$README_FILE" ]
    [ -r "$README_FILE" ]
}

@test "README contains build instructions" {
    run grep -q "Build Instructions" "$README_FILE"
    [ "$status" -eq 0 ]
}

@test "README contains Platypus installation command" {
    run grep -q "brew install platypus" "$README_FILE"
    [ "$status" -eq 0 ]
}

@test "README contains distribution instructions" {
    run grep -q "Creating DMG files for Distribution" "$README_FILE"
    [ "$status" -eq 0 ]
}

@test "README contains troubleshooting section" {
    run grep -q "Troubleshooting" "$README_FILE"
    [ "$status" -eq 0 ]
}

@test "README explains installation flow" {
    run grep -q "Installation Flow" "$README_FILE"
    [ "$status" -eq 0 ]
}

@test "README includes code signing information" {
    run grep -q "Code Signing" "$README_FILE"
    [ "$status" -eq 0 ]
}

# --- Directory Structure Tests ---

@test "macos-installer directory exists" {
    [ -d "$INSTALLER_DIR" ]
}

@test "Icon file referenced by build script exists" {
    ICON_PATH="$INSTALLER_DIR/../resources/MeticAI.icns"
    [ -f "$ICON_PATH" ]
}

# --- Integration Tests ---

@test "wrapper script error handling uses set -e" {
    run grep -q "set -e" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build script creates proper app structure" {
    run grep -q "Contents/MacOS" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
    run grep -q "Contents/Resources" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "wrapper script creates temporary files safely" {
    run grep -q "mktemp" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build script makes executable chmod +x" {
    run grep -q "chmod +x" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

# --- Configuration Validation Tests ---

@test "wrapper script uses local-install.sh for installation" {
    # Verify it delegates to local-install.sh with non-interactive mode
    run grep -q "local-install.sh" "$WRAPPER_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "build script output goes to build directory" {
    run grep -q 'OUTPUT_DIR.*build' "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}

@test "Info.plist includes required keys" {
    # Check that build script creates Info.plist with required keys
    run grep -q "CFBundleExecutable" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
    run grep -q "CFBundleIdentifier" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
    run grep -q "CFBundleName" "$BUILD_SCRIPT"
    [ "$status" -eq 0 ]
}
