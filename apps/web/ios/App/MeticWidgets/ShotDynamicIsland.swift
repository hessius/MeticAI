import ActivityKit
import WidgetKit
import SwiftUI

func shotDynamicIsland(_ context: ActivityViewContext<ShotActivityAttributes>) -> DynamicIsland {
    let state = context.state
    let attr = context.attributes
    return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
            Text(attr.profileName).font(.caption).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
            Text(glanceableValue(attr, state)).font(.caption.bold()).monospacedDigit()
        }
        DynamicIslandExpandedRegion(.bottom) {
            if state.phase == .ready {
                Button(intent: StartShotIntent()) { Text("Start") }
                    .tint(Color(red: 0.843, green: 0.443, blue: 0))
            } else if state.phase == .extracting {
                ShotSparkline(samples: state.graph).frame(height: 28)
            }
        }
    } compactLeading: {
        Image(systemName: iconName(state.phase))
    } compactTrailing: {
        Text(glanceableValue(attr, state)).monospacedDigit()
    } minimal: {
        Text(glanceableValue(attr, state)).monospacedDigit()
    }
}

private func iconName(_ phase: ShotPhase) -> String {
    switch phase {
    case .heating: return "thermometer.medium"
    case .ready: return "checkmark.circle"
    case .extracting: return "cup.and.saucer"
    case .done: return "checkmark.seal"
    }
}

/// The single glanceable value string for compact/minimal presentations,
/// honouring the user's configured stat and the current phase.
private func glanceableValue(_ attr: ShotActivityAttributes,
                             _ state: ShotActivityAttributes.ContentState) -> String {
    switch state.phase {
    case .heating:
        if attr.heatingGlanceable == .estimatedTime,
           let head = state.headTempC,
           let eta = estimateTimeToReady(current: head,
                                         target: attr.setTempC ?? 93,
                                         cutoff: attr.readyCutoffC ?? 91.5) {
            return ShotGlanceable.formatETA(eta)
        }
        return String(format: "%.0f°", state.headTempC ?? 0)
    case .ready:
        return "Ready"
    case .extracting:
        switch attr.shotGlanceable {
        case .weight: return ShotGlanceable.text(.weight, current: state.currentWeightG, target: attr.targetWeightG)
        case .pressure: return ShotGlanceable.text(.pressure, current: state.pressureBar, target: nil)
        case .flow: return ShotGlanceable.text(.flow, current: state.flowGs, target: nil)
        case .temp: return ShotGlanceable.text(.temp, current: state.brewTempC, target: nil)
        }
    case .done:
        return state.finalWeightG.map { String(format: "%.0fg", $0) } ?? "Done"
    }
}
