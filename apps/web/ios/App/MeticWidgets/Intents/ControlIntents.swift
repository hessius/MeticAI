import AppIntents
import WidgetKit

private func machineClient() -> MachineClient? {
    guard let base = AppGroupStore().machineURL() else { return nil }
    return MachineClient(baseURL: base)
}

struct PreheatIntent: AppIntent {
    static var title: LocalizedStringResource = "Preheat"
    func perform() async throws -> some IntentResult {
        _ = try? await machineClient()?.perform(.preheat)
        return .result()
    }
}

struct TareIntent: AppIntent {
    static var title: LocalizedStringResource = "Tare"
    func perform() async throws -> some IntentResult {
        _ = try? await machineClient()?.perform(.tare)
        return .result()
    }
}

struct StopIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop"
    func perform() async throws -> some IntentResult {
        _ = try? await machineClient()?.perform(.stop)
        return .result()
    }
}

/// Triggers a fresh snapshot by reloading the Control Center timeline; the
/// provider reads a live snapshot and renders the ~10s overlay, then reverts.
struct SnapshotIntent: AppIntent {
    static var title: LocalizedStringResource = "Now"
    func perform() async throws -> some IntentResult {
        // Mark the request so the provider knows to fetch (and system-driven
        // reloads don't hit the machine).
        AppGroup.defaults?.set(Date().timeIntervalSince1970, forKey: "snapshotRequestedAt")
        WidgetCenter.shared.reloadTimelines(ofKind: await ControlCenterWidget.kind)
        return .result()
    }
}
