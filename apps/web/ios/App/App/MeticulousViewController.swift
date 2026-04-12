import UIKit
import Capacitor

/// Custom view controller that registers local Capacitor plugins.
class MeticulousViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // Capacitor 8 SPM xcframework gates `bridge` behind #if $NonescapableTypes
        // (unavailable in Xcode 16.2 / Swift 6.0.3). Access the private backing
        // property via KVC — the ivar exists in the compiled binary.
        guard let capBridge = self.value(forKey: "capacitorBridge") as AnyObject? else { return }
        let sel = NSSelectorFromString("registerPluginInstance:")
        if capBridge.responds(to: sel) {
            _ = capBridge.perform(sel, with: MeticulousDiscoveryPlugin())
        }
    }
}
