import UIKit
import Social
import UniformTypeIdentifiers
import MobileCoreServices

/// Share Extension for Metic.
///
/// Collects whatever the user shares (a metprofiles link, a direct profile URL,
/// pasted profile JSON, or a shared .json / .met file), writes it into the App
/// Group container under the key the @capgo/capacitor-share-target plugin reads
/// (`share-target-data`), then opens the host app via the `metic://share` URL
/// scheme so the app can resolve and import the profile.
///
/// Keep the App Group id in sync with `capacitor.config.ts`
/// (`CapacitorShareTarget.appGroupId`) and `ShareExtension.entitlements`.
class ShareViewController: UIViewController {
    private let appGroupId = "group.com.metic.app"
    private let sharedDataKey = "share-target-data"
    private let hostURLScheme = "metic://share"

    override func viewDidLoad() {
        super.viewDidLoad()
        handleShare()
    }

    private func handleShare() {
        guard
            let extensionItems = extensionContext?.inputItems as? [NSExtensionItem]
        else {
            complete()
            return
        }

        let group = DispatchGroup()
        var texts: [String] = []
        var files: [[String: Any]] = []
        let lock = NSLock()

        for item in extensionItems {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                        if let url = data as? URL {
                            lock.lock(); texts.append(url.absoluteString); lock.unlock()
                        }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                        if let text = data as? String {
                            lock.lock(); texts.append(text); lock.unlock()
                        }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.json.identifier) {
                    group.enter()
                    provider.loadFileRepresentation(forTypeIdentifier: UTType.json.identifier) { url, _, _ in
                        if let url = url, let copied = self.copyToAppGroup(url) {
                            lock.lock(); files.append(copied); lock.unlock()
                        }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.item.identifier) {
                    group.enter()
                    provider.loadFileRepresentation(forTypeIdentifier: UTType.item.identifier) { url, _, _ in
                        if let url = url, self.isProfileFile(url), let copied = self.copyToAppGroup(url) {
                            lock.lock(); files.append(copied); lock.unlock()
                        }
                        group.leave()
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.persist(texts: texts, files: files)
            self?.openHostApp()
            self?.complete()
        }
    }

    private func isProfileFile(_ url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return ext == "json" || ext == "met"
    }

    private func copyToAppGroup(_ url: URL) -> [String: Any]? {
        guard
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: appGroupId
            )
        else { return nil }

        let filename = url.lastPathComponent
        let dest = container.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: dest)
        do {
            try FileManager.default.copyItem(at: url, to: dest)
        } catch {
            return nil
        }

        let mime = url.pathExtension.lowercased() == "met" ? "application/octet-stream" : "application/json"
        return ["uri": dest.path, "name": filename, "mimeType": mime]
    }

    private func persist(texts: [String], files: [[String: Any]]) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
        let payload: [String: Any] = [
            "title": "",
            "texts": texts,
            "files": files,
        ]
        defaults.set(payload, forKey: sharedDataKey)
        defaults.synchronize()
    }

    private func openHostApp() {
        guard let url = URL(string: hostURLScheme) else { return }
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let current = responder {
            if current.responds(to: selector) && current != self {
                current.perform(selector, with: url)
                return
            }
            responder = current.next
        }
    }

    private func complete() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
