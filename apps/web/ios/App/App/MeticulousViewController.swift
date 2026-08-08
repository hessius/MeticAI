import Capacitor
import ObjectiveC
import UIKit

@objc(MeticulousViewController)
class MeticulousViewController: CAPBridgeViewController {

    /// Delay before forcing relayout after foreground resume.
    /// WKWebView needs one run-loop turn to
    /// finish its own geometry update; 150 ms gives enough headroom
    /// without a visible flicker.
    private static let foregroundRelayoutDelay: TimeInterval = 0.15

    private var foregroundObserver: NSObjectProtocol?

    override func viewDidLoad() {
        super.viewDidLoad()

        // Force WKWebView to recalculate layout when returning from background.
        // On iPad M4 Pro in landscape-lock, WKWebView can resume with stale
        // viewport dimensions, causing the web content to render squished.
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.foregroundRelayoutDelay) {
                self.forceWebViewRelayout()
            }
        }
    }

    deinit {
        if let observer = foregroundObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Ensure WKWebView always fills the full container bounds
        webView?.frame = view.bounds
    }

    private func forceWebViewRelayout() {
        guard let webView = self.webView else { return }
        let bounds = view.bounds
        guard bounds.height > 1 else { return }
        // Shrink height by 1pt so WKWebView detects a geometry change and
        // recalculates its viewport; the original frame is restored on the
        // next run-loop iteration.
        webView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: bounds.height - 1)
        DispatchQueue.main.async {
            webView.frame = bounds
            // Also tell the web content to re-evaluate
            webView.evaluateJavaScript("window.dispatchEvent(new Event('resize'))", completionHandler: nil)
        }
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        let plugin = MeticulousDiscoveryPlugin()
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

        let widgetBridge = WidgetBridgePlugin()
        _ = bridge.perform(registerSelector, with: widgetBridge)
        NSLog("MeticAI: WidgetBridgePlugin registered successfully")
    }

    /// Locate the private `capacitorBridge` ivar on `CAPBridgeViewController`
    /// using ObjC runtime introspection.
    ///
    /// Capacitor 8's SPM xcframework hides the bridge behind a Swift 6.0
    /// availability check, and KVC `value(forKey:)` throws
    /// `NSUnknownKeyException` for private Swift ivars, so we fall back
    /// to `class_copyIvarList` / `object_getIvar` instead.
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
