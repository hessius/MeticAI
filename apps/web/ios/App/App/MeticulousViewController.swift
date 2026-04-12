import UIKit
import Capacitor

/// Custom view controller that registers local Capacitor plugins.
class MeticulousViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MeticulousDiscoveryPlugin())
    }
}
