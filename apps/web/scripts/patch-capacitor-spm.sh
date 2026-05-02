#!/bin/sh
# Patches Capacitor plugin Swift source files for Xcode 16.2 (Swift 6.0.3)
# compatibility with Capacitor 8.x xcframeworks.
#
# The Capacitor xcframework's swiftinterface gates these APIs behind
# #if $NonescapableTypes (Swift 6.1 / Xcode 16.3+):
#   getString(_:) -> String?             →  call.options["key"] as? String
#   getBool(_:) -> Bool?                 →  call.options["key"] as? Bool
#   getInt(_:) -> Int?                   →  call.options["key"] as? Int
#   getFloat(_:) -> Float?              →  call.options["key"] as? Float
#   getDouble(_:) -> Double?            →  call.options["key"] as? Double
#   getArray(_:) -> JSArray?             →  call.options["key"] as? [Any]
#   getArray(_:, _:.self) -> [T]?        →  call.options["key"] as? [T]
#   getObject(_:) -> JSObject?           →  call.options["key"] as? [String: Any]
#   reject(...)                          →  unimplemented(first-arg-only)
#   bridge?.viewController               →  KVC via NSObject cast
#   UIColor.capacitor.color(fromHex:)    →  inline hex parser
#   Data.capacitor.data(base64Encoded..) →  inline base64 parser
#   JSTypes.coerceDictionaryToJSObject   →  as? JSObject
#   bridge?.localURL(fromWebURL:)        →  NSObject perform selector
#
# Also handles constant args (kKey) not just string literals ("key").
# Two-argument versions (e.g. getString("k","default")) are NOT gated.
#
# Safe to run multiple times (idempotent).

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
NODE_MODULES="$WEB_DIR/node_modules"

# ─── Generic patcher (Python) ───────────────────────────────────────
# Patches any .swift file: replaces single-arg gated calls + reject.
# Skips files that are already patched (no gated calls remain).
patch_swift_file() {
    local FILE="$1"
    [ -f "$FILE" ] || return 0

    # Quick idempotency check: skip if no gated calls remain
    if ! grep -qE 'call\.(getString|getBool|getInt|getFloat|getDouble|getArray|getObject)\([^,)]*\)[^,]|call\.reject\(|bridge\?\.viewController|UIColor\.capacitor\.color|Data\.capacitor\.data|JSTypes\.coerce|bridge\?\.localURL' "$FILE" 2>/dev/null; then
        echo "  Already patched: $(basename "$FILE")"
        return 0
    fi

    python3 << PYEOF
import re, sys

path = "$FILE"
with open(path, 'r') as f:
    content = f.read()

original = content

# --- getString, getBool, getInt, getFloat, getDouble: single-arg only ---
# Match both string literals ("key") and constants (kKey, myVar)
# Must NOT match two-arg versions (with comma before close paren at same depth)
for method, swift_type in [
    ('getString', 'String'),
    ('getBool', 'Bool'),
    ('getInt', 'Int'),
    ('getFloat', 'Float'),
    ('getDouble', 'Double'),
]:
    # String literal arg: call.method("key") -> call.options["key"] as? Type
    content = re.sub(
        r'call\.' + method + r'\("([^"]*)"\)',
        r'(call.options["\1"] as? ' + swift_type + ')',
        content
    )
    # Constant arg: call.method(kConst) or call.method(Enum.case) -> call.options[kConst] as? Type
    content = re.sub(
        r'call\.' + method + r'\(([a-zA-Z_][\w.]*)\)',
        r'(call.options[\1] as? ' + swift_type + ')',
        content
    )

# Single-arg getArray("key") (no type param) → call.options["key"] as? [Any]
content = re.sub(
    r'call\.getArray\("([^"]*)"\)(?!\s*,)',
    r'call.options["\1"] as? [Any]',
    content
)

# getArray("key", Type.self) → call.options["key"] as? [Type]
content = re.sub(
    r'call\.getArray\("([^"]*)",\s*(\w+)\.self\)',
    r'(call.options["\1"] as? [\2])',
    content
)

# Single-arg getArray("key") → call.options["key"] as? [Any]
content = re.sub(
    r'call\.getArray\("([^"]*)"\)',
    r'(call.options["\1"] as? [Any])',
    content
)

# Single-arg getObject("key") → call.options["key"] as? [String: Any]
content = re.sub(
    r'call\.getObject\("([^"]*)"\)',
    r'(call.options["\1"] as? [String: Any])',
    content
)

# JSTypes.coerceDictionaryToJSObject(dict) → dict as? JSObject
content = re.sub(
    r'JSTypes\.coerceDictionaryToJSObject\(([^)]+)\)',
    r'\1 as? JSObject',
    content
)

# UIColor.capacitor.color(fromHex: expr) → colorFromHex(expr)
# Also inject helper function if needed
if 'UIColor.capacitor.color(fromHex:' in content:
    helper = '''
private func colorFromHex(_ hex: String) -> UIColor? {
    var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")
    var rgb: UInt64 = 0
    guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }
    let r = CGFloat((rgb & 0xFF0000) >> 16) / 255.0
    let g = CGFloat((rgb & 0x00FF00) >> 8) / 255.0
    let b = CGFloat(rgb & 0x0000FF) / 255.0
    return UIColor(red: r, green: g, blue: b, alpha: 1.0)
}
'''
    content = re.sub(
        r'UIColor\.capacitor\.color\(fromHex:\s*([^)]+)\)',
        r'colorFromHex(\1)',
        content
    )
    # Inject helper after last import line
    import_end = 0
    for m in re.finditer(r'^import .+$', content, re.MULTILINE):
        import_end = m.end()
    if import_end > 0 and 'func colorFromHex' not in content:
        content = content[:import_end] + '\n' + helper + content[import_end:]

# Data.capacitor.data(base64EncodedOrDataUrl: str) → decodeBase64OrDataUrl(str)
if 'Data.capacitor.data(base64EncodedOrDataUrl:' in content:
    helper2 = '''
private func decodeBase64OrDataUrl(_ string: String) -> Data? {
    if let range = string.range(of: ";base64,") {
        return Data(base64Encoded: String(string[range.upperBound...]))
    }
    return Data(base64Encoded: string)
}
'''
    content = re.sub(
        r'Data\.capacitor\.data\(base64EncodedOrDataUrl:\s*([^)]+)\)',
        r'decodeBase64OrDataUrl(\1)',
        content
    )
    import_end = 0
    for m in re.finditer(r'^import .+$', content, re.MULTILINE):
        import_end = m.end()
    if import_end > 0 and 'func decodeBase64OrDataUrl' not in content:
        content = content[:import_end] + '\n' + helper2 + content[import_end:]

# bridge?.localURL(fromWebURL: url) → KVC via NSObject
content = re.sub(
    r'bridge\?\.localURL\(fromWebURL:\s*([^)]+)\)',
    r'(bridge as? NSObject)?.perform(NSSelectorFromString("localURLFromWebURL:"), with: \1)?.takeUnretainedValue() as? URL',
    content
)

# reject(...) → unimplemented(first-arg-only)
# Full reject signature: reject(message, code?, error?, data?)
# unimplemented only takes a message string
# Use string scanning to handle nested parens, commas in strings, etc.
def patch_reject_calls(text):
    result = []
    i = 0
    marker = 'call.reject('
    while i < len(text):
        pos = text.find(marker, i)
        if pos == -1:
            result.append(text[i:])
            break
        result.append(text[i:pos])
        # Find matching close paren
        start = pos + len(marker)
        depth = 1
        in_str = False
        esc = False
        j = start
        while j < len(text) and depth > 0:
            ch = text[j]
            if esc:
                esc = False
            elif ch == '\\\\':
                esc = True
            elif ch == '"':
                in_str = not in_str
            elif not in_str:
                if ch == '(':
                    depth += 1
                elif ch == ')':
                    depth -= 1
            j += 1
        args_str = text[start:j - 1]
        # Extract first argument
        depth2 = 0
        in_str2 = False
        esc2 = False
        first_end = len(args_str)
        for k, ch in enumerate(args_str):
            if esc2:
                esc2 = False
                continue
            if ch == '\\\\':
                esc2 = True
                continue
            if ch == '"':
                in_str2 = not in_str2
            if not in_str2:
                if ch in '([':
                    depth2 += 1
                elif ch in ')]':
                    depth2 -= 1
                elif ch == ',' and depth2 == 0:
                    first_end = k
                    break
        first_arg = args_str[:first_end].strip()
        result.append(f'call.unimplemented({first_arg})')
        i = j
    return ''.join(result)

content = patch_reject_calls(content)

# bridge?.viewController → KVC via NSObject cast (gated behind NonescapableTypes)
content = re.sub(
    r'(\bself\?\.)bridge\?\.viewController',
    r'((\1bridge as? NSObject)?.value(forKey: "viewController") as? UIViewController)',
    content
)

if content != original:
    with open(path, 'w') as f:
        f.write(content)
    print(f"  Patched: {path.split('node_modules/')[-1]}")
else:
    print(f"  No changes: {path.split('node_modules/')[-1]}")
PYEOF
}

# ─── Discover and patch all plugin Swift files ──────────────────────
echo "Patching Capacitor plugins for Xcode 16.2 (Swift 6.0.3)..."

# Official Capacitor plugins
for PLUGIN_DIR in "$NODE_MODULES"/@capacitor/*/ios; do
    [ -d "$PLUGIN_DIR" ] || continue
    find "$PLUGIN_DIR" -name "*.swift" -not -path "*/.build/*" | while read -r FILE; do
        patch_swift_file "$FILE"
    done
done

# Community plugins
for PLUGIN_DIR in "$NODE_MODULES"/@capacitor-community/*/ios; do
    [ -d "$PLUGIN_DIR" ] || continue
    find "$PLUGIN_DIR" -name "*.swift" -not -path "*/.build/*" | while read -r FILE; do
        patch_swift_file "$FILE"
    done
done

# Aparajita plugins
for PLUGIN_DIR in "$NODE_MODULES"/@aparajita/*/ios; do
    [ -d "$PLUGIN_DIR" ] || continue
    find "$PLUGIN_DIR" -name "*.swift" -not -path "*/.build/*" | while read -r FILE; do
        patch_swift_file "$FILE"
    done
done

# ─── capacitor-zeroconf special handling ────────────────────────────
# Needs Package.swift for SPM + CAPBridgedPlugin conformance
ZEROCONF_DIR="$NODE_MODULES/capacitor-zeroconf"
ZEROCONF_PLUGIN="$ZEROCONF_DIR/ios/Plugin/ZeroConfPlugin.swift"
ZEROCONF_PKG="$ZEROCONF_DIR/Package.swift"

if [ -d "$ZEROCONF_DIR" ]; then
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
        echo "  Created: capacitor-zeroconf/Package.swift"
    fi

    # Add CAPBridgedPlugin conformance if missing
    if [ -f "$ZEROCONF_PLUGIN" ] && ! grep -q 'CAPBridgedPlugin' "$ZEROCONF_PLUGIN" 2>/dev/null; then
        python3 << PYEOF
path = "$ZEROCONF_PLUGIN"
with open(path, 'r') as f:
    content = f.read()

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

with open(path, 'w') as f:
    f.write(content)
print("  Added CAPBridgedPlugin to ZeroConfPlugin")
PYEOF
    fi

    # Apply standard gated API patches
    patch_swift_file "$ZEROCONF_PLUGIN"
fi

# ─── Add -ObjC linker flag if missing ──────────────────────────────
# Required so the linker keeps ObjC classes from SPM static libraries,
# allowing NSClassFromString() to find them at runtime.
PBXPROJ="$WEB_DIR/ios/App/App.xcodeproj/project.pbxproj"
if [ -f "$PBXPROJ" ] && ! grep -q 'OTHER_LDFLAGS' "$PBXPROJ" 2>/dev/null; then
    INHERITED='$(inherited)'
    python3 - "$PBXPROJ" "$INHERITED" << 'PYEOF'
import re, sys

path = sys.argv[1]
inherited = sys.argv[2]

with open(path, 'r') as f:
    content = f.read()

def add_ldflags(match):
    block = match.group(0)
    if 'OTHER_LDFLAGS' not in block and 'PRODUCT_BUNDLE_IDENTIFIER' in block:
        ld_entry = (
            f'OTHER_LDFLAGS = (\n'
            f'\t\t\t\t\t"{inherited}",\n'
            f'\t\t\t\t\t"-ObjC",\n'
            f'\t\t\t\t);\n'
            f'\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER'
        )
        block = block.replace('PRODUCT_BUNDLE_IDENTIFIER', ld_entry)
    return block

content = re.sub(r'buildSettings\s*=\s*\{[^}]+\}', add_ldflags, content)

with open(path, 'w') as f:
    f.write(content)
print("  Added -ObjC to App target linker flags")
PYEOF
fi

echo "Capacitor SPM patching complete."
