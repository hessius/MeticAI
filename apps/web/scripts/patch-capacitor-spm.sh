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

echo "Capacitor SPM patching complete."
