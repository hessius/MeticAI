import Foundation

/// Accumulates raw graph samples and downsamples to at most `maxPoints`,
/// always retaining the first and last sample. Keeps the encoded
/// `ContentState` comfortably under ActivityKit's ~4 KB budget.
public struct ShotGraphBuffer {
    private var samples: [ShotGraphSample] = []
    private let maxPoints: Int

    public init(maxPoints: Int = 30) {
        self.maxPoints = max(2, maxPoints)
    }

    public mutating func append(t: Double, p: Double, f: Double, w: Double) {
        samples.append(ShotGraphSample(
            t: (t * 100).rounded() / 100,
            p: (p * 100).rounded() / 100,
            f: (f * 100).rounded() / 100,
            w: (w * 100).rounded() / 100
        ))
    }

    public var count: Int { samples.count }

    /// Uniformly stride the samples down to `maxPoints`, preserving endpoints.
    public func downsampled() -> [ShotGraphSample] {
        guard samples.count > maxPoints else { return samples }
        var out: [ShotGraphSample] = []
        let step = Double(samples.count - 1) / Double(maxPoints - 1)
        for i in 0..<maxPoints {
            out.append(samples[Int((Double(i) * step).rounded())])
        }
        return out
    }
}
