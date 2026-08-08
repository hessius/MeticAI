import Foundation

/// Minimal Engine.IO v4 / Socket.IO client that connects, waits for a single
/// `status` event, and disconnects. Used to grab a one-shot machine snapshot
/// for the Control Center widget without keeping a live connection.
///
/// Engine.IO framing used here:
///   "0{...}"            open packet (server → client)
///   "40"               connect to default namespace (client → server)
///   "40{...}"          namespace connected (server → client)
///   "2" / "3"          ping / pong
///   "42[\"status\",{}]" event message
public final class SocketIOStatusReader {
    public enum ReaderError: Error { case timeout, disconnected, invalidURL }

    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Connect and return the JSON object payload of the first `status` event.
    public func readStatus(timeout: TimeInterval = 5) async throws -> [String: Any] {
        guard var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw ReaderError.invalidURL
        }
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        comps.path = "/socket.io/"
        comps.queryItems = [
            URLQueryItem(name: "EIO", value: "4"),
            URLQueryItem(name: "transport", value: "websocket"),
        ]
        guard let wsURL = comps.url else { throw ReaderError.invalidURL }

        let task = session.webSocketTask(with: wsURL)
        task.resume()
        defer { task.cancel(with: .goingAway, reason: nil) }

        return try await withThrowingTaskGroup(of: [String: Any].self) { group in
            group.addTask { try await self.pump(task) }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                throw ReaderError.timeout
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else { throw ReaderError.disconnected }
            return result
        }
    }

    private func pump(_ task: URLSessionWebSocketTask) async throws -> [String: Any] {
        while true {
            let message = try await task.receive()
            guard case let .string(text) = message else { continue }

            if text.hasPrefix("0") {
                // Engine.IO open → connect to the default namespace.
                try await task.send(.string("40"))
            } else if text == "2" {
                // Ping → pong.
                try await task.send(.string("3"))
            } else if text.hasPrefix("42") {
                if let payload = Self.parseEvent(text), payload.name == "status" {
                    return payload.data
                }
            }
        }
    }

    /// Parse a `42["event",{...}]` message into its name + object payload.
    static func parseEvent(_ text: String) -> (name: String, data: [String: Any])? {
        // Strip the Engine.IO/Socket.IO prefix (e.g. "42" or "42/ns,").
        guard let bracket = text.firstIndex(of: "[") else { return nil }
        let jsonPart = String(text[bracket...])
        guard let data = jsonPart.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [Any],
              arr.count >= 2,
              let name = arr[0] as? String,
              let obj = arr[1] as? [String: Any] else { return nil }
        return (name, obj)
    }
}
