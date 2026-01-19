# Quick Start Guide for macOS Installer

This is a quick reference for building and using the MeticAI macOS installer app.

## For Users

### Downloading and Installing

1. **Download** the installer from the [releases page](https://github.com/hessius/MeticAI/releases) *(coming soon)*
   
2. **Open** the DMG file and **drag** "MeticAI Installer.app" to your Applications folder

3. **Launch** the app from Applications

4. **Follow** the guided installation:
   - Click OK on the welcome screen
   - If prompted, install Git and Docker Desktop
   - Choose where to install MeticAI (default: ~/MeticAI)
   - Terminal will open for configuration
   - Enter your Google Gemini API key when prompted
   - Confirm or enter your Meticulous machine's IP address
   - Confirm or enter your server's IP address
   - Wait for installation to complete

5. **Access** MeticAI via the web interface shown in Terminal

### Troubleshooting

**"App is damaged" or "Can't be opened"**

This happens because the app isn't code-signed. Fix it by:

```bash
# Remove quarantine attribute
xattr -cr "/Applications/MeticAI Installer.app"
```

Or:
1. Right-click the app
2. Select "Open"
3. Click "Open" in the security dialog

**Prerequisites missing**

The installer will detect missing tools and show installation instructions:
- **Docker Desktop**: Download from https://www.docker.com/products/docker-desktop
- **Git**: Run `xcode-select --install` in Terminal

## For Developers

### Building the Installer

#### Prerequisites

```bash
# Option 1: Install Platypus (recommended)
brew install platypus

# Option 2: Use manual bundle creation (no additional tools needed)
```

#### Build Process

```bash
# 1. Clone the repository
git clone https://github.com/hessius/MeticAI.git
cd MeticAI/macos-installer

# 2. Run the build script
./build-macos-app.sh

# 3. Test the app
open "build/MeticAI Installer.app"

# 4. (Optional) Create a DMG for distribution
hdiutil create -volname "MeticAI Installer" \
  -srcfolder "build/MeticAI Installer.app" \
  -ov -format UDZO \
  "build/MeticAI-Installer.dmg"
```

### Directory Structure

```
macos-installer/
├── install-wrapper.sh       # GUI wrapper for web_install.sh
├── build-macos-app.sh       # Build script to create .app
├── README.md                # Detailed documentation
└── build/                   # Output directory (created by build script)
    ├── MeticAI Installer.app
    └── MeticAI-Installer.dmg
```

### Testing

```bash
# Run BATS tests
cd ..
bats tests/test_macos_installer.bats

# All 41 tests should pass
```

### Distribution

**Creating a Release:**

1. Build the app using `build-macos-app.sh`
2. Create a DMG using the `hdiutil` command shown above
3. Upload the DMG to GitHub releases
4. Users download the DMG and install

**Optional Code Signing:**

For wider distribution, code sign and notarize:

```bash
# Code sign
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name (TEAM_ID)" \
  "build/MeticAI Installer.app"

# Create ZIP for notarization
ditto -c -k --keepParent "build/MeticAI Installer.app" "build/MeticAI-Installer.zip"

# Submit for notarization
xcrun notarytool submit "build/MeticAI-Installer.zip" \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password"

# Staple ticket
xcrun stapler staple "build/MeticAI Installer.app"
```

## How It Works

### Installation Flow

```
User launches app
    ↓
Welcome dialog (AppleScript)
    ↓
Check prerequisites (Git, Docker)
    ↓ (if missing)
Show installation instructions + links
    ↓ (if all present)
Choose installation location
    ↓
Download web_install.sh from GitHub
    ↓
Open Terminal with installer
    ↓
User provides configuration
    ↓
Installation completes
    ↓
QR code and success message
```

### Components

1. **install-wrapper.sh**: Uses AppleScript (`osascript`) to show dialogs and check prerequisites
2. **build-macos-app.sh**: Creates .app bundle with proper structure and metadata
3. **Terminal**: Handles the actual installation for transparency and interactive input

### Why This Design?

- **GUI dialogs** for simple choices = user-friendly
- **Terminal** for installation = transparent, shows progress, handles interactive input
- **Hybrid approach** = best of both worlds

## FAQ

**Q: Why does it open Terminal?**

A: The Terminal shows installation progress in real-time and allows secure input of sensitive data like API keys. This transparency helps users understand what's happening.

**Q: Can I skip the GUI entirely?**

A: Yes! Use the one-line installer instead:
```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh | bash
```

**Q: Does this work on Windows or Linux?**

A: No, this is macOS-specific. On other platforms, use the web installer or local-install.sh script directly.

**Q: How do I update MeticAI after installation?**

A: From the installation directory, run:
```bash
./update.sh
```

**Q: How do I uninstall?**

A: From the installation directory, run:
```bash
./uninstall.sh
```

## Additional Resources

- [Full macOS Installer Documentation](README.md)
- [Main MeticAI Documentation](../README.md)
- [Technical Details](../TECHNICAL.md)
- [API Documentation](../API.md)

---

**Need Help?**

- 📖 [Read the full documentation](README.md)
- 🐛 [Report an issue](https://github.com/hessius/MeticAI/issues)
- 💬 [Ask a question](https://github.com/hessius/MeticAI/discussions)
