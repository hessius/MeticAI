import AppIntents
import WidgetKit

enum ControlCenterReload {
    @MainActor static func reload() {
        WidgetCenter.shared.reloadTimelines(ofKind: ControlCenterWidget.kind)
    }
}

private func machineClient() -> MachineClient? {
    guard let base = AppGroupStore().machineURL() else { return nil }
    return MachineClient(baseURL: base)
}

/// Runs a machine action and records banner feedback (success or a clear error),
/// then reloads the Control Center so the confirmation is shown immediately.
private func runAction(_ action: MachineAction, feedback: ActionFeedback.Kind) async {
    let writer = AppGroupWriter()
    guard let client = machineClient() else {
        writer.recordAction(.error, message: "Set the machine address in Metic")
        await ControlCenterReload.reload()
        return
    }
    do {
        _ = try await client.perform(action)
        writer.recordAction(feedback)
    } catch {
        writer.recordAction(.error, message: "Couldn’t reach the machine")
    }
    await ControlCenterReload.reload()
}

struct PreheatIntent: AppIntent {
    static var title: LocalizedStringResource = "Preheat"
    func perform() async throws -> some IntentResult {
        await runAction(.preheat, feedback: .preheat)
        return .result()
    }
}

struct TareIntent: AppIntent {
    static var title: LocalizedStringResource = "Tare"
    func perform() async throws -> some IntentResult {
        await runAction(.tare, feedback: .tare)
        return .result()
    }
}

struct StopIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop"
    func perform() async throws -> some IntentResult {
        await runAction(.stop, feedback: .stop)
        return .result()
    }
}

/// "Now" — fetches a live snapshot, stores it to overlay for ~10s, then reloads.
/// The overlay lifecycle is driven by `snapshotShownUntil` so it stays stable
/// across unrelated timeline reloads (no more flashing).
struct SnapshotIntent: AppIntent {
    static var title: LocalizedStringResource = "Now"
    func perform() async throws -> some IntentResult {
        let writer = AppGroupWriter()
        guard let client = machineClient() else {
            writer.recordAction(.error, message: "Set the machine address in Metic")
            await ControlCenterReload.reload()
            return .result()
        }
        do {
            let snap = try await client.snapshot()
            writer.showSnapshot(snap, for: 10)
        } catch {
            writer.recordAction(.error, message: "Couldn’t reach the machine")
        }
        await ControlCenterReload.reload()
        return .result()
    }
}

/// Tapping the widget while the snapshot overlay is showing dismisses it.
struct DismissSnapshotIntent: AppIntent {
    static var title: LocalizedStringResource = "Dismiss Snapshot"
    func perform() async throws -> some IntentResult {
        AppGroupWriter().clearSnapshot()
        await ControlCenterReload.reload()
        return .result()
    }
}
