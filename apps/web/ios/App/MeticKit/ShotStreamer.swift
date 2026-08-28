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
    private let maxDuration: TimeInterval
    private var task: URLSessionWebSocketTask?
    private var stopped = false

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        maxDuration: TimeInterval = 20 * 60
    ) {
        self.baseURL = baseURL
        self.session = session
        self.maxDuration = maxDuration
    }

    /// Begin streaming frames. The socket reconnects with backoff if it drops;
    /// the stream finishes only when `stop()` is called or the max-duration cap
    /// is reached.
    public func frames() -> AsyncStream<Frame> {
        AsyncStream { continuation in
            Task { await self.run(continuation) }
            continuation.onTermination = { [weak self] _ in self?.stop() }
        }
    }

    public func stop() {
        stopped = true
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

        let deadline = Date().addingTimeInterval(maxDuration)
        var backoffNs: UInt64 = 500_000_000  // 0.5s, doubles up to 8s

        while !stopped && Date() < deadline {
            let cleanlyConnected = await connectAndStream(wsURL, continuation)
            if stopped { break }
            // A successful session resets backoff so brief blips reconnect fast;
            // repeated immediate failures back off up to 8s.
            backoffNs = cleanlyConnected ? 500_000_000 : min(backoffNs * 2, 8_000_000_000)
            do {
                try await Task.sleep(nanoseconds: backoffNs)
            } catch {
                break  // cancelled while waiting to reconnect
            }
        }
        continuation.finish()
    }

    /// Connect once and pump frames until the socket drops or `stop()` fires.
    /// Returns `true` if the Engine.IO handshake completed (used to reset
    /// backoff), `false` if the connection failed before opening.
    private func connectAndStream(
        _ wsURL: URL,
        _ continuation: AsyncStream<Frame>.Continuation
    ) async -> Bool {
        let task = session.webSocketTask(with: wsURL)
        self.task = task
        task.resume()

        var didOpen = false
        do {
            while !stopped {
                let message = try await task.receive()
                guard case let .string(text) = message else { continue }
                if text.hasPrefix("0") {
                    didOpen = true
                    try await task.send(.string("40"))
                } else if text == "2" {
                    try await task.send(.string("3"))
                } else if let frame = ShotStreamer.parseFrame(text) {
                    continuation.yield(frame)
                }
            }
        } catch {
            // Fall through to reconnect handling in `run`.
        }
        task.cancel(with: .goingAway, reason: nil)
        if self.task === task { self.task = nil }
        return didOpen
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
