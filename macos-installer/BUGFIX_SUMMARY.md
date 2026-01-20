# macOS Apps - Critical Bug Fixes Summary

## Issues Addressed

This commit fixes critical bugs reported from real-world testing:

### Installer Issues
1. ❌ Welcome page shows blank icon
2. ❌ Fails to detect Docker Desktop even when installed and running

### Uninstaller Issues  
1. ❌ Shows blank icon
2. ❌ Fails to remove Docker containers (server still running after uninstall)

## Root Causes Identified

### 1. Docker Detection Failure

**Problem:** When apps run via Platypus, they inherit a minimal PATH that doesn't include Docker's installation location.

**Root Cause:**
- Platypus apps run with PATH: `/usr/bin:/bin:/usr/sbin:/sbin`
- Docker Desktop installs to: `/Applications/Docker.app/Contents/Resources/bin`
- This path is not included by default

**Evidence:**
User reported "doesn't find docker installed on system" despite Docker Desktop being installed and running.

### 2. Incomplete Container Removal

**Problem:** Uninstaller wasn't removing all Docker containers.

**Root Causes:**
1. Only searched for *running* containers (`docker ps` without `-a`)
2. Name filters too specific - missed containers with variant names
3. Didn't check for containers by compose project label
4. Didn't use `--volumes` and `--remove-orphans` flags

**Evidence:**
User reported "server is still running" after uninstallation.

### 3. Blank Icon Issue

**Problem:** App icons not appearing in Finder/Dock.

**Root Cause:**
- Info.plist missing `CFBundleDisplayName` key
- Missing `LSUIElement` specification
- AppleScript dialogs don't automatically inherit app icon (this is a macOS limitation)

## Fixes Implemented

### Fix 1: Enhanced PATH Configuration

**Files Modified:**
- `macos-installer/install-wrapper.sh`
- `macos-installer/uninstall-wrapper.sh`

**Changes:**
```bash
# Added at the beginning of both scripts
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

**Impact:**
- Docker command now accessible regardless of Platypus environment
- Also includes `/usr/local/bin` for homebrew-installed tools
- Covers all common Docker Desktop installation scenarios

### Fix 2: Comprehensive Container Removal

**File Modified:** `macos-installer/uninstall-wrapper.sh`

**Changes:**

1. **Search ALL containers** (not just running):
   ```bash
   # Before: docker ps -q
   # After:  docker ps -aq
   ```

2. **Multiple removal strategies**:
   - docker-compose down with `--volumes --remove-orphans`
   - Stop by project name: `docker compose -p meticai down`
   - Find by name filters (expanded)
   - Find by compose project label
   - Force remove: `docker rm -f`

3. **Better filtering**:
   ```bash
   # Check by directory name as project
   local dir_name=$(basename "$install_dir" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]_-')
   local project_containers=$(docker ps -aq --filter "label=com.docker.compose.project=$dir_name")
   ```

4. **Enhanced logging**:
   - Logs container IDs being removed
   - Logs which removal method succeeded
   - Clear progress messages

**Impact:**
- All containers removed regardless of state (running/stopped)
- Works even if docker-compose.yml is missing
- Handles various naming conventions
- Provides detailed troubleshooting information

### Fix 3: Improved App Bundle Configuration

**Files Modified:**
- `macos-installer/build-macos-app.sh`
- `macos-installer/build-uninstaller-app.sh`

**Changes:**
Added to Info.plist:
```xml
<key>CFBundleDisplayName</key>
<string>${APP_NAME}</string>
<key>LSUIElement</key>
<false/>
```

**Impact:**
- Better icon display in Finder
- Proper app naming in macOS UI
- Not hidden from Dock/App Switcher

**Note:** AppleScript dialogs don't inherit app icons - this is a macOS limitation. The icon appears in Finder/Dock but not in individual dialogs.

### Fix 4: Debug Logging

**File Modified:** `macos-installer/install-wrapper.sh`

**Changes:**
Added comprehensive logging to prerequisite check:
```bash
log_message "Checking prerequisites..."
log_message "PATH: $PATH"
log_message "Git found at: $(command -v git)"
log_message "Docker found at: $docker_path"
log_message "Docker daemon is running"
log_message "Prerequisite check complete..."
```

**Impact:**
- Users can see what's being detected
- Easier troubleshooting
- Progress feedback via Platypus output

## Testing Recommendations

### For Installer

1. **Test Docker Detection:**
   - With Docker Desktop running → Should proceed
   - With Docker Desktop installed but not running → Should show "Start Docker Desktop" dialog
   - With Docker Desktop not installed → Should show "Install Docker Desktop" button

2. **Verify Logging:**
   - Check Platypus progress window shows PATH and detection results
   - Confirm helpful messages guide user

3. **Test Icon:**
   - Check app icon appears in Finder
   - Check app icon appears in Dock when running
   - Note: Dialogs won't show icon (macOS limitation)

### For Uninstaller

1. **Test Container Removal:**
   - Start MeticAI installation with containers running
   - Run uninstaller
   - Verify with: `docker ps -a | grep -E "(meticai|coffee-relay|gemini-client|meticulous-mcp)"`
   - Should return no results

2. **Test Multiple Scenarios:**
   - With docker-compose.yml present
   - With docker-compose.yml deleted
   - With containers stopped
   - With containers running
   - All should successfully remove containers

3. **Check Logging:**
   - Verify detailed logs show what was removed
   - Confirm progress messages are clear

## Build Instructions

To rebuild apps with fixes:

```bash
cd macos-installer

# Build installer
./build-macos-app.sh

# Build uninstaller  
./build-uninstaller-app.sh

# Both apps will be in macos-installer/build/
```

## Expected Behavior After Fixes

### Installer
✅ Detects Docker Desktop correctly (both command and daemon)  
✅ Shows specific messages for each prerequisite state  
✅ Provides clickable buttons to install missing tools  
✅ App icon visible in Finder/Dock  
✅ Logs help diagnose any issues  

### Uninstaller
✅ Removes ALL Docker containers (running and stopped)  
✅ Works even without docker-compose.yml  
✅ Handles various container naming conventions  
✅ App icon visible in Finder/Dock  
✅ Detailed logging shows what was removed  

## Technical Notes

### PATH in Platypus Apps

Platypus apps have a minimal PATH by default. Always explicitly set PATH at script start:
```bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

### Docker Container Cleanup

Always use multiple strategies:
1. `docker compose down --volumes --remove-orphans`
2. Search with `docker ps -aq` (not just `docker ps -q`)
3. Filter by multiple criteria (name, label)
4. Use `docker rm -f` to force removal

### macOS App Icons

- Info.plist controls Finder/Dock icons
- AppleScript dialogs don't inherit app icons
- Use `CFBundleIconFile` pointing to `AppIcon.icns`
- Include both `CFBundleName` and `CFBundleDisplayName`

## Commit Details

**Files Modified:** 4
- macos-installer/install-wrapper.sh (PATH + logging)
- macos-installer/uninstall-wrapper.sh (PATH + enhanced removal)
- macos-installer/build-macos-app.sh (Info.plist fixes)
- macos-installer/build-uninstaller-app.sh (Info.plist fixes)

**Lines Changed:** ~80 additions, ~15 modifications

**Backward Compatibility:** ✅ Fully compatible with previous installs
