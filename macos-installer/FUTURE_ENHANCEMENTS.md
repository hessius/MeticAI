# Future Enhancements for macOS Installer

This document tracks potential improvements and enhancements for the macOS installer app.

## Security Enhancements

### 1. Checksum Verification of Downloaded Installer
**Priority: High**
**Status: Planned**

Currently, the installer downloads `web_install.sh` from the main branch without verification.

**Proposed Solution:**
- Option A: Download from a specific commit hash instead of 'main' branch
- Option B: Implement SHA-256 checksum verification
- Option C: Use GPG signature verification

**Implementation:**
```bash
# Example with checksum verification
EXPECTED_CHECKSUM="abc123..."
DOWNLOADED_CHECKSUM=$(shasum -a 256 "$TEMP_INSTALLER" | awk '{print $1}')

if [ "$EXPECTED_CHECKSUM" != "$DOWNLOADED_CHECKSUM" ]; then
    echo "ERROR: Installer checksum mismatch - potential tampering detected"
    exit 1
fi
```

**Trade-offs:**
- Commit hash: Ensures exact version but requires updating installer for each release
- Checksum: Good security but requires maintaining checksum file
- GPG signature: Best security but adds complexity

### 2. Code Signing and Notarization
**Priority: Medium**
**Status: Documented in README**

For wider distribution, the app should be code-signed and notarized by Apple.

**Benefits:**
- No "app is damaged" warnings
- Better security reputation
- Easier distribution

**Requirements:**
- Apple Developer account ($99/year)
- Developer ID certificate
- Notarization workflow

**See:** README.md for detailed instructions

## User Experience Enhancements

### 3. Pure GUI Mode (No Terminal)
**Priority: Medium**
**Status: Proposed**

Currently, the installer opens Terminal for the main installation. Could collect all inputs via GUI.

**Proposed Changes:**
- API key input via secure text field dialog
- IP address input via text field with validation
- Progress bar showing installation steps
- Log viewer for detailed output (optional)

**Implementation Considerations:**
- AppleScript has limited UI capabilities
- May need to use Swift/Objective-C for better UI
- Trade-off: Less transparency vs more user-friendly

### 4. Auto-Install Prerequisites
**Priority: Low**
**Status: Proposed**

Currently, if Git or Docker are missing, we show instructions. Could auto-install with user permission.

**Proposed Changes:**
- Offer to install Homebrew if missing
- Auto-install Git via `xcode-select --install`
- Auto-download Docker Desktop installer
- Show progress during installation

**Challenges:**
- Requires sudo permissions
- Docker Desktop needs manual setup after install
- May take significant time

### 5. Installation Progress Indicator
**Priority: Medium**
**Status: Proposed**

Show a native macOS progress bar instead of just Terminal output.

**Options:**
- Use AppleScript progress indicator
- Use Swift app with progress bar
- Show estimated time remaining
- Display current step

### 6. Offline Installer Option
**Priority: Low**
**Status: Proposed**

Bundle all dependencies in the installer for offline installation.

**What to Bundle:**
- web_install.sh script
- Docker images (large - ~1GB+)
- Git installer
- All documentation

**Trade-offs:**
- Much larger download size
- Easier for users with limited connectivity
- More complex build process

## Internationalization

### 7. Multi-Language Support
**Priority: Low**
**Status: Proposed**

Support multiple languages for dialogs and messages.

**Languages to Consider:**
- Spanish
- French
- German
- Japanese

**Implementation:**
- Detect system language
- Load appropriate string resources
- Fallback to English if translation unavailable

## Advanced Features

### 8. Update Checker App
**Priority: Medium**
**Status: Proposed**

Separate app to check for and apply MeticAI updates.

**Features:**
- Check for updates with one click
- Download and apply updates
- Show changelog
- Rollback option

### 9. Uninstaller App
**Priority: Low**
**Status: Proposed**

GUI version of the uninstall.sh script.

**Features:**
- List installed components
- Choose what to remove
- Confirmation dialogs
- Progress indication

### 10. Configuration Manager App
**Priority: Low**
**Status: Proposed**

GUI for managing MeticAI configuration.

**Features:**
- Edit API key
- Update IP addresses
- Restart services
- View logs
- Test connection

## Developer Experience

### 11. Automated DMG Creation in CI
**Priority: High**
**Status: Planned**

Create GitHub Actions workflow to build and publish DMG on releases.

**Workflow:**
```yaml
name: Build macOS Installer
on:
  release:
    types: [created]
jobs:
  build-dmg:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Platypus
        run: brew install platypus
      - name: Build app
        run: cd macos-installer && ./build-macos-app.sh
      - name: Create DMG
        run: hdiutil create ...
      - name: Upload to release
        uses: actions/upload-release-asset@v1
```

### 12. Automated Testing on macOS
**Priority: Medium**
**Status: Planned**

Currently tests run on Linux. Should also test on macOS.

**Implementation:**
- Add macOS runner to CI
- Test app launch (may need headless mode)
- Test dialog display
- Test installer execution

## Documentation Improvements

### 13. Video Tutorial
**Priority: Low**
**Status: Proposed**

Create a video showing installation process.

**Content:**
- Download DMG
- Open and install
- Launch app
- Follow prompts
- Access web interface

### 14. Troubleshooting Database
**Priority: Low**
**Status: Proposed**

Maintain database of common issues and solutions.

**Examples:**
- "App won't open" → Quarantine removal
- "Docker not found" → Installation instructions
- "Installation fails" → Check logs

## Implementation Priority

### High Priority (Next Release)
1. Checksum verification
2. Automated DMG creation in CI

### Medium Priority (Future Release)
3. Pure GUI mode
4. Installation progress indicator
5. Update checker app
6. Automated macOS testing

### Low Priority (Backlog)
7. Auto-install prerequisites
8. Offline installer
9. Multi-language support
10. Uninstaller app
11. Configuration manager
12. Video tutorial
13. Troubleshooting database

## Contributing

Want to implement one of these enhancements? Great!

1. Check if there's an existing issue or PR
2. Create an issue to discuss the approach
3. Implement and test thoroughly
4. Submit a PR with comprehensive tests
5. Update this document to mark as "In Progress" or "Complete"

## Notes

- All enhancements should maintain backward compatibility
- Test coverage must remain at 100%
- Documentation must be updated
- Security enhancements take priority over features
- User experience improvements should not sacrifice transparency

---

**Last Updated:** January 19, 2026  
**Status:** Active planning document
