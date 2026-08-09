import AppIntents
import Foundation
import WidgetKit

/// Starts a favourite profile directly on the machine in the background.
/// Used when "Open app on start" is OFF. When ON, the widget uses a
/// `metic://start` Link instead so the app foregrounds and confirms.
/// Records banner feedback so the tap is always visibly confirmed — including
/// the failure case, which previously appeared to "do nothing".
struct StartProfileIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Profile"

    @Parameter(title: "Profile ID") var profileId: String

    init() {}
    init(profileId: String) { self.profileId = profileId }

    func perform() async throws -> some IntentResult {
        let writer = AppGroupWriter()
        guard let base = AppGroupStore().machineURL() else {
            writer.recordAction(.error, message: "Set the machine address in Metic")
            await ControlCenterReload.reload()
            return .result()
        }
        do {
            try await MachineClient(baseURL: base).startProfile(id: profileId)
            writer.recordAction(.start)
        } catch {
            writer.recordAction(.error, message: "Couldn’t reach the machine")
        }
        await ControlCenterReload.reload()
        return .result()
    }
}
