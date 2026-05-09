import Capacitor
import Foundation

@objc(MeticulousDiscoveryPlugin)
public class MeticulousDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin, NetServiceBrowserDelegate, NetServiceDelegate {
    public let identifier = "MeticulousDiscoveryPlugin"
    public let jsName = "MeticulousDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise)
    ]

    private var browser: NetServiceBrowser?
    private var services: [NetService] = []
    private var machines: [[String: Any]] = []
    private var discoveryCall: CAPPluginCall?
    private var timeoutWorkItem: DispatchWorkItem?

    @objc func discover(_ call: CAPPluginCall) {
        finishDiscovery()

        discoveryCall = call
        services = []
        machines = []

        let timeoutMs = max(1000, call.options["timeoutMs"] as? Int ?? 5000)
        let browser = NetServiceBrowser()
        browser.delegate = self
        self.browser = browser

        DispatchQueue.main.async {
            browser.searchForServices(ofType: "_meticulous._tcp.", inDomain: "local.")
        }

        let timeout = DispatchWorkItem { [weak self] in
            self?.finishDiscovery()
        }
        timeoutWorkItem = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(timeoutMs) / 1000.0, execute: timeout)
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        services.append(service)
        service.resolve(withTimeout: 3.0)
    }

    public func netServiceDidResolveAddress(_ sender: NetService) {
        guard let host = sender.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")), !host.isEmpty else {
            return
        }
        let port = sender.port > 0 ? sender.port : 8080
        let url = "http://\(host):\(port)"

        if machines.contains(where: { $0["url"] as? String == url }) {
            return
        }

        machines.append([
            "name": sender.name,
            "host": host,
            "port": port,
            "url": url
        ])
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        let code = errorDict[NetService.errorCode]?.intValue ?? -1
        finishDiscovery(errorMessage: "Bonjour discovery failed with error code \(code).")
    }

    private func finishDiscovery(errorMessage: String? = nil) {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil

        browser?.stop()
        browser?.delegate = nil
        browser = nil

        for service in services {
            service.delegate = nil
        }
        services = []

        if let errorMessage {
            discoveryCall?.unavailable(errorMessage)
        } else {
            discoveryCall?.resolve(["machines": machines])
        }
        discoveryCall = nil
    }
}
