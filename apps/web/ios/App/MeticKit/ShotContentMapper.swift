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

    /// Merge a machine `temperatures` frame (heating two-stage bars).
    public mutating func applyTemperatures(_ temps: [String: Any]) {
        if let d = (temps["t_bar_down"] as? NSNumber)?.doubleValue { chamberTempC = d }
        if let u = (temps["t_bar_up"] as? NSNumber)?.doubleValue { headTempC = u }
    }

    static func phase(for state: MachineState) -> ShotPhase {
        switch state {
        case .brewing: return .extracting
        case .ready: return .ready
        default: return .heating
        }
    }
}
