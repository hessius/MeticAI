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
public struct MachineSnapshot: Equatable {
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

/// Normalised machine state derived from the raw Socket.IO `status.state` field.
public enum MachineState: String {
    case idle
    case heating
    case ready
    case brewing
    case unknown

    /// Map the machine's raw state strings to a normalised case.
    public init(raw: String?) {
        switch (raw ?? "").lowercased() {
        case "idle": self = .idle
        case "heating", "preheating", "warming": self = .heating
        case "ready", "idle_ready": self = .ready
        case "brewing", "extracting", "espresso", "pour", "preinfusion": self = .brewing
        default: self = .unknown
        }
    }

    public var isBrewing: Bool { self == .brewing }
}

/// Machine control actions exposed by the Control Center widget.
public enum MachineAction: String {
    case start
    case stop
    case preheat
    case tare
}
