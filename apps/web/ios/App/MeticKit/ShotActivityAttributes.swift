import Foundation
import ActivityKit

/// Which single stat is surfaced as the Dynamic Island / compact glanceable.
public enum ShotGlanceableStat: String, Codable, CaseIterable {
    case weight, pressure, flow, temp
}

/// What the heating-phase glanceable shows.
public enum HeatingGlanceableStat: String, Codable, CaseIterable {
    case temp, estimatedTime
}

/// Lifecycle phase of the shot Live Activity.
public enum ShotPhase: String, Codable {
    case heating, ready, extracting, done
}

/// User-facing widget labels, localised in the web layer (react-i18next) and
/// passed in at start so the native widget matches the app's language. Defaults
/// are English fallbacks for safety / decoding older activities.
public struct ShotLocalizedStrings: Codable, Hashable {
    public var brewChamber: String
    public var brewHead: String
    public var ready: String
    public var start: String
    public var weight: String
    public var pressure: String
    public var flow: String
    public var time: String
    public var shotComplete: String
    public var ratio: String
    public var avgTemp: String
    public var done: String
    public var resumeHint: String

    public init(
        brewChamber: String = "Brew Chamber",
        brewHead: String = "Brew Head",
        ready: String = "Ready",
        start: String = "Start",
        weight: String = "Weight",
        pressure: String = "Pressure",
        flow: String = "Flow",
        time: String = "Time",
        shotComplete: String = "Shot complete",
        ratio: String = "Ratio",
        avgTemp: String = "Avg Temp",
        done: String = "Done",
        resumeHint: String = "Open Metic to resume live updates"
    ) {
        self.brewChamber = brewChamber
        self.brewHead = brewHead
        self.ready = ready
        self.start = start
        self.weight = weight
        self.pressure = pressure
        self.flow = flow
        self.time = time
        self.shotComplete = shotComplete
        self.ratio = ratio
        self.avgTemp = avgTemp
        self.done = done
        self.resumeHint = resumeHint
    }
}

/// A single downsampled graph sample (pressure/flow/weight) at an elapsed time.
public struct ShotGraphSample: Codable, Hashable {
    public let t: Double   // seconds since extraction start
    public let p: Double   // pressure (bar)
    public let f: Double   // flow (g/s)
    public let w: Double   // weight (g)
    public init(t: Double, p: Double, f: Double, w: Double) {
        self.t = t; self.p = p; self.f = f; self.w = w
    }
}

/// Fixed-scale mapping for the extraction mini-chart. Pressure and flow share a
/// single "nice" y-axis (both are single-digit espresso values) so their plotted
/// heights are directly comparable and the axis labels are meaningful; weight
/// rides its own 0…max scale (it climbs to tens of grams) and is read purely as
/// a trend line. Pure value type so it can be unit-tested without a view.
public struct ShotChartScale {
    /// Shared maximum for the pressure/flow axis (bar · g/s), a friendly even number.
    public let axisMax: Double
    /// Maximum for the weight trend line (grams).
    public let weightMax: Double

    public init(samples: [ShotGraphSample], targetWeightG: Double?) {
        let maxPF = samples.reduce(0.0) { Swift.max($0, Swift.max($1.p, $1.f)) }
        self.axisMax = ShotChartScale.niceCeil(maxPF)
        let maxW = samples.reduce(0.0) { Swift.max($0, $1.w) }
        self.weightMax = Swift.max(targetWeightG ?? 0, maxW, 1)
    }

    /// Round up to a friendly even number (minimum 2): 8.9 → 10, 2.5 → 4, 11.2 → 12.
    public static func niceCeil(_ v: Double) -> Double {
        guard v > 0 else { return 2 }
        return (v / 2).rounded(.up) * 2
    }

    public func normP(_ v: Double) -> Double { axisMax > 0 ? min(1, max(0, v / axisMax)) : 0 }
    public func normF(_ v: Double) -> Double { axisMax > 0 ? min(1, max(0, v / axisMax)) : 0 }
    public func normW(_ v: Double) -> Double { weightMax > 0 ? min(1, max(0, v / weightMax)) : 0 }

    /// Top gridline label (the axis maximum).
    public var axisTop: String { ShotChartScale.label(axisMax) }
    /// Middle gridline label (half the axis maximum).
    public var axisMid: String { ShotChartScale.label(axisMax / 2) }

    static func label(_ v: Double) -> String {
        v == v.rounded() ? String(format: "%.0f", v) : String(format: "%.1f", v)
    }
}

public struct ShotActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var phase: ShotPhase
        public var chamberTempC: Double?
        public var headTempC: Double?
        public var brewTempC: Double?
        public var currentWeightG: Double?
        public var pressureBar: Double?
        public var flowGs: Double?
        public var elapsedSec: Double?
        public var etaSec: Double?
        public var graph: [ShotGraphSample]
        // Summary (populated only in `.done`).
        public var finalWeightG: Double?
        public var finalTimeSec: Double?
        public var ratio: Double?
        public var avgTempC: Double?

        public init(
            phase: ShotPhase,
            chamberTempC: Double? = nil,
            headTempC: Double? = nil,
            brewTempC: Double? = nil,
            currentWeightG: Double? = nil,
            pressureBar: Double? = nil,
            flowGs: Double? = nil,
            elapsedSec: Double? = nil,
            etaSec: Double? = nil,
            graph: [ShotGraphSample] = [],
            finalWeightG: Double? = nil,
            finalTimeSec: Double? = nil,
            ratio: Double? = nil,
            avgTempC: Double? = nil
        ) {
            self.phase = phase
            self.chamberTempC = chamberTempC
            self.headTempC = headTempC
            self.brewTempC = brewTempC
            self.currentWeightG = currentWeightG
            self.pressureBar = pressureBar
            self.flowGs = flowGs
            self.elapsedSec = elapsedSec
            self.etaSec = etaSec
            self.graph = graph
            self.finalWeightG = finalWeightG
            self.finalTimeSec = finalTimeSec
            self.ratio = ratio
            self.avgTempC = avgTempC
        }
    }

    // Static attributes (fixed for the activity's life).
    public let profileName: String
    public let targetWeightG: Double?
    public let setTempC: Double?
    public let readyCutoffC: Double?
    public let shotGlanceable: ShotGlanceableStat
    public let heatingGlanceable: HeatingGlanceableStat
    public let strings: ShotLocalizedStrings

    public init(
        profileName: String,
        targetWeightG: Double?,
        setTempC: Double?,
        readyCutoffC: Double?,
        shotGlanceable: ShotGlanceableStat,
        heatingGlanceable: HeatingGlanceableStat,
        strings: ShotLocalizedStrings = ShotLocalizedStrings()
    ) {
        self.profileName = profileName
        self.targetWeightG = targetWeightG
        self.setTempC = setTempC
        self.readyCutoffC = readyCutoffC
        self.shotGlanceable = shotGlanceable
        self.heatingGlanceable = heatingGlanceable
        self.strings = strings
    }
}
