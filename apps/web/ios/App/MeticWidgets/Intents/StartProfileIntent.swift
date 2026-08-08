import AppIntents
import Foundation

/// Starts a favourite profile directly on the machine in the background.
/// Used when "Open app on start" is OFF. When ON, the widget uses a
/// `metic://start` Link instead so the app foregrounds and confirms.
struct StartProfileIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Profile"

    @Parameter(title: "Profile ID") var profileId: String

    init() {}
    init(profileId: String) { self.profileId = profileId }

    func perform() async throws -> some IntentResult {
        guard let base = AppGroupStore().machineURL() else { return .result() }
        try? await MachineClient(baseURL: base).startProfile(id: profileId)
        return .result()
    }
}
