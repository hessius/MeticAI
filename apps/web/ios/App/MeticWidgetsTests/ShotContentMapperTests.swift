import XCTest

final class ShotContentMapperTests: XCTestCase {
    func testContentStateCodableRoundTrip() throws {
        let state = ShotActivityAttributes.ContentState(
            phase: .extracting,
            currentWeightG: 18.2,
            pressureBar: 8.9,
            flowGs: 2.1,
            elapsedSec: 14,
            graph: [ShotGraphSample(t: 0, p: 1, f: 0, w: 0),
                    ShotGraphSample(t: 1, p: 6, f: 1.2, w: 2)]
        )
        let data = try JSONEncoder().encode(state)
        let back = try JSONDecoder().decode(ShotActivityAttributes.ContentState.self, from: data)
        XCTAssertEqual(back.phase, .extracting)
        XCTAssertEqual(back.graph.count, 2)
        XCTAssertEqual(back.pressureBar, 8.9)
    }
}

extension ShotContentMapperTests {
    func testPhaseFromExtractingFrame() {
        let frame = ShotFrame(status: [
            "name": "Extraction", "extracting": true,
            "sensors": ["p": 8.5, "f": 2.0, "w": 12.3, "t": 92.1],
            "time": 9000
        ])
        XCTAssertEqual(frame?.phase, .extracting)
        XCTAssertEqual(frame?.pressureBar, 8.5)
        XCTAssertEqual(frame?.weightG, 12.3)
        XCTAssertEqual(frame?.elapsedSec ?? 0, 9.0, accuracy: 0.001)
    }

    func testPhaseReadyFromClickToStart() {
        let frame = ShotFrame(status: ["name": "click to start", "extracting": false])
        XCTAssertEqual(frame?.phase, .ready)
    }

    func testPhaseHeatingFromHeating() {
        let frame = ShotFrame(status: ["name": "heating", "extracting": false])
        XCTAssertEqual(frame?.phase, .heating)
    }

    func testTemperaturesMergeChamberAndHead() {
        var frame = ShotFrame(status: ["name": "heating", "extracting": false])!
        frame.applyTemperatures(["t_bar_down": 84.0, "t_bar_up": 88.5])
        XCTAssertEqual(frame.chamberTempC, 84.0)
        XCTAssertEqual(frame.headTempC, 88.5)
    }
}

extension ShotContentMapperTests {
    func testBuildExtractingContentState() {
        var frame = ShotFrame(status: [
            "name": "Extraction", "extracting": true,
            "sensors": ["p": 9.0, "f": 2.2, "w": 18.0, "t": 92.0], "time": 20000
        ])!
        var buf = ShotGraphBuffer()
        buf.append(t: 20, p: 9, f: 2.2, w: 18)
        let state = ShotContentBuilder.state(from: frame, graph: buf,
                                             doseG: 18, tempSamples: [92, 93])
        XCTAssertEqual(state.phase, .extracting)
        XCTAssertEqual(state.currentWeightG, 18.0)
        XCTAssertEqual(state.graph.count, 1)
    }

    func testSummaryComputesRatioAndAvgTemp() {
        let summary = ShotContentBuilder.summary(
            finalWeightG: 36.0, finalTimeSec: 28.0, doseG: 18.0, tempSamples: [92, 94]
        )
        XCTAssertEqual(summary.ratio!, 2.0, accuracy: 0.001)
        XCTAssertEqual(summary.avgTempC!, 93.0, accuracy: 0.001)
    }

    func testSummaryNilRatioWithoutDose() {
        let summary = ShotContentBuilder.summary(
            finalWeightG: 36.0, finalTimeSec: 28.0, doseG: nil, tempSamples: []
        )
        XCTAssertNil(summary.ratio)
        XCTAssertNil(summary.avgTempC)
    }
}
