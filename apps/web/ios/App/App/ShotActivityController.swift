import Foundation
import ActivityKit
import UIKit

/// Owns the shot Live Activity for its short lifetime. JS starts/stops it via
/// the Capacitor plugin; this class drives live updates natively from a
/// persistent Socket.IO stream, kept alive by a background-task assertion so it
/// survives the phone locking during the shot.
@MainActor
@available(iOS 17.0, *)
final class ShotActivityController {
    static let shared = ShotActivityController()

    private var activity: Activity<ShotActivityAttributes>?
    private var streamer: ShotStreamer?
    private var streamTask: Task<Void, Never>?
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private var graph = ShotGraphBuffer()
    private var tempSamples: [Double] = []
    private var doseG: Double?
    private var targetWeightG: Double?
    private var lastChamber: Double?
    private var lastHead: Double?

    func start(
        profileName: String,
        machineURL: URL,
        targetWeightG: Double?,
        doseG: Double?,
        setTempC: Double?,
        readyCutoffC: Double?,
        config: GlanceableConfig
    ) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        stop()

        self.doseG = doseG
        self.targetWeightG = targetWeightG
        graph = ShotGraphBuffer()
        tempSamples = []
        lastChamber = nil
        lastHead = nil

        let attributes = ShotActivityAttributes(
            profileName: profileName,
            targetWeightG: targetWeightG,
            setTempC: setTempC,
            readyCutoffC: readyCutoffC,
            shotGlanceable: config.shot,
            heatingGlanceable: config.heating
        )
        let initial = ShotActivityAttributes.ContentState(phase: .heating)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: initial, staleDate: nil)
            )
        } catch {
            return
        }

        beginBackground()
        let streamer = ShotStreamer(baseURL: machineURL)
        self.streamer = streamer
        streamTask = Task { [weak self, streamer] in
            for await frame in streamer.frames() {
                await self?.handle(frame)
            }
        }
    }

    func updateConfig(_ config: GlanceableConfig) {
        // Static attributes can't change mid-activity; persist for the next start.
        AppGroupWriter().setGlanceableConfig(config)
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
        streamer?.stop()
        streamer = nil
        endBackground()
        if let activity {
            Task {
                await activity.end(nil, dismissalPolicy: .after(.now + 30))
            }
        }
        activity = nil
    }

    private func handle(_ frame: ShotStreamer.Frame) async {
        guard let activity else { return }
        switch frame {
        case .temperatures(let temps):
            if let chamber = (temps["t_bar_down"] as? NSNumber)?.doubleValue { lastChamber = chamber }
            if let head = (temps["t_bar_up"] as? NSNumber)?.doubleValue { lastHead = head }
        case .status(let status):
            guard var shotFrame = ShotFrame(status: status) else { return }
            shotFrame.chamberTempC = lastChamber
            shotFrame.headTempC = lastHead
            if shotFrame.phase == .extracting, let elapsedSec = shotFrame.elapsedSec {
                graph.append(
                    t: elapsedSec,
                    p: shotFrame.pressureBar ?? 0,
                    f: shotFrame.flowGs ?? 0,
                    w: shotFrame.weightG ?? 0
                )
                if let brewTempC = shotFrame.brewTempC { tempSamples.append(brewTempC) }
            }
            let newState = ShotContentBuilder.state(
                from: shotFrame,
                graph: graph,
                doseG: doseG,
                tempSamples: tempSamples
            )
            await activity.update(.init(state: newState, staleDate: nil))
        }
    }

    private func beginBackground() {
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "ShotLiveActivity") { [weak self] in
            Task { @MainActor [weak self] in
                self?.endBackground()
            }
        }
    }

    private func endBackground() {
        guard bgTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(bgTask)
        bgTask = .invalid
    }
}
