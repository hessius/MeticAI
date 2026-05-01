import Capacitor
import ObjectiveC
import UIKit

@objc(MeticulousViewController)
class MeticulousViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        let plugin = MeticulousDiscoveryPlugin()
        // Capacitor 8's SPM xcframework hides bridge behind #if $NonescapableTypes on Xcode 16.2 (Swift 6.0).
        // KVC value(forKey:) throws NSUnknownKeyException for private Swift properties,
        // so access the ivar directly via ObjC runtime instead.
        guard let bridge = findCapacitorBridge() else {
            NSLog("MeticAI: unable to locate Capacitor bridge for MeticulousDiscoveryPlugin registration")
            return
        }
        let registerSelector = NSSelectorFromString("registerPluginInstance:")
        guard bridge.responds(to: registerSelector) else {
            NSLog("MeticAI: Capacitor bridge cannot register MeticulousDiscoveryPlugin")
            return
        }
        _ = bridge.perform(registerSelector, with: plugin)
        NSLog("MeticAI: MeticulousDiscoveryPlugin registered successfully")
    }

    /// Locate the private `capacitorBridge` ivar on `CAPBridgeViewController` using ObjC runtime introspection.
    private func findCapacitorBridge() -> NSObject? {
        var count: UInt32 = 0
        guard let ivars = class_copyIvarList(CAPBridgeViewController.self, &count) else { return nil }
        defer { free(ivars) }
        for i in 0..<Int(count) {
            guard let name = ivar_getName(ivars[i]) else { continue }
            let ivarName = String(cString: name)
            if ivarName.contains("capacitorBridge") {
                return object_getIvar(self, ivars[i]) as? NSObject
            }
        }
        return nil
    }
}
