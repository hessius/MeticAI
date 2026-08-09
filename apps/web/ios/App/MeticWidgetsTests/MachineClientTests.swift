import XCTest

final class MachineClientTests: XCTestCase {
    private let base = URL(string: "http://machine.local:8080")!

    func testActionURL() {
        let c = MachineClient(baseURL: base)
        XCTAssertEqual(c.actionURL(.start).absoluteString,
                       "http://machine.local:8080/api/v1/action/start")
        XCTAssertEqual(c.actionURL(.preheat).absoluteString,
                       "http://machine.local:8080/api/v1/action/preheat")
        XCTAssertEqual(c.actionURL(.tare).absoluteString,
                       "http://machine.local:8080/api/v1/action/tare")
        XCTAssertEqual(c.actionURL(.stop).absoluteString,
                       "http://machine.local:8080/api/v1/action/stop")
    }

    func testLoadProfileURL() {
        let c = MachineClient(baseURL: base)
        XCTAssertEqual(c.loadProfileURL(id: "abc").absoluteString,
                       "http://machine.local:8080/api/v1/profile/load/abc")
    }

    func testProfileURL() {
        let c = MachineClient(baseURL: base)
        XCTAssertEqual(c.profileURL(id: "abc").absoluteString,
                       "http://machine.local:8080/api/v1/profile/get/abc")
    }

    func testSettingsURL() {
        let c = MachineClient(baseURL: base)
        XCTAssertEqual(c.settingsURL.absoluteString,
                       "http://machine.local:8080/api/v1/settings")
    }

    func testMakeSnapshotParsesStatusFields() async {
        let c = MachineClient(baseURL: base)
        let status: [String: Any] = [
            "state": "brewing",
            "loaded_profile": "SPHE-50",
            "sensors": ["w": 18.4, "t": 92.1],
            // No "id" → target derivation skipped, so no network call in tests.
        ]
        let snap = await c.makeSnapshot(from: status)
        XCTAssertEqual(snap.state, .brewing)
        XCTAssertEqual(snap.loadedProfileName, "SPHE-50")
        XCTAssertEqual(snap.currentWeightG, 18.4)
        XCTAssertEqual(snap.currentTempC, 92.1)
        XCTAssertNil(snap.targetTempC)
    }

    func testEffectiveTargetWeightSuppressedWhenIdle() {
        // Idle → suppress the stale target weight; any other state passes through.
        XCTAssertNil(MachineClient.effectiveTargetWeight(36.0, state: .idle))
        XCTAssertEqual(MachineClient.effectiveTargetWeight(36.0, state: .brewing), 36.0)
        XCTAssertEqual(MachineClient.effectiveTargetWeight(50.0, state: .ready), 50.0)
        XCTAssertEqual(MachineClient.effectiveTargetWeight(40.0, state: .heating), 40.0)
    }

    func testMakeSnapshotDropsTargetWeightWhenIdle() async {
        let c = MachineClient(baseURL: base)
        let status: [String: Any] = [
            "state": "idle",
            "loaded_profile": "SPHE-50",
            "sensors": ["w": 36.0, "t": 40.0],
            "id": "abc",
        ]
        let snap = await c.makeSnapshot(from: status)
        XCTAssertEqual(snap.state, .idle)
        XCTAssertNil(snap.targetWeightG)
    }

    func testParseSocketIOEvent() {
        let parsed = SocketIOStatusReader.parseEvent(#"42["status",{"state":"idle","sensors":{"w":1.2}}]"#)
        XCTAssertEqual(parsed?.name, "status")
        XCTAssertEqual((parsed?.data["state"] as? String), "idle")
    }

    func testParseSocketIOEventRejectsNonArray() {
        XCTAssertNil(SocketIOStatusReader.parseEvent("40{\"sid\":\"x\"}"))
        XCTAssertNil(SocketIOStatusReader.parseEvent("3"))
    }
}
