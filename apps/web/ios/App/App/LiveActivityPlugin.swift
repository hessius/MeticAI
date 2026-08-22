import ActivityKit
import Capacitor
import Foundation

/// Bridges the shot Live Activity lifecycle from the web layer. The web app
/// starts/stops the activity and sets static config; native code drives the
/// live updates (see ShotActivityController).
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "areActivitiesEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) { call.resolve(["supported": true]) }
        else { call.resolve(["supported": false]) }
    }

    @objc func areActivitiesEnabled(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            call.resolve(["enabled": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["enabled": false])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(); return }
        guard let urlStr = call.getString("machineUrl"), let url = URL(string: urlStr) else {
            call.reject("machineUrl required"); return
        }
        let config = GlanceableConfig(
            shot: ShotGlanceableStat(rawValue: call.getString("shotGlanceable") ?? "weight") ?? .weight,
            heating: HeatingGlanceableStat(rawValue: call.getString("heatingGlanceable") ?? "temp") ?? .temp)
        DispatchQueue.main.async {
            ShotActivityController.shared.start(
                profileName: call.getString("profileName") ?? "Shot",
                machineURL: url,
                targetWeightG: call.getDouble("targetWeightG"),
                doseG: call.getDouble("doseG"),
                setTempC: call.getDouble("setTempC"),
                readyCutoffC: call.getDouble("readyCutoffC"),
                config: config)
            call.resolve()
        }
    }

    @objc func updateConfig(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(); return }
        let config = GlanceableConfig(
            shot: ShotGlanceableStat(rawValue: call.getString("shotGlanceable") ?? "weight") ?? .weight,
            heating: HeatingGlanceableStat(rawValue: call.getString("heatingGlanceable") ?? "temp") ?? .temp)
        DispatchQueue.main.async {
            ShotActivityController.shared.updateConfig(config)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(); return }
        DispatchQueue.main.async {
            ShotActivityController.shared.stop()
            call.resolve()
        }
    }
}
