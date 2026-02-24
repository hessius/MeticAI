#!/bin/bash

################################################################################
# MeticAI - macOS App Builder Script
################################################################################
# 
# This script builds a standalone macOS .app bundle for MeticAI installer
# using Platypus (or manually if Platypus is not available).
#
# USAGE:
#   ./build-macos-app.sh
#
# PREREQUISITES:
#   - Platypus installed (recommended): brew install platypus
#   - OR: Manual .app bundle creation (automatic fallback)
#
################################################################################

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="MeticAI Installer"
BUNDLE_ID="com.meticai.installer"
VERSION="2.0.0"
OUTPUT_DIR="$SCRIPT_DIR/build"
APP_PATH="$OUTPUT_DIR/${APP_NAME}.app"
# Executable name without spaces for compatibility
EXEC_NAME="MeticAI-Installer"

# Script and resources
WRAPPER_SCRIPT="$SCRIPT_DIR/install-wrapper.sh"
ICON_FILE="$REPO_ROOT/resources/MeticAI.icns"

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   MeticAI macOS App Builder (v2.0)${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Check if wrapper script exists
if [ ! -f "$WRAPPER_SCRIPT" ]; then
    echo -e "${RED}Error: Wrapper script not found at $WRAPPER_SCRIPT${NC}"
    exit 1
fi

# Check if icon exists
if [ ! -f "$ICON_FILE" ]; then
    echo -e "${YELLOW}Warning: Icon file not found at $ICON_FILE${NC}"
    echo -e "${YELLOW}App will be created without custom icon${NC}"
    ICON_FILE=""
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check for Platypus
if command -v platypus &> /dev/null; then
    echo -e "${GREEN}✓ Platypus found${NC}"
    echo -e "${YELLOW}Building app with Platypus...${NC}"
    
    # Build with Platypus
    platypus_args=(
        --name "$APP_NAME"
        --bundle-identifier "$BUNDLE_ID"
        --app-version "$VERSION"
        --author "MeticAI"
        --interface-type "Progress Bar"
        --interpreter "/bin/bash"
        --quit-after-execution
        --overwrite
    )
    
    # Add icon if available
    if [ -n "$ICON_FILE" ]; then
        platypus_args+=(--app-icon "$ICON_FILE")
    fi
    
    # Add script
    platypus_args+=("$WRAPPER_SCRIPT" "$APP_PATH")
    
    # Execute platypus
    if platypus "${platypus_args[@]}"; then
        echo -e "${GREEN}✓ App built successfully with Platypus${NC}"
    else
        echo -e "${RED}Error: Platypus build failed${NC}"
        exit 1
    fi
    
else
    echo -e "${YELLOW}Platypus not found. Building app manually...${NC}"
    echo -e "${BLUE}Tip: Install Platypus for better app creation: brew install platypus${NC}"
    echo ""
    
    # Manual .app bundle creation
    echo "Creating app bundle structure..."
    
    # Remove old app if exists
    rm -rf "$APP_PATH"
    
    # Create bundle structure
    mkdir -p "$APP_PATH/Contents/MacOS"
    mkdir -p "$APP_PATH/Contents/Resources"
    
    # Copy wrapper script as executable
    cp "$WRAPPER_SCRIPT" "$APP_PATH/Contents/MacOS/${EXEC_NAME}"
    chmod +x "$APP_PATH/Contents/MacOS/${EXEC_NAME}"
    
    # Copy icon if available
    if [ -n "$ICON_FILE" ]; then
        cp "$ICON_FILE" "$APP_PATH/Contents/Resources/AppIcon.icns"
        ICON_KEY="<key>CFBundleIconFile</key>
    <string>AppIcon</string>"
    else
        ICON_KEY=""
    fi
    
    # Create Info.plist
    cat > "$APP_PATH/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${EXEC_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    ${ICON_KEY}
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.utilities</string>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
EOF
    
    echo -e "${GREEN}✓ App bundle created manually${NC}"
fi

# Verify the installer app was created
if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}Error: Installer app bundle was not created${NC}"
    exit 1
fi

# Make the installer executable
if [ -f "$APP_PATH/Contents/MacOS/${EXEC_NAME}" ]; then
    chmod +x "$APP_PATH/Contents/MacOS/${EXEC_NAME}"
else
    echo -e "${YELLOW}Warning: Installer executable not found at expected location${NC}"
fi

echo -e "${GREEN}✓ Installer built: $APP_PATH${NC}"
echo ""

# ==============================================================================
# Build Uninstaller App
# ==============================================================================

UNINSTALL_APP_NAME="MeticAI Uninstaller"
UNINSTALL_BUNDLE_ID="com.meticai.uninstaller"
UNINSTALL_APP_PATH="$OUTPUT_DIR/${UNINSTALL_APP_NAME}.app"
UNINSTALL_EXEC_NAME="MeticAI-Uninstaller"
UNINSTALL_SCRIPT="$SCRIPT_DIR/uninstall-wrapper.sh"

if [ -f "$UNINSTALL_SCRIPT" ]; then
    echo -e "${YELLOW}Building Uninstaller app...${NC}"

    if command -v platypus &> /dev/null; then
        platypus_un_args=(
            --name "$UNINSTALL_APP_NAME"
            --bundle-identifier "$UNINSTALL_BUNDLE_ID"
            --app-version "$VERSION"
            --author "MeticAI"
            --interface-type "Progress Bar"
            --interpreter "/bin/bash"
            --quit-after-execution
            --overwrite
        )
        if [ -n "$ICON_FILE" ]; then
            platypus_un_args+=(--app-icon "$ICON_FILE")
        fi
        platypus_un_args+=("$UNINSTALL_SCRIPT" "$UNINSTALL_APP_PATH")

        if platypus "${platypus_un_args[@]}"; then
            echo -e "${GREEN}✓ Uninstaller built with Platypus${NC}"
        else
            echo -e "${RED}Error: Platypus uninstaller build failed${NC}"
        fi
    else
        # Manual .app bundle
        rm -rf "$UNINSTALL_APP_PATH"
        mkdir -p "$UNINSTALL_APP_PATH/Contents/MacOS"
        mkdir -p "$UNINSTALL_APP_PATH/Contents/Resources"

        cp "$UNINSTALL_SCRIPT" "$UNINSTALL_APP_PATH/Contents/MacOS/${UNINSTALL_EXEC_NAME}"
        chmod +x "$UNINSTALL_APP_PATH/Contents/MacOS/${UNINSTALL_EXEC_NAME}"

        if [ -n "$ICON_FILE" ]; then
            cp "$ICON_FILE" "$UNINSTALL_APP_PATH/Contents/Resources/AppIcon.icns"
            UNINSTALL_ICON_KEY="<key>CFBundleIconFile</key>
    <string>AppIcon</string>"
        else
            UNINSTALL_ICON_KEY=""
        fi

        cat > "$UNINSTALL_APP_PATH/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${UNINSTALL_EXEC_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${UNINSTALL_BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>${UNINSTALL_APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${UNINSTALL_APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    ${UNINSTALL_ICON_KEY}
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.utilities</string>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
EOF
        echo -e "${GREEN}✓ Uninstaller bundle created manually${NC}"
    fi
else
    echo -e "${YELLOW}Skipping uninstaller: uninstall-wrapper.sh not found${NC}"
fi

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}   ✓ Build Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "Installer:   ${BLUE}$APP_PATH${NC}"
if [ -d "$UNINSTALL_APP_PATH" ]; then
    echo -e "Uninstaller: ${BLUE}$UNINSTALL_APP_PATH${NC}"
fi
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Test: open \"$APP_PATH\""
echo "2. Install to Applications: mv \"$OUTPUT_DIR\"/*.app /Applications/"
echo "3. Create distributable DMG:"
echo "   hdiutil create -volname \"MeticAI\" -srcfolder \"$OUTPUT_DIR\" -ov -format UDZO \"$OUTPUT_DIR/MeticAI.dmg\""
echo ""
