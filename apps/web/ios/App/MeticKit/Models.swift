import Foundation

/// A favourite profile, mirrored from the web app into the shared App Group.
public struct Favourite: Codable, Identifiable, Hashable {
    public let id: String
    public let name: String
    /// Target temperature (°C) captured when favourited, when known.
    public var targetTempC: Double?
    /// Target/final weight (g) captured when favourited, when known.
    public var targetWeightG: Double?
    /// Filename of the cached image inside the App Group container, when present.
    public var imageFilename: String?

    public init(
        id: String,
        name: String,
        targetTempC: Double? = nil,
        targetWeightG: Double? = nil,
        imageFilename: String? = nil
    ) {
        self.id = id
        self.name = name
        self.targetTempC = targetTempC
        self.targetWeightG = targetWeightG
        self.imageFilename = imageFilename
    }
}

/// A one-shot snapshot of the machine's live state, read on demand.
public struct MachineSnapshot: Codable, Equatable {
    public let state: MachineState
    public let loadedProfileName: String?
    public let currentTempC: Double?
    public let targetTempC: Double?
    public let currentWeightG: Double?
    public let targetWeightG: Double?

    public init(
        state: MachineState,
        loadedProfileName: String?,
        currentTempC: Double?,
        targetTempC: Double?,
        currentWeightG: Double?,
        targetWeightG: Double?
    ) {
        self.state = state
        self.loadedProfileName = loadedProfileName
        self.currentTempC = currentTempC
        self.targetTempC = targetTempC
        self.currentWeightG = currentWeightG
        self.targetWeightG = targetWeightG
    }
}

/// Normalised machine state, mirroring the web app's badge mapping so the
/// widget and the app agree on what to display. Brewing is driven by the
/// machine's `extracting` flag (not the state string), exactly like the app.
public enum MachineState: String, Codable {
    case idle
    case heating
    case preheating
    case ready
    case brewing
    case steaming
    case purging
    case descaling
    case pourWater
    case unknown

    /// Map the machine's raw `name`/`state` string (and `extracting` flag) to a
    /// normalised case, matching the app's derivation.
    public init(raw: String?, extracting: Bool = false) {
        if extracting { self = .brewing; return }
        let s = (raw ?? "").lowercased()
        if s.hasPrefix("pour water") { self = .pourWater; return }
        if s.hasPrefix("click to purge") { self = .purging; return }
        switch s {
        case "idle", "": self = .idle
        case "heating", "warming": self = .heating
        case "preheating": self = .preheating
        case "ready", "click to start", "idle_ready": self = .ready
        case "steaming": self = .steaming
        case "purging": self = .purging
        case "descaling": self = .descaling
        case "brewing", "extracting", "espresso": self = .brewing
        default: self = .unknown
        }
    }

    public var isBrewing: Bool { self == .brewing }

    /// Display label mirroring the app's state badge.
    public var label: String {
        switch self {
        case .idle: return "Idle"
        case .heating: return "Heating"
        case .preheating: return "Preheating"
        case .ready: return "Ready"
        case .brewing: return "Brewing"
        case .steaming: return "Steaming"
        case .purging: return "Purging"
        case .descaling: return "Descaling"
        case .pourWater: return "Pour water"
        case .unknown: return "—"
        }
    }
}

/// Machine control actions exposed by the Control Center widget.
public enum MachineAction: String {
    case start
    case stop
    case preheat
    case tare
}

/// Transient feedback for the last control the user tapped, surfaced by the
/// Control Center widget as a banner + button highlight.
public struct ActionFeedback: Equatable {
    public enum Kind: String {
        case start, preheat, tare, stop, error
    }
    public let kind: Kind
    public let message: String?
    public let at: Date

    public init(kind: Kind, message: String? = nil, at: Date) {
        self.kind = kind
        self.message = message
        self.at = at
    }

    /// Whether this feedback is still within its display window.
    public func isFresh(now: Date = Date(), window: TimeInterval = 2.5) -> Bool {
        now.timeIntervalSince(at) < window && now.timeIntervalSince(at) >= 0
    }
}
