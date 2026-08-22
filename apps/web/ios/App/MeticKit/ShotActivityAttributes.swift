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

    public init(
        profileName: String,
        targetWeightG: Double?,
        setTempC: Double?,
        readyCutoffC: Double?,
        shotGlanceable: ShotGlanceableStat,
        heatingGlanceable: HeatingGlanceableStat
    ) {
        self.profileName = profileName
        self.targetWeightG = targetWeightG
        self.setTempC = setTempC
        self.readyCutoffC = readyCutoffC
        self.shotGlanceable = shotGlanceable
        self.heatingGlanceable = heatingGlanceable
    }
}
