# MeticAI macOS Apps

This directory contains the scripts and resources needed to build standalone macOS applications for MeticAI. Two apps are available:

1. **MeticAI Installer** - GUI-based installation app
2. **MeticAI Uninstaller** - GUI-based uninstallation app

Both apps provide a **fully graphical user interface** with **NO Terminal window** - everything runs in the background with GUI dialogs for input and progress feedback.

## MeticAI Installer

The installer app provides a completely GUI-based installation experience:

- ✅ **Welcome dialog** explaining the installation process
- ✅ **Prerequisite checking** for Git and Docker with helpful installation instructions
- ✅ **Installation location picker** via dialog or folder browser
- ✅ **API key input** via secure dialog with clickable link to get API key
- ✅ **IP address configuration** via dialogs with auto-detection
- ✅ **Background installation** - no Terminal window shown to user
- ✅ **Progress feedback** via GUI dialogs
- ✅ **Success/error dialogs** with clear next steps
- ✅ **Auto-opens web interface** when installation completes
- ✅ **Uses MeticAI branding** - app icon shows MeticAI logo

## MeticAI Uninstaller

The uninstaller app provides a GUI-based uninstallation experience:

- ✅ **Confirmation dialog** before uninstalling
- ✅ **Auto-detects installation** location
- ✅ **Background uninstallation** - no Terminal window
- ✅ **Removes all components**:
  - Docker containers and images
  - Cloned repositories
  - Configuration files
  - macOS integrations (Dock shortcuts, services)
- ✅ **Optional directory removal** - asks before deleting installation folder
- ✅ **Success/error dialogs** with clear feedback
- ✅ **Uses MeticAI branding** - app icon shows MeticAI logo

## Building the Apps

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
4. Collect Google Gemini API key via secure dialog
5. Collect Meticulous machine IP address
6. Collect or auto-detect server IP address
7. Run installation in the background (NO Terminal window)
8. Show progress via dialogs
9. Display success message with web interface URL
10. Auto-open the web interface in your browser

### Building the Uninstaller

To build the uninstaller app:

```bash
cd macos-installer
chmod +x build-uninstaller-app.sh
./build-uninstaller-app.sh
```

The app will be created in `macos-installer/build/MeticAI Uninstaller.app`

Test it:
```bash
open "build/MeticAI Uninstaller.app"
```

The uninstaller will:
1. Show a confirmation dialog
2. Auto-detect MeticAI installation (or ask user to locate it)
3. Run uninstallation in the background (NO Terminal window)
4. Remove Docker containers, images, repositories, and config files
5. Ask about removing the installation directory
6. Show success message

## Distribution

### Creating DMG files for Distribution

Create distributable DMG files for both apps:

**Installer DMG:**
```bash
hdiutil create -volname "MeticAI Installer" \
  -srcfolder "build/MeticAI Installer.app" \
  -ov -format UDZO \
  "build/MeticAI-Installer.dmg"
```

**Uninstaller DMG:**
```bash
hdiutil create -volname "MeticAI Uninstaller" \
  -srcfolder "build/MeticAI Uninstaller.app" \
  -ov -format UDZO \
  "build/MeticAI-Uninstaller.dmg"
```

Users can then:
1. Download the DMG files
2. Open them and drag apps to Applications
3. Launch the apps from Applications folder

### Creating ZIP Archives

Alternatively, create ZIP files:

```bash
cd build
zip -r "MeticAI-Installer.zip" "MeticAI Installer.app"
zip -r "MeticAI-Uninstaller.zip" "MeticAI Uninstaller.app"
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
4. **Configuration Collection** - All via GUI dialogs:
   - Google Gemini API key (secure text input)
   - Meticulous machine IP address
   - Server IP address (with auto-detection)
5. **Background Installation** - Runs silently in the background
   - Clones repository
   - Creates configuration files
   - Builds and starts Docker containers
   - Progress shown via GUI dialogs
6. **Completion** - Success dialog with web interface URL
   - Auto-opens web interface in browser
   - No QR code scanning needed!

### User Experience

The app provides a **100% GUI experience** with NO Terminal window:

- **All inputs** collected via AppleScript dialogs
- **Installation runs in background** - user never sees command line
- **Progress feedback** via non-blocking GUI dialogs  
- **Error handling** with clear, actionable error messages in dialogs
- **Success confirmation** with direct link to web interface
- **Auto-launch** of web interface when installation completes

This approach provides maximum ease of use for non-technical users while maintaining security and proper error handling.

## Files

- `install-wrapper.sh` - Main wrapper script with fully GUI installation flow
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
