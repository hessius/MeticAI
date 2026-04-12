import Capacitor
import Network

/// Native mDNS/Bonjour discovery plugin for finding Meticulous espresso machines
/// on the local network. Browses for _meticulous._tcp.local. services using NWBrowser.
@objc(MeticulousDiscoveryPlugin)
public class MeticulousDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeticulousDiscoveryPlugin"
    public let jsName = "MeticulousDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "browse", returnType: CAPPluginReturnPromise),
    ]

    private var activeBrowser: NWBrowser?

    /// Browse the local network for Meticulous machines via Bonjour/mDNS.
    /// Returns discovered service names and hostnames.
    @objc func browse(_ call: CAPPluginCall) {
        let timeout = (call.options["timeout"] as? Double) ?? 4.0

        // Cancel any previous browse
        activeBrowser?.cancel()

        let parameters = NWParameters()
        parameters.includePeerToPeer = true

        let browser = NWBrowser(
            for: .bonjour(type: "_meticulous._tcp", domain: "local."),
            using: parameters
        )
        activeBrowser = browser

        var discovered: [[String: Any]] = []

        browser.browseResultsChangedHandler = { results, _ in
            discovered.removeAll()
            for result in results {
                if case .service(let name, let type, let domain, _) = result.endpoint {
                    discovered.append([
                        "name": name,
                        "host": "\(name).local",
                        "type": type,
                        "domain": domain,
                    ])
                }
            }
        }

        browser.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed(let error):
                print("[MeticulousDiscovery] Browse failed: \(error)")
                browser.cancel()
                self?.activeBrowser = nil
                call.resolve(["machines": [] as [[String: Any]], "error": error.localizedDescription])
            case .ready:
                print("[MeticulousDiscovery] Browse started")
            default:
                break
            }
        }

        browser.start(queue: .main)

        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
            browser.cancel()
            self?.activeBrowser = nil
            print("[MeticulousDiscovery] Found \(discovered.count) machine(s)")
            call.resolve(["machines": discovered])
        }
    }
}
