import XCTest

final class ShotGraphBufferTests: XCTestCase {
    func testDownsampleCapsAtThirty() {
        var buf = ShotGraphBuffer(maxPoints: 30)
        for i in 0..<300 {
            buf.append(t: Double(i) * 0.1, p: Double(i % 10), f: 1, w: Double(i) * 0.1)
        }
        let out = buf.downsampled()
        XCTAssertLessThanOrEqual(out.count, 30)
        XCTAssertGreaterThan(out.count, 1)
    }

    func testDownsampleKeepsFirstAndLast() {
        var buf = ShotGraphBuffer(maxPoints: 30)
        for i in 0..<100 { buf.append(t: Double(i), p: 1, f: 1, w: Double(i)) }
        let out = buf.downsampled()
        XCTAssertEqual(out.first?.t, 0)
        XCTAssertEqual(out.last?.w, 99)
    }

    func testEncodedStateStaysUnderFourKB() throws {
        var buf = ShotGraphBuffer(maxPoints: 30)
        for i in 0..<500 { buf.append(t: Double(i) * 0.05, p: 9.123, f: 2.345, w: Double(i) * 0.07) }
        let state = ShotActivityAttributes.ContentState(phase: .extracting, graph: buf.downsampled())
        let data = try JSONEncoder().encode(state)
        XCTAssertLessThan(data.count, 4096)
    }
}
