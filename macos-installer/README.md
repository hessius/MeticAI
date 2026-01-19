# MeticAI macOS Installer App

This directory contains the scripts and resources needed to build a standalone macOS installer application for MeticAI. The installer provides a graphical user interface for users who prefer not to use the command line.

## Overview

The macOS installer app wraps the existing `web_install.sh` script with a user-friendly GUI that:

- ✅ Shows welcome dialog explaining the installation process
- ✅ Checks for prerequisites (Git, Docker) with helpful installation instructions
- ✅ Allows users to choose installation location via dialog or folder picker
- ✅ Downloads and executes the MeticAI installer
- ✅ Opens Terminal for interactive configuration (API key, IP addresses)
- ✅ Provides clear guidance throughout the process

## Building the Installer App

### Prerequisites

**Option 1: Using Platypus (Recommended)**
```bash
brew install platypus
```

**Option 2: Manual Build**
No additional tools required - the build script will create the app bundle manually.

### Build Instructions

1. Navigate to the `macos-installer` directory:
   ```bash
   cd macos-installer
   ```

2. Make the build script executable:
   ```bash
   chmod +x build-macos-app.sh
   ```

3. Run the build script:
   ```bash
   ./build-macos-app.sh
   ```

4. The app will be created in `macos-installer/build/MeticAI Installer.app`

### Testing the App

Open the app to test it:
```bash
open "build/MeticAI Installer.app"
```

The app will:
1. Show a welcome dialog
2. Check for Git and Docker
3. Ask for installation location
4. Download and run the installer in Terminal
5. Guide you through configuration

## Distribution

### Creating a DMG for Distribution

Once you've built and tested the app, create a distributable DMG file:

```bash
hdiutil create -volname "MeticAI Installer" \
  -srcfolder "build/MeticAI Installer.app" \
  -ov -format UDZO \
  "build/MeticAI-Installer.dmg"
```

Users can then:
1. Download the DMG file
2. Open it and drag "MeticAI Installer.app" to Applications
3. Launch the app from Applications folder

### Creating a ZIP Archive

Alternatively, create a ZIP file:

```bash
cd build
zip -r "MeticAI-Installer.zip" "MeticAI Installer.app"
```

## How It Works

### Architecture

```
MeticAI Installer.app
├── Contents/
│   ├── MacOS/
│   │   └── MeticAI Installer (install-wrapper.sh)
│   ├── Resources/
│   │   └── AppIcon.icns (MeticAI icon)
│   └── Info.plist (App metadata)
```

### Installation Flow

1. **Welcome Dialog** - User sees introduction and clicks OK to continue
2. **Prerequisites Check** - Verifies Git and Docker are installed
   - If missing: Shows instructions and offers to open download links
3. **Location Selection** - User chooses where to install MeticAI
   - Default: `~/MeticAI`
   - Options: Use default, choose custom folder
4. **Download & Execute** - Downloads `web_install.sh` from GitHub
5. **Terminal Launch** - Opens Terminal window for interactive installation
   - User enters Google Gemini API key
   - User confirms or enters Meticulous machine IP
   - User confirms or enters server IP
6. **Completion** - Terminal shows QR code and success message

### User Experience

The app provides a hybrid GUI/Terminal experience:

- **GUI Dialogs**: For simple choices and prerequisite checks
- **Terminal**: For the main installation with real-time progress
  - Shows all installation steps
  - Allows interactive input for sensitive data (API keys)
  - Displays QR code for web interface access

This approach balances ease of use with transparency and control.

## Files

- `install-wrapper.sh` - Main wrapper script that shows dialogs and launches installation
- `build-macos-app.sh` - Build script that creates the .app bundle
- `README.md` - This file

## Customization

### Changing the App Name

Edit `build-macos-app.sh`:
```bash
APP_NAME="Your App Name"
```

### Changing the Bundle Identifier

Edit `build-macos-app.sh`:
```bash
BUNDLE_ID="com.yourcompany.yourapp"
```

### Changing the Icon

Replace or update the icon path in `build-macos-app.sh`:
```bash
ICON_FILE="$REPO_ROOT/resources/YourIcon.icns"
```

To create a new icon from a PNG:
```bash
# Create iconset directory
mkdir MyIcon.iconset

# Create multiple sizes (512x512 PNG as source)
sips -z 16 16     icon.png --out MyIcon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out MyIcon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out MyIcon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out MyIcon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out MyIcon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out MyIcon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out MyIcon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out MyIcon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out MyIcon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out MyIcon.iconset/icon_512x512@2x.png

# Convert to icns
iconutil -c icns MyIcon.iconset
```

## Troubleshooting

### App won't open: "App is damaged"

This happens because the app isn't code-signed. Users need to:
1. Right-click the app
2. Select "Open"
3. Click "Open" in the security dialog

Or remove quarantine attribute:
```bash
xattr -cr "/Applications/MeticAI Installer.app"
```

### Platypus not found

Install Platypus:
```bash
brew install platypus
```

Or let the build script create the app manually (no Platypus required).

### Build fails

Check that:
- You're in the `macos-installer` directory
- `install-wrapper.sh` exists and is readable
- The icon file exists at `../resources/MeticAI.icns`

### Installer doesn't work

The app requires:
- Git installed (`xcode-select --install`)
- Docker Desktop installed and running
- Internet connection to download the installer script

## Code Signing and Notarization (Optional)

For public distribution, you may want to code-sign and notarize the app:

### Code Signing

```bash
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name (TEAM_ID)" \
  "build/MeticAI Installer.app"
```

### Notarization

```bash
# Create a ZIP for notarization
ditto -c -k --keepParent "build/MeticAI Installer.app" "build/MeticAI-Installer.zip"

# Submit for notarization
xcrun notarytool submit "build/MeticAI-Installer.zip" \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password"

# Staple the notarization ticket
xcrun stapler staple "build/MeticAI Installer.app"
```

For most users, an unsigned app with quarantine removal instructions is sufficient.

## Future Enhancements

Potential improvements for the macOS installer:

- [ ] Collect API key and IPs in the GUI (avoid Terminal entirely)
- [ ] Show installation progress in a native progress bar
- [ ] Auto-detect and install prerequisites silently
- [ ] Include offline installer option (bundle all dependencies)
- [ ] Add uninstaller app
- [ ] Create update checker app
- [ ] Support multiple languages

## License

This installer is part of MeticAI and follows the same license as the main project.

## Credits

Built with:
- **Platypus** - Create Mac applications from scripts (optional)
- **AppleScript** - Native macOS dialogs and user interaction
- **Bash** - Installation logic and orchestration
