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
            if self.openHostApp() {
                // Give the app-switch a beat to dispatch before we tear the
                // extension down — completing too early can cancel it.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                    self?.finish()
                }
            } else {
                // Couldn't foreground the app automatically. The share is
                // already persisted to the App Group, so tell the user how to
                // finish and offer a button to try opening the app themselves.
                self.presentManualOpenUI()
            }
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

    /// Foreground the host app by opening `metic://share`. Share extensions
    /// can't touch `UIApplication.shared`, so walk the responder chain to the
    /// `UIApplication` instance and call its (deprecated) `openURL:`. Returns
    /// whether the app was asked to open.
    @discardableResult
    private func openHostApp() -> Bool {
        guard let url = URL(string: urlScheme) else { return false }
        let selector = sel_registerName("openURL:")
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication, application.responds(to: selector) {
                _ = application.perform(selector, with: url)
                return true
            }
            responder = current.next
        }
        return false
    }

    /// Fallback shown when the extension can't foreground the host app on its
    /// own. The share is already persisted, so the app will pick it up on next
    /// launch; this just makes that obvious and offers a one-tap open.
    private func presentManualOpenUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 16
        card.clipsToBounds = true
        view.addSubview(card)

        let title = UILabel()
        title.text = "Almost there"
        title.font = .preferredFont(forTextStyle: .headline)
        title.textAlignment = .center
        title.numberOfLines = 0

        let body = UILabel()
        body.text = "Open Metic to finish importing this profile."
        body.font = .preferredFont(forTextStyle: .subheadline)
        body.textColor = .secondaryLabel
        body.textAlignment = .center
        body.numberOfLines = 0

        let openButton = UIButton(type: .system)
        openButton.setTitle("Open Metic", for: .normal)
        openButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        openButton.addTarget(self, action: #selector(handleOpenTapped), for: .touchUpInside)

        let dismissButton = UIButton(type: .system)
        dismissButton.setTitle("Done", for: .normal)
        dismissButton.addTarget(self, action: #selector(handleDismissTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, body, openButton, dismissButton])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 12
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 24, left: 20, bottom: 20, right: 20)
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            stack.topAnchor.constraint(equalTo: card.topAnchor),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
        ])
    }

    @objc private func handleOpenTapped() {
        openHostApp()
        finish()
    }

    @objc private func handleDismissTapped() {
        finish()
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
