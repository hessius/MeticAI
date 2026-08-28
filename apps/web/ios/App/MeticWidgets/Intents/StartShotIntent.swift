import AppIntents
import Foundation

/// Starts the currently loaded shot from the Live Activity's Ready state.
/// The machine already has the profile loaded (the app initiated heating), so
/// this just triggers `.start`. Errors are swallowed — the live stream will
/// reflect whether extraction actually began.
struct StartShotIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Shot"

    func perform() async throws -> some IntentResult {
        if let base = AppGroupStore().machineURL() {
            _ = try? await MachineClient(baseURL: base).perform(.start)
        }
        return .result()
    }
}
