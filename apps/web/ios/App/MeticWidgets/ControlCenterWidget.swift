import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Timeline

/// How long a control-action confirmation banner stays visible.
private let feedbackWindow: TimeInterval = 2.5

struct ControlEntry: TimelineEntry {
    let date: Date
    let favourites: [Favourite]
    let openAppOnStart: Bool
    /// Snapshot overlay to render, or nil for the plain control face.
    let snapshot: MachineSnapshot?
    /// Fresh action confirmation (banner + button highlight), or nil.
    let feedback: ActionFeedback?
}

struct ControlProvider: TimelineProvider {
    func placeholder(in context: Context) -> ControlEntry {
        ControlEntry(date: .now, favourites: [], openAppOnStart: false, snapshot: nil, feedback: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ControlEntry) -> Void) {
        completion(entry(at: .now, store: AppGroupStore()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ControlEntry>) -> Void) {
        let store = AppGroupStore()
        let now = Date()

        // The intents own all machine I/O and write snapshot/feedback state to
        // the App Group, then reload us. We only read that state here, so the
        // overlay lifecycle is driven purely by `snapshotShownUntil` — stable
        // across arbitrary reloads (this fixes the flashing).
        var entries = [entry(at: now, store: store)]

        var boundaries: [Date] = []
        if let until = store.snapshotShownUntil(), until > now { boundaries.append(until) }
        if let fb = store.lastActionFeedback() {
            let end = fb.at.addingTimeInterval(feedbackWindow)
            if end > now { boundaries.append(end) }
        }
        for date in boundaries.sorted() {
            entries.append(entry(at: date, store: store))
        }

        completion(Timeline(entries: entries, policy: .never))
    }

    private func entry(at date: Date, store: AppGroupStore) -> ControlEntry {
        let fb = store.lastActionFeedback()
        let freshFb = (fb?.isFresh(now: date, window: feedbackWindow) ?? false) ? fb : nil
        return ControlEntry(date: date,
                            favourites: store.favourites(),
                            openAppOnStart: store.openAppOnStart(),
                            snapshot: store.activeSnapshot(now: date),
                            feedback: freshFb)
    }
}

// MARK: - Face

private func controlLabel(_ title: String, _ systemImage: String, highlighted: Bool = false) -> some View {
    VStack(spacing: 3) {
        Image(systemName: systemImage).font(.title3)
        Text(title).font(.caption2)
    }
    .frame(maxWidth: .infinity, minHeight: 42)
    .padding(.vertical, 4)
    .background(highlighted ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.quaternary),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .foregroundStyle(highlighted ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
}

private enum ControlKind: CaseIterable { case start, preheat, tare, now }

struct ControlCenterWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ControlEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            MeticHeader()
            if let fb = entry.feedback {
                FeedbackBanner(feedback: fb)
                    .padding(.top, 4)
            }
            faceContent
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private var highlightKind: ActionFeedback.Kind? {
        guard let fb = entry.feedback, fb.kind != .error else { return nil }
        return fb.kind
    }

    // The overlay *replaces* the content in place (rather than layering a
    // frosted pane over it) so it sits seamlessly on the widget background and
    // there's no material flash when dismissing.
    @ViewBuilder private var faceContent: some View {
        switch family {
        case .systemSmall:
            Spacer(minLength: 6)
            if let snap = entry.snapshot {
                SnapshotOverlay(snapshot: snap)
            } else {
                controlGrid(columns: 2)
            }
            Spacer(minLength: 4)
        case .systemMedium:
            Spacer(minLength: 8)
            if let snap = entry.snapshot {
                SnapshotOverlay(snapshot: snap)
            } else {
                controlRow
            }
            Spacer(minLength: 8)
        case .systemLarge:
            Spacer(minLength: 0)
            // Only the profile grid is replaced; the control row stays live.
            if let snap = entry.snapshot {
                SnapshotOverlay(snapshot: snap)
            } else {
                favouritesGrid
            }
            Spacer(minLength: 0)
            controlRow
        default:
            controlRow
        }
    }

    @ViewBuilder private func controlView(_ kind: ControlKind) -> some View {
        switch kind {
        case .start:
            let id = entry.favourites.first?.id
            if entry.openAppOnStart, let id, let url = URL(string: "metic://start?profileId=\(id)") {
                Link(destination: url) { controlLabel("Start", "play.fill", highlighted: highlightKind == .start) }
            } else {
                Button(intent: StartProfileIntent(profileId: id ?? "")) {
                    controlLabel("Start", "play.fill", highlighted: highlightKind == .start)
                }
                .buttonStyle(.plain)
            }
        case .preheat:
            Button(intent: PreheatIntent()) {
                controlLabel("Preheat", "thermometer.medium", highlighted: highlightKind == .preheat)
            }
            .buttonStyle(.plain)
        case .tare:
            Button(intent: TareIntent()) {
                controlLabel("Tare", "scalemass", highlighted: highlightKind == .tare)
            }
            .buttonStyle(.plain)
        case .now:
            Button(intent: SnapshotIntent()) { controlLabel("Now", "waveform.path.ecg") }
                .buttonStyle(.plain)
        }
    }

    private func controlGrid(columns: Int) -> some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 6), count: columns)
        return LazyVGrid(columns: cols, spacing: 6) {
            ForEach(ControlKind.allCases, id: \.self) { controlView($0) }
        }
    }

    private var controlRow: some View {
        HStack(spacing: 6) {
            ForEach(ControlKind.allCases, id: \.self) { controlView($0) }
        }
    }

    private var favouritesGrid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 6), count: 2)
        return LazyVGrid(columns: cols, spacing: 6) {
            ForEach(Array(entry.favourites.prefix(8))) { fav in
                FavouriteTile(favourite: fav, openAppOnStart: entry.openAppOnStart,
                              imageSize: 30, compact: true)
            }
        }
    }
}

// MARK: - Banner

struct FeedbackBanner: View {
    let feedback: ActionFeedback

    private var text: String {
        switch feedback.kind {
        case .start: return "Started"
        case .preheat: return "Preheating"
        case .tare: return "Tared"
        case .stop: return "Stopped"
        case .error: return feedback.message ?? "Something went wrong"
        }
    }

    private var isError: Bool { feedback.kind == .error }

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.caption2)
            Text(text).font(.caption2).bold().lineLimit(1)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? AnyShapeStyle(.red.opacity(0.9)) : AnyShapeStyle(.green.opacity(0.9)),
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - Snapshot overlay

struct SnapshotOverlay: View {
    let snapshot: MachineSnapshot

    var body: some View {
        ZStack {
            // Tap anywhere to dismiss. No material — the overlay replaces the
            // content in place and sits directly on the widget background, so
            // it reads as "the content was swapped out" with no seam or flash.
            Button(intent: DismissSnapshotIntent()) {
                content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if snapshot.state.isBrewing {
                VStack {
                    Spacer(minLength: 0)
                    Button(intent: StopIntent()) {
                        Label("Stop", systemImage: "stop.fill")
                            .font(.caption).bold()
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(.red.opacity(0.95), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(snapshot.state.label, systemImage: "circle.fill")
                    .font(.caption).bold()
                Spacer()
                meticWordmark(baseSize: 11)
            }
            if let name = snapshot.loadedProfileName {
                Text(name).font(.headline).lineLimit(1)
            }
            metricRow(icon: "thermometer.medium",
                      current: snapshot.currentTempC, target: snapshot.targetTempC, unit: "°")
            metricRow(icon: "scalemass",
                      current: snapshot.currentWeightG, target: snapshot.targetWeightG, unit: "g")
            Spacer(minLength: 0)
        }
    }

    private func metricRow(icon: String, current: Double?, target: Double?, unit: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.caption).foregroundStyle(.secondary)
            Text(current.map { "\(Int($0))\(unit)" } ?? "—")
                .font(.subheadline).monospacedDigit()
            if let target {
                Text("→ \(Int(target))\(unit)")
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }
}

// MARK: - Widget

struct ControlCenterWidget: Widget {
    static let kind = "ControlCenterWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ControlProvider()) { entry in
            ControlCenterWidgetView(entry: entry)
        }
        .configurationDisplayName("Metic. Control")
        .description("Preheat, tare, start, and peek at a live snapshot.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Previews

#Preview("Control · Idle", as: .systemMedium) {
    ControlCenterWidget()
} timeline: {
    ControlEntry(date: .now, favourites: [], openAppOnStart: false, snapshot: nil, feedback: nil)
}

#Preview("Control · Snapshot", as: .systemMedium) {
    ControlCenterWidget()
} timeline: {
    ControlEntry(date: .now, favourites: [], openAppOnStart: false,
                 snapshot: MachineSnapshot(state: .brewing, loadedProfileName: "SPHE-50",
                                           currentTempC: 92, targetTempC: 90,
                                           currentWeightG: 18, targetWeightG: 50),
                 feedback: nil)
}
