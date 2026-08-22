import Foundation

/// Swift port of `estimateTimeToReady.ts` — a Newtonian (exponential-approach)
/// heating model with a fixed rate constant calibrated to observed behaviour.
/// Returns nil for degenerate inputs, 0 when already at/above cutoff.
public func estimateTimeToReady(
    current: Double,
    target: Double,
    cutoff: Double,
    ambient: Double = 20,
    coldStartSeconds: Double = 210,
    maxSeconds: Double = 900
) -> Double? {
    guard current.isFinite, target.isFinite, cutoff.isFinite else { return nil }
    if target <= cutoff { return 0 }
    if current >= cutoff { return 0 }

    let readyGap = target - cutoff
    let coldGap = target - ambient
    if coldGap <= readyGap { return 0 }

    let k = log(coldGap / readyGap) / coldStartSeconds
    guard k.isFinite, k > 0 else { return nil }

    let currentGap = target - current
    if currentGap <= readyGap { return 0 }

    let remaining = log(currentGap / readyGap) / k
    guard remaining.isFinite else { return nil }
    if remaining <= 0 { return 0 }
    return min(remaining, maxSeconds)
}

public enum ShotGlanceable {
    /// Format a glanceable stat value (extraction phase).
    public static func text(_ stat: ShotGlanceableStat, current: Double?, target: Double?) -> String {
        switch stat {
        case .weight:
            let c = Int((current ?? 0).rounded())
            if let target { return "\(c)/\(Int(target.rounded()))g" }
            return "\(c)g"
        case .pressure:
            return String(format: "%.1f bar", current ?? 0)
        case .flow:
            return String(format: "%.1f g/s", current ?? 0)
        case .temp:
            return String(format: "%.0f°C", current ?? 0)
        }
    }

    /// Format an ETA in seconds as `~M:SS`.
    public static func formatETA(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "~%d:%02d", total / 60, total % 60)
    }
}
