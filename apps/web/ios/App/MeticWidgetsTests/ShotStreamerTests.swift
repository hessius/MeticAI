import XCTest

final class ShotStreamerTests: XCTestCase {
    func testParseStatusFrame() {
        let event = ShotStreamer.parseFrame(#"42["status",{"name":"Extraction","extracting":true,"sensors":{"p":8.5,"w":12}}]"#)
        guard case let .status(dict)? = event else { return XCTFail("expected status") }
        XCTAssertEqual(dict["name"] as? String, "Extraction")
    }

    func testParseTemperaturesFrame() {
        let event = ShotStreamer.parseFrame(#"42["temperatures",{"t_bar_up":88.5,"t_bar_down":84}]"#)
        guard case let .temperatures(dict)? = event else { return XCTFail("expected temps") }
        XCTAssertEqual(dict["t_bar_up"] as? Double, 88.5)
    }

    func testParseSensorsFrameAsTemperatures() {
        // The machine emits heating thermocouples on the `sensors` event.
        let event = ShotStreamer.parseFrame(#"42["sensors",{"t_bar_up":88.5,"t_bar_down":84}]"#)
        guard case let .temperatures(dict)? = event else { return XCTFail("expected temps") }
        XCTAssertEqual(dict["t_bar_down"] as? Double, 84)
    }

    func testParseIgnoresOtherEvents() {
        XCTAssertNil(ShotStreamer.parseFrame(#"42["actuators",{"m_pos":1}]"#))
    }

    func testParseIgnoresControlFrames() {
        XCTAssertNil(ShotStreamer.parseFrame("2"))
        XCTAssertNil(ShotStreamer.parseFrame("40"))
    }

    /// An unreachable machine should make the streamer retry with backoff and
    /// then finish cleanly at the max-duration cap, rather than dying on the
    /// first drop (permanent freeze) or spinning forever.
    func testStreamFinishesAtMaxDurationWhenUnreachable() async {
        // Port 1 on loopback is closed, so connects are refused immediately.
        let url = URL(string: "http://127.0.0.1:1")!
        let streamer = ShotStreamer(baseURL: url, session: Self.fastFailSession(), maxDuration: 1.0)
        let start = Date()
        var frameCount = 0
        for await _ in streamer.frames() { frameCount += 1 }
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertEqual(frameCount, 0, "unreachable host should yield no frames")
        XCTAssertLessThan(elapsed, 10.0, "stream must finish near the max-duration cap")
    }

    func testStopEndsStreamPromptly() async {
        let url = URL(string: "http://127.0.0.1:1")!
        let streamer = ShotStreamer(baseURL: url, session: Self.fastFailSession(), maxDuration: 60)
        let task = Task {
            for await _ in streamer.frames() {}
        }
        try? await Task.sleep(nanoseconds: 200_000_000)
        streamer.stop()
        // Awaiting the consuming task confirms the stream terminates on stop().
        _ = await task.value
    }

    private static func fastFailSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }
}
