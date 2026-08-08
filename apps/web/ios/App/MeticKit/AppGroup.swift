import Foundation

/// Shared App Group constants and the paths/keys used to exchange data between
/// the app (writer) and the widget extension (reader).
public enum AppGroup {
    public static let identifier = "group.com.metic.app"
    public static let schemaVersion = 1

    public enum Keys {
        public static let favourites = "favourites"
        public static let machineURL = "machineUrl"
        public static let openAppOnStart = "openAppOnStart"
        public static let schemaVersion = "schemaVersion"
    }

    public static var defaults: UserDefaults? {
        UserDefaults(suiteName: identifier)
    }

    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }
}

/// Read-only accessor over the App Group data, used by the widget extension.
public struct AppGroupStore {
    private let defaults: UserDefaults?
    private let containerURL: URL?

    public init(
        defaults: UserDefaults? = AppGroup.defaults,
        containerURL: URL? = AppGroup.containerURL
    ) {
        self.defaults = defaults
        self.containerURL = containerURL
    }

    public func favourites() -> [Favourite] {
        guard let data = defaults?.data(forKey: AppGroup.Keys.favourites) else { return [] }
        return (try? JSONDecoder().decode([Favourite].self, from: data)) ?? []
    }

    public func machineURL() -> URL? {
        guard let s = defaults?.string(forKey: AppGroup.Keys.machineURL), !s.isEmpty else { return nil }
        return URL(string: s)
    }

    public func openAppOnStart() -> Bool {
        defaults?.bool(forKey: AppGroup.Keys.openAppOnStart) ?? false
    }

    /// Whether the data written by the app matches the schema this build reads.
    public func isSchemaCompatible() -> Bool {
        let v = defaults?.integer(forKey: AppGroup.Keys.schemaVersion) ?? 0
        // Treat "never written" (0) as compatible-but-empty so the widget can
        // still render its empty state without a scary mismatch message.
        return v == 0 || v == AppGroup.schemaVersion
    }

    public func imageURL(for favourite: Favourite) -> URL? {
        guard let filename = favourite.imageFilename, !filename.isEmpty,
              let container = containerURL else { return nil }
        return container.appendingPathComponent("favourites/\(filename)")
    }
}
