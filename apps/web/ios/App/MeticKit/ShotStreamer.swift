import Foundation

/// A persistent Engine.IO v4 / Socket.IO client that stays connected for the
/// duration of a shot and yields every `status` / `temperatures` event as an
/// async stream. Reuses the framing from `SocketIOStatusReader`.
public final class ShotStreamer {
    public enum Frame {
        case status([String: Any])
        case temperatures([String: Any])
    }

    private let baseURL: URL
    private let session: URLSession
    private var task: URLSessionWebSocketTask?

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Begin streaming frames. The stream finishes when `stop()` is called or
    /// the socket drops.
    public func frames() -> AsyncStream<Frame> {
        AsyncStream { continuation in
            Task { await self.run(continuation) }
            continuation.onTermination = { [weak self] _ in self?.stop() }
        }
    }

    public func stop() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func run(_ continuation: AsyncStream<Frame>.Continuation) async {
        guard var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            continuation.finish(); return
        }
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        comps.path = "/socket.io/"
        comps.queryItems = [
            URLQueryItem(name: "EIO", value: "4"),
            URLQueryItem(name: "transport", value: "websocket"),
        ]
        guard let wsURL = comps.url else { continuation.finish(); return }

        let task = session.webSocketTask(with: wsURL)
        self.task = task
        task.resume()

        do {
            while true {
                let message = try await task.receive()
                guard case let .string(text) = message else { continue }
                if text.hasPrefix("0") {
                    try await task.send(.string("40"))
                } else if text == "2" {
                    try await task.send(.string("3"))
                } else if let frame = ShotStreamer.parseFrame(text) {
                    continuation.yield(frame)
                }
            }
        } catch {
            continuation.finish()
        }
    }

    /// Parse a raw Engine.IO text frame into a `status`/`temperatures` frame,
    /// or nil for control frames and unrelated events.
    static func parseFrame(_ text: String) -> Frame? {
        guard text.hasPrefix("42"), let bracket = text.firstIndex(of: "[") else { return nil }
        let jsonPart = String(text[bracket...])
        guard let data = jsonPart.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [Any],
              arr.count >= 2,
              let name = arr[0] as? String,
              let obj = arr[1] as? [String: Any] else { return nil }
        switch name {
        case "status": return .status(obj)
        // The machine emits heating thermocouples on the `sensors` event
        // (t_bar_up/t_bar_down); older/other firmware may use `temperatures`.
        case "sensors", "temperatures": return .temperatures(obj)
        default: return nil
        }
    }
}
