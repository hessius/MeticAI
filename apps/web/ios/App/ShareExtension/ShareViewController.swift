import UIKit
import UniformTypeIdentifiers

/// Share Extension for Metic.
///
/// Collects whatever the user shares (a metprofiles link, a direct profile URL,
/// pasted profile JSON, or a shared .json / .met file), writes it into the App
/// Group container under the `share-target-data` key the
/// @capgo/capacitor-share-target plugin reads, then opens `metic://share` so the
/// host app can resolve and import the profile through the same flow as the web
/// `?import=` parameter.
///
/// Keep `appGroupId` / `urlScheme` in sync with `capacitor.config.ts`
/// (`CapacitorShareTarget.appGroupId`), `ShareExtension.entitlements`, and the
/// app's `CFBundleURLTypes`.
class ShareViewController: UIViewController {
    private let appGroupId = "group.com.metic.app"
    private let sharedDataKey = "share-target-data"
    private let urlScheme = "metic://share"

    override func viewDidLoad() {
        super.viewDidLoad()
        collectSharedContent()
    }

    private func collectSharedContent() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            finish()
            return
        }

        let group = DispatchGroup()
        let lock = NSLock()
        var texts: [String] = []
        var files: [[String: Any]] = []

        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { value, _ in
                        if let url = value as? URL {
                            let str = url.absoluteString
                            // A file URL shared as public.url is really a file.
                            if url.isFileURL {
                                if let file = self.copyToAppGroup(url) {
                                    lock.lock(); files.append(file); lock.unlock()
                                }
                            } else {
                                lock.lock(); texts.append(str); lock.unlock()
                            }
                        }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.json.identifier) {
                    group.enter()
                    provider.loadFileRepresentation(forTypeIdentifier: UTType.json.identifier) { url, _ in
                        if let url = url, let file = self.copyToAppGroup(url) {
                            lock.lock(); files.append(file); lock.unlock()
                        }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { value, _ in
                        if let text = value as? String {
                            lock.lock(); texts.append(text); lock.unlock()
                        }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.item.identifier) {
                    group.enter()
                    provider.loadFileRepresentation(forTypeIdentifier: UTType.item.identifier) { url, _ in
                        if let url = url, self.isProfileFile(url), let file = self.copyToAppGroup(url) {
                            lock.lock(); files.append(file); lock.unlock()
                        }
                        group.leave()
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            self.persist(texts: texts, files: files)
            self.openHostApp()
            self.finish()
        }
    }

    private func isProfileFile(_ url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return ext == "json" || ext == "met"
    }

    /// Copy a shared file into the App Group container so the host app (a
    /// separate sandbox) can read it, and describe it the way the JS
    /// `SharedFile` shape expects (`uri` / `name` / `mimeType`).
    private func copyToAppGroup(_ url: URL) -> [String: Any]? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else { return nil }

        let name = url.lastPathComponent
        let dest = container.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)
        do {
            try FileManager.default.copyItem(at: url, to: dest)
        } catch {
            return nil
        }

        let mime = url.pathExtension.lowercased() == "met"
            ? "application/octet-stream"
            : "application/json"
        return ["uri": dest.absoluteString, "name": name, "mimeType": mime]
    }

    private func persist(texts: [String], files: [[String: Any]]) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
        defaults.set(
            ["title": "", "texts": texts, "files": files] as [String: Any],
            forKey: sharedDataKey
        )
        defaults.synchronize()
    }

    /// Foreground the host app. Share extensions can't touch
    /// `UIApplication.shared`, so walk the responder chain for `openURL:`.
    private func openHostApp() {
        guard let url = URL(string: urlScheme) else { return }
        let selector = sel_registerName("openURL:")
        var responder: UIResponder? = self
        while let current = responder {
            if current.responds(to: selector), current !== self {
                _ = current.perform(selector, with: url)
                return
            }
            responder = current.next
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
