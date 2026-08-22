import ActivityKit
import WidgetKit
import SwiftUI

private let readyGreen = Color(red: 0.20, green: 0.70, blue: 0.32)
private let brandOrange = Color(red: 0.843, green: 0.443, blue: 0)

struct ShotLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShotActivityAttributes.self) { context in
            ShotLockScreenView(attributes: context.attributes, state: context.state)
                .padding(14)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            shotDynamicIsland(context)
        }
    }
}

struct ShotLockScreenView: View {
    let attributes: ShotActivityAttributes
    let state: ShotActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(attributes.profileName).font(.headline).lineLimit(1)
                Spacer()
                Circle().fill(brandOrange).frame(width: 8, height: 8)
            }
            switch state.phase {
            case .heating: heating
            case .ready: ready
            case .extracting: extracting
            case .done: done
            }
        }
        .foregroundStyle(.white)
    }

    private var heating: some View {
        VStack(alignment: .leading, spacing: 8) {
            heatBar(label: "Brew Chamber", temp: state.chamberTempC)
            heatBar(label: "Brew Head", temp: state.headTempC)
        }
    }

    private func heatBar(label: String, temp: Double?) -> some View {
        let set = attributes.setTempC ?? 93
        let cutoff = attributes.readyCutoffC ?? (set - 1.5)
        let value = temp ?? 0
        let reached = value >= cutoff
        let progress = max(0, min(1, value / set))
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(.caption2)
                Spacer()
                Text(String(format: "%.0f°/%.0f°", value, set)).font(.caption2).monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.18))
                    Capsule().fill(reached ? readyGreen : brandOrange)
                        .frame(width: geo.size.width * progress)
                }
            }.frame(height: 6)
        }
    }

    private var ready: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Ready").font(.title3.bold()).foregroundStyle(readyGreen)
                Text(String(format: "%.0f°C", state.headTempC ?? attributes.setTempC ?? 0))
                    .font(.caption).monospacedDigit()
            }
            Spacer()
            Button(intent: StartShotIntent()) {
                Text("Start").font(.subheadline.bold())
            }
            .tint(brandOrange)
            .buttonStyle(.borderedProminent)
        }
    }

    private var extracting: some View {
        VStack(alignment: .leading, spacing: 8) {
            ShotSparkline(samples: state.graph).frame(height: 42)
            HStack(spacing: 14) {
                tile("Weight", ShotGlanceable.text(.weight,
                    current: state.currentWeightG, target: attributes.targetWeightG))
                tile("Pressure", String(format: "%.1f", state.pressureBar ?? 0))
                tile("Flow", String(format: "%.1f", state.flowGs ?? 0))
                if let e = state.elapsedSec { tile("Time", String(format: "%.0fs", e)) }
            }
        }
    }

    private var done: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Shot complete").font(.subheadline.bold())
            HStack(spacing: 14) {
                if let w = state.finalWeightG { tile("Weight", String(format: "%.1fg", w)) }
                if let t = state.finalTimeSec { tile("Time", String(format: "%.0fs", t)) }
                if let r = state.ratio { tile("Ratio", String(format: "1:%.1f", r)) }
                if let a = state.avgTempC { tile("Avg Temp", String(format: "%.0f°", a)) }
            }
        }
    }

    private func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.white.opacity(0.7))
            Text(value).font(.caption.bold()).monospacedDigit()
        }
    }
}

/// A lightweight 3-series sparkline (pressure/flow/weight), each normalised
/// independently to fill the available height.
struct ShotSparkline: View {
    let samples: [ShotGraphSample]

    var body: some View {
        GeometryReader { geo in
            ZStack {
                line(geo, \.p, .orange)
                line(geo, \.f, .cyan)
                line(geo, \.w, readyGreen)
            }
        }
    }

    private func line(_ geo: GeometryProxy, _ key: KeyPath<ShotGraphSample, Double>, _ color: Color) -> some View {
        let vals = samples.map { $0[keyPath: key] }
        let maxV = max(vals.max() ?? 1, 0.0001)
        let n = max(samples.count - 1, 1)
        return Path { path in
            for (i, v) in vals.enumerated() {
                let x = geo.size.width * CGFloat(i) / CGFloat(n)
                let y = geo.size.height * (1 - CGFloat(v / maxV))
                if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                else { path.addLine(to: CGPoint(x: x, y: y)) }
            }
        }
        .stroke(color, lineWidth: 1.5)
    }
}

// TEMP stub — replaced in Task 12.
func shotDynamicIsland(_ context: ActivityViewContext<ShotActivityAttributes>) -> DynamicIsland {
    DynamicIsland {
        DynamicIslandExpandedRegion(.center) { Text("Metic") }
    } compactLeading: { Text("•") } compactTrailing: { Text("") } minimal: { Text("•") }
}
