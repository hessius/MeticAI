import Capacitor
import UIKit

@objc(MeticulousViewController)
class MeticulousViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        let plugin = MeticulousDiscoveryPlugin()
        // Capacitor 8's SPM xcframework hides bridge on Xcode 16.2, so register local plugins through ObjC dispatch.
        guard let bridge = value(forKey: "capacitorBridge") as? NSObject else {
            NSLog("MeticAI: unable to locate Capacitor bridge for MeticulousDiscoveryPlugin registration")
            return
        }
        let registerSelector = NSSelectorFromString("registerPluginInstance:")
        guard bridge.responds(to: registerSelector) else {
            NSLog("MeticAI: Capacitor bridge cannot register MeticulousDiscoveryPlugin")
            return
        }
        _ = bridge.perform(registerSelector, with: plugin)
    }
}
