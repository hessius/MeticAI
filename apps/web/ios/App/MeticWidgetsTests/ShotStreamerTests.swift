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

    func testParseIgnoresOtherEvents() {
        XCTAssertNil(ShotStreamer.parseFrame(#"42["actuators",{"m_pos":1}]"#))
    }

    func testParseIgnoresControlFrames() {
        XCTAssertNil(ShotStreamer.parseFrame("2"))
        XCTAssertNil(ShotStreamer.parseFrame("40"))
    }
}
