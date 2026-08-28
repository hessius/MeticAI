import ActivityKit
import WidgetKit
import SwiftUI

private let readyGreen = Color(red: 0.20, green: 0.70, blue: 0.32)
private let brandOrange = Color(red: 0.843, green: 0.443, blue: 0)
private let flowCyan = Color(red: 0.29, green: 0.78, blue: 0.90)

struct ShotLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShotActivityAttributes.self) { context in
            ShotLockScreenView(attributes: context.attributes, state: context.state, isStale: context.isStale)
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
    var isStale: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(attributes.profileName).font(.headline).lineLimit(1)
                Spacer(minLength: 8)
                meticWordmark(baseSize: 11)
            }
            switch state.phase {
            case .heating: heating
            case .ready: ready
            case .extracting: extracting
            case .done: done
            }
            if isStale {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.clockwise").font(.caption2)
                    Text(attributes.strings.resumeHint).font(.caption2)
                }
                .foregroundStyle(.white.opacity(0.6))
            }
        }
        .foregroundStyle(.white)
    }

    private var heating: some View {
        VStack(alignment: .leading, spacing: 8) {
            heatBar(label: attributes.strings.brewChamber, temp: state.chamberTempC)
            heatBar(label: attributes.strings.brewHead, temp: state.headTempC)
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
                Text(attributes.strings.ready).font(.title3.bold()).foregroundStyle(readyGreen)
                Text(String(format: "%.0f°C", state.headTempC ?? attributes.setTempC ?? 0))
                    .font(.caption).monospacedDigit()
            }
            Spacer()
            Button(intent: StartShotIntent()) {
                Text(attributes.strings.start).font(.subheadline.bold())
            }
            .tint(brandOrange)
            .buttonStyle(.borderedProminent)
        }
    }

    private var extracting: some View {
        VStack(alignment: .leading, spacing: 8) {
            ShotChart(samples: state.graph, targetWeightG: attributes.targetWeightG).frame(height: 46)
            HStack(spacing: 14) {
                tile(attributes.strings.weight, ShotGlanceable.text(.weight,
                    current: state.currentWeightG, target: attributes.targetWeightG), dot: readyGreen)
                tile(attributes.strings.pressure, String(format: "%.1f", state.pressureBar ?? 0), dot: brandOrange)
                tile(attributes.strings.flow, String(format: "%.1f", state.flowGs ?? 0), dot: flowCyan)
                if let e = state.elapsedSec { tile(attributes.strings.time, String(format: "%.0fs", e)) }
            }
        }
    }

    private var done: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(attributes.strings.shotComplete).font(.subheadline.bold())
            HStack(spacing: 14) {
                if let w = state.finalWeightG { tile(attributes.strings.weight, String(format: "%.1fg", w)) }
                if let t = state.finalTimeSec { tile(attributes.strings.time, String(format: "%.0fs", t)) }
                if let r = state.ratio { tile(attributes.strings.ratio, String(format: "1:%.1f", r)) }
                if let a = state.avgTempC { tile(attributes.strings.avgTemp, String(format: "%.0f°", a)) }
            }
        }
    }

    private func tile(_ label: String, _ value: String, dot: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 3) {
                if let dot { Circle().fill(dot).frame(width: 5, height: 5) }
                Text(label).font(.caption2).foregroundStyle(.white.opacity(0.7))
            }
            Text(value).font(.caption.bold()).monospacedDigit()
        }
    }
}

/// A fixed-scale extraction mini-chart: pressure (orange) and flow (cyan) share a
/// labelled y-axis so their heights are comparable, while weight (green) rides its
/// own scale as a trend line. Y-axis labels + gridlines make the plot readable.
struct ShotChart: View {
    let samples: [ShotGraphSample]
    let targetWeightG: Double?

    var body: some View {
        let scale = ShotChartScale(samples: samples, targetWeightG: targetWeightG)
        HStack(spacing: 4) {
            VStack(alignment: .trailing, spacing: 0) {
                axisLabel(scale.axisTop)
                Spacer(minLength: 0)
                axisLabel(scale.axisMid)
                Spacer(minLength: 0)
                axisLabel("0")
            }
            .frame(width: 14)
            ZStack {
                ChartGrid()
                ChartLine(samples: samples, value: { scale.normP($0.p) }, color: brandOrange)
                ChartLine(samples: samples, value: { scale.normF($0.f) }, color: flowCyan)
                ChartLine(samples: samples, value: { scale.normW($0.w) }, color: readyGreen)
            }
        }
    }

    private func axisLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 7))
            .monospacedDigit()
            .foregroundStyle(.white.opacity(0.45))
    }
}

/// Horizontal gridlines at 0 / 0.5 / 1.0 of the plot height.
struct ChartGrid: View {
    var body: some View {
        GeometryReader { geo in
            Path { path in
                for frac in [0.0, 0.5, 1.0] {
                    let y = geo.size.height * CGFloat(frac)
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: geo.size.width, y: y))
                }
            }
            .stroke(.white.opacity(0.12), lineWidth: 0.5)
        }
    }
}

/// A single series plotted against a pre-normalised (0…1) value closure.
struct ChartLine: View {
    let samples: [ShotGraphSample]
    let value: (ShotGraphSample) -> Double
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let n = max(samples.count - 1, 1)
            Path { path in
                for (i, s) in samples.enumerated() {
                    let x = geo.size.width * CGFloat(i) / CGFloat(n)
                    let y = geo.size.height * CGFloat(1 - value(s))
                    if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                    else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(color, lineWidth: 1.5)
        }
    }
}
