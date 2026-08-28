import Foundation

/// Direct-LAN HTTP client for the Meticulous machine. Mirrors the endpoints the
/// web `DirectAdapter` uses:
///   POST /api/v1/action/{start|stop|preheat|tare}
///   GET  /api/v1/profile/load/{id}
///   GET  /api/v1/profile/last            (effective loaded profile — reflects
///                                         temporary on-machine edits)
///   GET  /api/v1/settings                (liveness pre-flight)
/// Live status is read via Socket.IO (see SocketIOStatusReader).
public struct MachineClient {
    public enum ClientError: Error { case unreachable, badResponse }

    private let baseURL: URL
    private let session: URLSession
    private let statusReader: SocketIOStatusReader

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.statusReader = SocketIOStatusReader(baseURL: baseURL, session: session)
    }

    // MARK: - URL construction (pure, unit-tested)

    public func actionURL(_ action: MachineAction) -> URL {
        baseURL.appendingPathComponent("api/v1/action/\(action.rawValue)")
    }

    public func loadProfileURL(id: String) -> URL {
        baseURL.appendingPathComponent("api/v1/profile/load/\(id)")
    }

    /// The *effective* loaded profile, including temporary edits made directly on
    /// the machine. Fetching a stored profile by id (`/profile/get/{id}`) returns
    /// the saved definition and would miss on-machine tweaks such as a changed
    /// target weight, so target temp/weight are derived from this endpoint.
    public var lastProfileURL: URL { baseURL.appendingPathComponent("api/v1/profile/last") }

    public var settingsURL: URL { baseURL.appendingPathComponent("api/v1/settings") }

    // MARK: - Actions

    /// Fast liveness pre-flight against the settings endpoint.
    public func isReachable(timeout: TimeInterval = 2) async -> Bool {
        var req = URLRequest(url: settingsURL)
        req.timeoutInterval = timeout
        do {
            let (_, resp) = try await session.data(for: req)
            return (resp as? HTTPURLResponse).map { (200..<500).contains($0.statusCode) } ?? false
        } catch { return false }
    }

    @discardableResult
    public func perform(_ action: MachineAction, timeout: TimeInterval = 4) async throws -> Bool {
        guard await isReachable() else { throw ClientError.unreachable }
        var req = URLRequest(url: actionURL(action))
        req.httpMethod = "POST"
        req.timeoutInterval = timeout
        let (_, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ClientError.badResponse
        }
        return true
    }

    public func loadProfile(id: String, timeout: TimeInterval = 4) async throws {
        var req = URLRequest(url: loadProfileURL(id: id))
        req.timeoutInterval = timeout
        let (_, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ClientError.badResponse
        }
    }

    public func startProfile(id: String) async throws {
        guard await isReachable() else { throw ClientError.unreachable }
        try await loadProfile(id: id)
        try await perform(.start)
    }

    // MARK: - Snapshot

    /// One-shot machine snapshot: reads a single Socket.IO `status` frame and,
    /// when a profile is loaded, derives target temp/weight from that profile.
    public func snapshot(timeout: TimeInterval = 5) async throws -> MachineSnapshot {
        guard await isReachable(timeout: 2) else { throw ClientError.unreachable }
        let status = try await statusReader.readStatus(timeout: timeout)
        return await makeSnapshot(from: status)
    }

    /// Build a MachineSnapshot from a raw status dictionary. Exposed for tests.
    func makeSnapshot(from status: [String: Any]) async -> MachineSnapshot {
        // Mirror the server's derivation: state comes from `name` (falling back
        // to `state`), and brewing is driven by the `extracting` flag, not the
        // state string, so the widget agrees with the app.
        let rawState = (status["name"] as? String) ?? (status["state"] as? String)
        let extracting = (status["extracting"] as? NSNumber)?.boolValue
            ?? (status["extracting"] as? Bool) ?? false
        let state = MachineState(raw: rawState, extracting: extracting)
        let loadedName = (status["loaded_profile"] as? String) ?? (status["profile"] as? String)
        let sensors = status["sensors"] as? [String: Any]
        let currentWeight = (sensors?["w"] as? NSNumber)?.doubleValue
        let currentTemp = (sensors?["t"] as? NSNumber)?.doubleValue

        var targetTemp: Double?
        var targetWeight: Double?
        // Derive targets from the *effective* loaded profile (reflects temporary
        // on-machine edits). Only attempt when a profile is actually loaded.
        let hasProfile = (status["id"] as? String).map { !$0.isEmpty } ?? (loadedName != nil)
        if hasProfile, let (temp, weight) = try? await fetchProfileTargets() {
            targetTemp = temp
            targetWeight = weight
        }

        // A target weight while idle is just a remnant of the last shot, not a
        // goal being pursued — don't surface it.
        targetWeight = Self.effectiveTargetWeight(targetWeight, state: state)

        return MachineSnapshot(
            state: state,
            loadedProfileName: loadedName,
            currentTempC: currentTemp,
            targetTempC: targetTemp,
            currentWeightG: currentWeight,
            targetWeightG: targetWeight
        )
    }

    /// Suppresses a target weight while idle — an idle machine's "target" is a
    /// stale remnant of the last shot, not a goal being pursued. Pure + tested.
    static func effectiveTargetWeight(_ weight: Double?, state: MachineState) -> Double? {
        state == .idle ? nil : weight
    }

    private func fetchProfileTargets() async throws -> (Double?, Double?) {
        var req = URLRequest(url: lastProfileURL)
        req.timeoutInterval = 3
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let obj = root["profile"] as? [String: Any] else {
            throw ClientError.badResponse
        }
        let temp = (obj["temperature"] as? NSNumber)?.doubleValue
        let weight = (obj["final_weight"] as? NSNumber)?.doubleValue
        return (temp, weight)
    }
}
