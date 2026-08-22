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
