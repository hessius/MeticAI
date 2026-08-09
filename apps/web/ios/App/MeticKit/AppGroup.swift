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

        // Control Center live snapshot overlay.
        public static let snapshotJSON = "snapshotJSON"
        public static let snapshotShownUntil = "snapshotShownUntil"

        // Control Center action feedback (banner + button highlight).
        public static let lastAction = "lastAction"
        public static let lastActionAt = "lastActionAt"
        public static let lastActionMessage = "lastActionMessage"
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

    // MARK: - Control Center live state

    /// The stored snapshot, if one is currently within its display window.
    public func activeSnapshot(now: Date = Date()) -> MachineSnapshot? {
        let until = defaults?.double(forKey: AppGroup.Keys.snapshotShownUntil) ?? 0
        guard until > now.timeIntervalSince1970,
              let data = defaults?.data(forKey: AppGroup.Keys.snapshotJSON) else { return nil }
        return try? JSONDecoder().decode(MachineSnapshot.self, from: data)
    }

    /// When the current snapshot overlay should stop being shown.
    public func snapshotShownUntil() -> Date? {
        let t = defaults?.double(forKey: AppGroup.Keys.snapshotShownUntil) ?? 0
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    /// The last control action feedback, if any (regardless of freshness).
    public func lastActionFeedback() -> ActionFeedback? {
        guard let raw = defaults?.string(forKey: AppGroup.Keys.lastAction),
              let kind = ActionFeedback.Kind(rawValue: raw) else { return nil }
        let at = defaults?.double(forKey: AppGroup.Keys.lastActionAt) ?? 0
        guard at > 0 else { return nil }
        let message = defaults?.string(forKey: AppGroup.Keys.lastActionMessage)
        return ActionFeedback(kind: kind, message: message, at: Date(timeIntervalSince1970: at))
    }
}

/// Write access over the App Group state, used by the widget App Intents (the
/// app writes favourites/URL via the Capacitor bridge; intents write the
/// transient snapshot + action-feedback state read back by the timeline).
public struct AppGroupWriter {
    private let defaults: UserDefaults?

    public init(defaults: UserDefaults? = AppGroup.defaults) {
        self.defaults = defaults
    }

    /// Store a fresh snapshot to overlay for `seconds`, starting now.
    public func showSnapshot(_ snapshot: MachineSnapshot, for seconds: TimeInterval, now: Date = Date()) {
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults?.set(data, forKey: AppGroup.Keys.snapshotJSON)
            defaults?.set(now.timeIntervalSince1970 + seconds, forKey: AppGroup.Keys.snapshotShownUntil)
        }
    }

    /// Immediately dismiss any snapshot overlay (tap-to-dismiss).
    public func clearSnapshot() {
        defaults?.set(0, forKey: AppGroup.Keys.snapshotShownUntil)
        defaults?.removeObject(forKey: AppGroup.Keys.snapshotJSON)
    }

    /// Record feedback for the control the user just tapped.
    public func recordAction(_ kind: ActionFeedback.Kind, message: String? = nil, now: Date = Date()) {
        defaults?.set(kind.rawValue, forKey: AppGroup.Keys.lastAction)
        defaults?.set(now.timeIntervalSince1970, forKey: AppGroup.Keys.lastActionAt)
        if let message {
            defaults?.set(message, forKey: AppGroup.Keys.lastActionMessage)
        } else {
            defaults?.removeObject(forKey: AppGroup.Keys.lastActionMessage)
        }
    }
}
