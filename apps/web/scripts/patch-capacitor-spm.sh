#!/bin/sh
# Patches Capacitor plugin Swift source files for Xcode 16.2 (Swift 6.0.3)
# compatibility with Capacitor 8.x xcframeworks.
#
# The Capacitor xcframework's swiftinterface gates getString(_:)->String? and
# reject(_:...) behind #if $NonescapableTypes. Without this feature (added in
# Swift 6.1 / Xcode 16.3), those methods are invisible to the compiler.
#
# This script patches plugin source to use available alternatives:
#   getString("key") → call.options["key"] as? String
#   call.reject(msg)  → call.unimplemented(msg)
#
# Safe to run multiple times (idempotent).

set -eu

# Cross-platform in-place sed (BSD on macOS, GNU on Linux/Docker)
sedi() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
NODE_MODULES="$WEB_DIR/node_modules"

# --- Patch @capacitor/preferences ---
PREFS="$NODE_MODULES/@capacitor/preferences/ios/Sources/PreferencesPlugin/PreferencesPlugin.swift"
if [ -f "$PREFS" ]; then
    if grep -q 'call\.reject' "$PREFS" 2>/dev/null; then
        # Replace single-arg getString used in guard/if-let with direct options access
        sedi 's/call\.getString("group")/call.options["group"] as? String/g' "$PREFS"
        sedi 's/call\.getString("key")/call.options["key"] as? String/g' "$PREFS"
        # Replace reject() with unimplemented() (available without NonescapableTypes)
        sedi 's/call\.reject(\(.*\))/call.unimplemented(\1)/g' "$PREFS"
        echo "Patched: PreferencesPlugin.swift"
    else
        echo "Already patched: PreferencesPlugin.swift"
    fi
fi

# --- Patch capacitor-zeroconf for SPM + Xcode 16.2 ---
ZEROCONF_DIR="$NODE_MODULES/capacitor-zeroconf"
ZEROCONF_PLUGIN="$ZEROCONF_DIR/ios/Plugin/ZeroConfPlugin.swift"
ZEROCONF_PKG="$ZEROCONF_DIR/Package.swift"

if [ -d "$ZEROCONF_DIR" ]; then
    # Create Package.swift for SPM (Capacitor 8) if missing
    if [ ! -f "$ZEROCONF_PKG" ]; then
        cat > "$ZEROCONF_PKG" << 'PKGEOF'
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorZeroconf",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "CapacitorZeroconf", targets: ["ZeroConfPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "ZeroConfPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Plugin",
            exclude: ["ZeroConfPlugin.m", "ZeroConfPlugin.h", "Info.plist"])
    ]
)
PKGEOF
        echo "Created: capacitor-zeroconf/Package.swift"
    fi

    # Patch ZeroConfPlugin.swift: add CAPBridgedPlugin, replace gated APIs
    if [ -f "$ZEROCONF_PLUGIN" ] && grep -q 'call\.getString' "$ZEROCONF_PLUGIN" 2>/dev/null; then
        python3 << PYEOF
import re

path = "$ZEROCONF_PLUGIN"
with open(path, 'r') as f:
    content = f.read()

# Add CAPBridgedPlugin conformance + plugin metadata
content = content.replace(
    'public class ZeroConfPlugin: CAPPlugin {',
    '''public class ZeroConfPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ZeroConfPlugin"
    public let jsName = "ZeroConf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getHostname", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "watch", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "unwatch", returnType: CAPPluginReturnPromise),
    ]'''
)

# Replace gated getString/getInt/getObject/reject calls
content = re.sub(r'call\.getString\("([^"]*)"\)', r'call.options["\1"] as? String', content)
content = re.sub(r'call\.getInt\("([^"]*)"\)', r'call.options["\1"] as? Int', content)
content = re.sub(r'call\.getObject\("([^"]*)"\)', r'call.options["\1"] as? [String: Any]', content)
content = re.sub(r'call\.reject\(([^)]*)\)', r'call.unimplemented(\1)', content)

with open(path, 'w') as f:
    f.write(content)
print("Patched: capacitor-zeroconf/ZeroConfPlugin.swift")
PYEOF
    else
        echo "Already patched or missing: capacitor-zeroconf/ZeroConfPlugin.swift"
    fi
fi

echo "Capacitor SPM patching complete."
