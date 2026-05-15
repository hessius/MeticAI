import Capacitor
import ObjectiveC
import UIKit

@objc(MeticulousViewController)
class MeticulousViewController: CAPBridgeViewController {

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
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
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
        // Ensure WKWebView always fills the full safe area
        webView?.frame = view.bounds
    }

    private func forceWebViewRelayout() {
        guard let webView = self.webView else { return }
        let bounds = view.bounds
        // Temporarily resize to force WKWebView to recalculate viewport
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
    }

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
