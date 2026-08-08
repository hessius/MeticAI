import Capacitor
import Foundation
import WidgetKit

/// Bridges favourites, machine URL and widget-related settings from the web
/// layer into the shared App Group so the WidgetKit extension can read them,
/// and triggers widget timeline reloads.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setFavourites", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMachineUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOpenAppOnStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reloadWidgets", returnType: CAPPluginReturnPromise),
    ]

    private static let appGroup = "group.com.metic.app"
    private static let schemaVersion = 1

    private var defaults: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }
    private var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)
    }

    @objc func setFavourites(_ call: CAPPluginCall) {
        guard let favourites = call.getArray("favourites") as? [[String: Any]] else {
            call.reject("favourites array required"); return
        }
        // Cache each image into the shared container and rewrite the entry with
        // a stable filename the extension can load without network access.
        var stored: [[String: Any]] = []
        for fav in favourites {
            var entry = fav
            if let id = fav["id"] as? String,
               let imageUrl = fav["imageUrl"] as? String,
               let filename = cacheImage(id: id, from: imageUrl) {
                entry["imageFilename"] = filename
            }
            entry.removeValue(forKey: "imageUrl")
            stored.append(entry)
        }
        if let data = try? JSONSerialization.data(withJSONObject: stored) {
            defaults?.set(data, forKey: "favourites")
        }
        defaults?.set(Self.schemaVersion, forKey: "schemaVersion")
        reloadAll()
        call.resolve()
    }

    @objc func setMachineUrl(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else { call.reject("url required"); return }
        defaults?.set(url, forKey: "machineUrl")
        reloadAll()
        call.resolve()
    }

    @objc func setOpenAppOnStart(_ call: CAPPluginCall) {
        defaults?.set(call.getBool("enabled") ?? false, forKey: "openAppOnStart")
        call.resolve()
    }

    @objc func reloadWidgets(_ call: CAPPluginCall) {
        reloadAll()
        call.resolve()
    }

    private func reloadAll() {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Downloads a data-URI or http(s) image and writes it as favourites/<id>.png
    /// in the shared container. Returns the filename on success.
    private func cacheImage(id: String, from imageUrl: String) -> String? {
        guard let container = containerURL else { return nil }
        let favDir = container.appendingPathComponent("favourites", isDirectory: true)
        try? FileManager.default.createDirectory(at: favDir, withIntermediateDirectories: true)

        // Sanitise the id for use as a filename.
        let safeId = id.replacingOccurrences(of: "/", with: "_")
        let filename = "\(safeId).png"
        let dest = favDir.appendingPathComponent(filename)

        var imageData: Data?
        if imageUrl.hasPrefix("data:") {
            if let commaIdx = imageUrl.firstIndex(of: ",") {
                let b64 = String(imageUrl[imageUrl.index(after: commaIdx)...])
                imageData = Data(base64Encoded: b64)
            }
        } else if let url = URL(string: imageUrl) {
            imageData = try? Data(contentsOf: url)
        }
        guard let data = imageData else { return nil }
        do { try data.write(to: dest); return filename } catch { return nil }
    }
}
