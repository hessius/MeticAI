import Foundation

/// A single decoded telemetry frame from the machine's Socket.IO `status`
/// (optionally merged with a `temperatures` frame). Pure value type.
public struct ShotFrame {
    public var phase: ShotPhase
    public var pressureBar: Double?
    public var flowGs: Double?
    public var weightG: Double?
    public var brewTempC: Double?
    public var chamberTempC: Double?
    public var headTempC: Double?
    public var elapsedSec: Double?

    /// Build a bare frame for a known phase (used to render heating temps before
    /// any `status` frame has arrived).
    public init(phase: ShotPhase) {
        self.phase = phase
    }

    public init?(status: [String: Any]) {
        let rawState = (status["name"] as? String) ?? (status["state"] as? String)
        let extracting = (status["extracting"] as? NSNumber)?.boolValue
            ?? (status["extracting"] as? Bool) ?? false
        let machineState = MachineState(raw: rawState, extracting: extracting)
        self.phase = ShotFrame.phase(for: machineState)
        let sensors = status["sensors"] as? [String: Any]
        self.pressureBar = (sensors?["p"] as? NSNumber)?.doubleValue
        self.flowGs = (sensors?["f"] as? NSNumber)?.doubleValue
        self.weightG = (sensors?["w"] as? NSNumber)?.doubleValue
        self.brewTempC = (sensors?["t"] as? NSNumber)?.doubleValue
        if let ms = (status["time"] as? NSNumber)?.doubleValue {
            self.elapsedSec = ms / 1000.0
        }
    }

    /// Merge a machine `sensors`/`temperatures` frame (heating two-stage bars).
    /// Field mapping matches the in-app live view: `t_bar_up` is the boiler /
    /// "Brew Chamber" and `t_bar_down` is the "Brew Head" thermocouple.
    public mutating func applyTemperatures(_ temps: [String: Any]) {
        if let u = (temps["t_bar_up"] as? NSNumber)?.doubleValue { chamberTempC = u }
        if let d = (temps["t_bar_down"] as? NSNumber)?.doubleValue { headTempC = d }
    }

    static func phase(for state: MachineState) -> ShotPhase {
        switch state {
        case .brewing: return .extracting
        case .ready: return .ready
        default: return .heating
        }
    }
}

public enum ShotContentBuilder {
    public struct Summary {
        public let finalWeightG: Double?
        public let finalTimeSec: Double?
        public let ratio: Double?
        public let avgTempC: Double?
    }

    /// Build a live `ContentState` for the current phase.
    public static func state(
        from frame: ShotFrame,
        graph: ShotGraphBuffer,
        doseG: Double?,
        tempSamples: [Double]
    ) -> ShotActivityAttributes.ContentState {
        ShotActivityAttributes.ContentState(
            phase: frame.phase,
            chamberTempC: frame.chamberTempC,
            headTempC: frame.headTempC,
            brewTempC: frame.brewTempC,
            currentWeightG: frame.weightG,
            pressureBar: frame.pressureBar,
            flowGs: frame.flowGs,
            elapsedSec: frame.elapsedSec,
            graph: graph.downsampled()
        )
    }

    /// Compute the terminal summary. Ratio/avg omitted when inputs are missing.
    public static func summary(
        finalWeightG: Double?,
        finalTimeSec: Double?,
        doseG: Double?,
        tempSamples: [Double]
    ) -> Summary {
        var ratio: Double?
        if let w = finalWeightG, let d = doseG, d > 0 { ratio = w / d }
        var avg: Double?
        if !tempSamples.isEmpty {
            avg = tempSamples.reduce(0, +) / Double(tempSamples.count)
        }
        return Summary(finalWeightG: finalWeightG, finalTimeSec: finalTimeSec,
                       ratio: ratio, avgTempC: avg)
    }
}
