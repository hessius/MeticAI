import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Timeline

struct ControlEntry: TimelineEntry {
    let date: Date
    let favourites: [Favourite]
    let openAppOnStart: Bool
    /// Fresh snapshot to show as an overlay, or nil for the plain control face.
    let snapshot: MachineSnapshot?
    /// True when the machine could not be reached for a requested snapshot.
    let unreachable: Bool
}

struct ControlProvider: TimelineProvider {
    func placeholder(in context: Context) -> ControlEntry {
        ControlEntry(date: .now, favourites: [], openAppOnStart: false, snapshot: nil, unreachable: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (ControlEntry) -> Void) {
        let store = AppGroupStore()
        completion(ControlEntry(date: .now, favourites: store.favourites(),
                                openAppOnStart: store.openAppOnStart(), snapshot: nil, unreachable: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ControlEntry>) -> Void) {
        Task {
            let store = AppGroupStore()
            let favourites = store.favourites()
            let openApp = store.openAppOnStart()

            // Only fetch a live snapshot if one was explicitly requested recently
            // (via the "Now" button), so system-driven reloads stay silent. The
            // window is generous because WidgetKit may defer the reload.
            let requestedAt = AppGroup.defaults?.double(forKey: "snapshotRequestedAt") ?? 0
            let isFresh = Date().timeIntervalSince1970 - requestedAt < 8

            guard isFresh, let base = store.machineURL() else {
                completion(Timeline(entries: [
                    ControlEntry(date: .now, favourites: favourites, openAppOnStart: openApp,
                                 snapshot: nil, unreachable: false)
                ], policy: .never))
                return
            }

            // Consume the request so we don't re-fetch on the next reload.
            AppGroup.defaults?.set(0, forKey: "snapshotRequestedAt")

            do {
                let snap = try await MachineClient(baseURL: base).snapshot()
                let now = Date()
                let showing = ControlEntry(date: now, favourites: favourites, openAppOnStart: openApp,
                                           snapshot: snap, unreachable: false)
                let revert = ControlEntry(date: now.addingTimeInterval(10), favourites: favourites,
                                          openAppOnStart: openApp, snapshot: nil, unreachable: false)
                completion(Timeline(entries: [showing, revert], policy: .never))
            } catch {
                let now = Date()
                let err = ControlEntry(date: now, favourites: favourites, openAppOnStart: openApp,
                                       snapshot: nil, unreachable: true)
                let revert = ControlEntry(date: now.addingTimeInterval(6), favourites: favourites,
                                          openAppOnStart: openApp, snapshot: nil, unreachable: false)
                completion(Timeline(entries: [err, revert], policy: .never))
            }
        }
    }
}

// MARK: - Views

private func controlLabel(_ title: String, _ systemImage: String) -> some View {
    VStack(spacing: 3) {
        Image(systemName: systemImage).font(.title3)
        Text(title).font(.caption2)
    }
    .frame(maxWidth: .infinity, minHeight: 44)
    .padding(.vertical, 4)
    .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
}

private enum ControlKind: CaseIterable { case start, preheat, tare, now }

struct ControlCenterWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ControlEntry

    var body: some View {
        ZStack {
            VStack(alignment: .leading, spacing: 6) {
                MeticHeader()
                faceContent
            }
            if let snap = entry.snapshot {
                SnapshotOverlay(snapshot: snap)
            } else if entry.unreachable {
                UnreachableOverlay()
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder private var faceContent: some View {
        switch family {
        case .systemSmall:
            controlGrid(columns: 2)
        case .systemMedium:
            controlRow
        case .systemLarge:
            VStack(spacing: 8) {
                favouritesGrid
                controlRow
            }
        default:
            controlRow
        }
    }

    /// Start honours "Open app on start" (foreground via metic:// Link) exactly
    /// like the favourite tiles; otherwise it starts the top favourite in the
    /// background. Stop is not on the face — it lives in the snapshot overlay,
    /// which is the only moment the widget knows the machine is brewing.
    @ViewBuilder private func controlView(_ kind: ControlKind) -> some View {
        switch kind {
        case .start:
            let id = entry.favourites.first?.id
            if entry.openAppOnStart, let id, let url = URL(string: "metic://start?profileId=\(id)") {
                Link(destination: url) { controlLabel("Start", "play.fill") }
            } else {
                Button(intent: StartProfileIntent(profileId: id ?? "")) {
                    controlLabel("Start", "play.fill")
                }
                .buttonStyle(.plain)
            }
        case .preheat:
            Button(intent: PreheatIntent()) { controlLabel("Preheat", "thermometer.medium") }
                .buttonStyle(.plain)
        case .tare:
            Button(intent: TareIntent()) { controlLabel("Tare", "scalemass") }
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
            ForEach(Array(entry.favourites.prefix(6))) { fav in
                FavouriteTile(favourite: fav, openAppOnStart: entry.openAppOnStart,
                              imageSize: 30, compact: true)
            }
        }
    }
}

// MARK: - Overlays

struct SnapshotOverlay: View {
    let snapshot: MachineSnapshot

    private var stateLabel: String {
        switch snapshot.state {
        case .idle: return "Idle"
        case .heating: return "Heating"
        case .ready: return "Ready"
        case .brewing: return "Brewing"
        case .unknown: return "—"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(stateLabel, systemImage: "circle.fill")
                    .font(.caption).bold()
                Spacer()
                Text("Metic.").font(.caption2).bold().opacity(0.7)
            }
            if let name = snapshot.loadedProfileName {
                Text(name).font(.headline).lineLimit(1)
            }
            metricRow(icon: "thermometer.medium",
                      current: snapshot.currentTempC, target: snapshot.targetTempC, unit: "°")
            metricRow(icon: "scalemass",
                      current: snapshot.currentWeightG, target: snapshot.targetWeightG, unit: "g")
            Spacer(minLength: 0)
            if snapshot.state.isBrewing {
                Button(intent: StopIntent()) {
                    Label("Stop", systemImage: "stop.fill")
                        .font(.caption).bold()
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(.red.opacity(0.9), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.ultraThinMaterial)
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

struct UnreachableOverlay: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark").font(.title2)
            Text("Machine unreachable").font(.footnote).bold()
            if let url = URL(string: "metic://open") {
                Link(destination: url) {
                    Text("Open Metic")
                        .font(.caption).bold()
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(.tint, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
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
    ControlEntry(date: .now, favourites: [], openAppOnStart: false, snapshot: nil, unreachable: false)
}

#Preview("Control · Snapshot", as: .systemMedium) {
    ControlCenterWidget()
} timeline: {
    ControlEntry(date: .now, favourites: [], openAppOnStart: false,
                 snapshot: MachineSnapshot(state: .brewing, loadedProfileName: "SPHE-50",
                                           currentTempC: 92, targetTempC: 90,
                                           currentWeightG: 18, targetWeightG: 50),
                 unreachable: false)
}
