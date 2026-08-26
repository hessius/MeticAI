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

    /// If no update arrives within this window (e.g. iOS suspended the app in
    /// the background and the local socket can't run), the system marks the
    /// activity stale and dims it, rather than showing frozen values as live.
    private static let staleAfter: TimeInterval = 12

    /// How long the terminal shot summary lingers on the Lock Screen / Dynamic
    /// Island after the shot finishes before the system dismisses it.
    private static let summaryLinger: TimeInterval = 5 * 60

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
    private var lastWeightG: Double?
    private var lastElapsedSec: Double?
    private var lastStatusFrame: ShotFrame?
    /// True once the shot has entered extraction — gates completion detection and
    /// causes post-shot idle temperatures to be ignored.
    private var hasExtracted = false
    /// Guards against finishing (ending the activity) more than once.
    private var isFinishing = false

    func start(
        profileName: String,
        machineURL: URL,
        targetWeightG: Double?,
        doseG: Double?,
        setTempC: Double?,
        readyCutoffC: Double?,
        config: GlanceableConfig,
        strings: ShotLocalizedStrings = ShotLocalizedStrings()
    ) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        stop()
        // End any activity orphaned by a previous app termination so a new shot
        // doesn't stack a duplicate on the Lock Screen / Dynamic Island.
        for dangling in Activity<ShotActivityAttributes>.activities {
            Task { await dangling.end(nil, dismissalPolicy: .immediate) }
        }

        self.doseG = doseG
        self.targetWeightG = targetWeightG
        graph = ShotGraphBuffer()
        tempSamples = []
        lastChamber = nil
        lastHead = nil
        lastWeightG = nil
        lastElapsedSec = nil
        lastStatusFrame = nil
        hasExtracted = false
        isFinishing = false

        let attributes = ShotActivityAttributes(
            profileName: profileName,
            targetWeightG: targetWeightG,
            setTempC: setTempC,
            readyCutoffC: readyCutoffC,
            shotGlanceable: config.shot,
            heatingGlanceable: config.heating,
            strings: strings
        )
        let initial = ShotActivityAttributes.ContentState(phase: .heating)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: initial, staleDate: Date().addingTimeInterval(Self.staleAfter))
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
        // JS-driven stop (user left the shot flow). Show the terminal summary
        // only if a shot actually happened; otherwise just clear the activity.
        finish(showSummary: hasExtracted)
    }

    /// Tear down the stream and end the activity. When `showSummary` is true the
    /// activity ends on a `.done` summary that lingers for `summaryLinger`;
    /// otherwise it is dismissed immediately.
    private func finish(showSummary: Bool) {
        guard !isFinishing else { return }
        isFinishing = true
        streamTask?.cancel()
        streamTask = nil
        streamer?.stop()
        streamer = nil
        endBackground()
        guard let activity else {
            self.activity = nil
            return
        }
        if showSummary {
            let summary = ShotContentBuilder.summary(
                finalWeightG: lastWeightG,
                finalTimeSec: lastElapsedSec,
                doseG: doseG,
                tempSamples: tempSamples
            )
            let doneState = ShotActivityAttributes.ContentState(
                phase: .done,
                elapsedSec: lastElapsedSec,
                graph: graph.downsampled(),
                finalWeightG: summary.finalWeightG,
                finalTimeSec: summary.finalTimeSec,
                ratio: summary.ratio,
                avgTempC: summary.avgTempC
            )
            Task {
                await activity.end(
                    .init(state: doneState, staleDate: nil),
                    dismissalPolicy: .after(.now + Self.summaryLinger)
                )
            }
        } else {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        self.activity = nil
    }

    private func handle(_ frame: ShotStreamer.Frame) async {
        guard let activity, !isFinishing else { return }
        switch frame {
        case .temperatures(let temps):
            // Once the shot is underway (or over), the heating two-stage bars are
            // no longer relevant — ignore idle temperatures so a finished shot
            // never reverts to a misleading live temperature readout.
            if hasExtracted { return }
            // Field mapping matches the in-app live view: t_bar_up = boiler /
            // "Brew Chamber", t_bar_down = "Brew Head".
            if let chamber = (temps["t_bar_up"] as? NSNumber)?.doubleValue { lastChamber = chamber }
            if let head = (temps["t_bar_down"] as? NSNumber)?.doubleValue { lastHead = head }
            // Reflect the new heating temps immediately. During heating there may
            // be no `status` frames carrying temps, so merge them into the last
            // known frame (or a bare heating frame) and push an update.
            var merged = lastStatusFrame ?? ShotFrame(phase: .heating)
            merged.chamberTempC = lastChamber
            merged.headTempC = lastHead
            let tempState = ShotContentBuilder.state(
                from: merged,
                graph: graph,
                doseG: doseG,
                tempSamples: tempSamples
            )
            await activity.update(.init(state: tempState, staleDate: Date().addingTimeInterval(Self.staleAfter)))
        case .status(let status):
            guard var shotFrame = ShotFrame(status: status) else { return }
            shotFrame.chamberTempC = lastChamber
            shotFrame.headTempC = lastHead
            if shotFrame.phase == .extracting {
                hasExtracted = true
                if let elapsedSec = shotFrame.elapsedSec {
                    graph.append(
                        t: elapsedSec,
                        p: shotFrame.pressureBar ?? 0,
                        f: shotFrame.flowGs ?? 0,
                        w: shotFrame.weightG ?? 0
                    )
                    if let brewTempC = shotFrame.brewTempC { tempSamples.append(brewTempC) }
                    if let w = shotFrame.weightG { lastWeightG = w }
                    lastElapsedSec = elapsedSec
                }
            } else if ShotContentBuilder.shotDidComplete(hasExtracted: hasExtracted, phase: shotFrame.phase) {
                // Shot just finished (machine left extraction) — freeze into the
                // lingering summary instead of showing post-shot idle state.
                finish(showSummary: true)
                return
            }
            lastStatusFrame = shotFrame
            let newState = ShotContentBuilder.state(
                from: shotFrame,
                graph: graph,
                doseG: doseG,
                tempSamples: tempSamples
            )
            await activity.update(.init(state: newState, staleDate: Date().addingTimeInterval(Self.staleAfter)))
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
