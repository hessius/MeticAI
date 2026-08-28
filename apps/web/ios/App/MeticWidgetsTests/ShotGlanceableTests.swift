import XCTest

final class ShotGlanceableTests: XCTestCase {
    func testEtaZeroWhenAtCutoff() {
        XCTAssertEqual(estimateTimeToReady(current: 92, target: 93, cutoff: 92), 0)
    }

    func testEtaPositiveWhenCold() {
        let eta = estimateTimeToReady(current: 40, target: 93, cutoff: 92)
        XCTAssertNotNil(eta)
        XCTAssertGreaterThan(eta!, 0)
        XCTAssertLessThanOrEqual(eta!, 900)
    }

    func testEtaNilForDegenerate() {
        XCTAssertNil(estimateTimeToReady(current: .nan, target: 93, cutoff: 92))
    }

    func testWeightGlanceableWithTarget() {
        let s = ShotGlanceable.text(.weight, current: 20.0, target: 36.0)
        XCTAssertEqual(s, "20/36g")
    }

    func testWeightGlanceableNoTarget() {
        XCTAssertEqual(ShotGlanceable.text(.weight, current: 20.4, target: nil), "20g")
    }

    func testPressureGlanceable() {
        XCTAssertEqual(ShotGlanceable.text(.pressure, current: 8.94, target: nil), "8.9 bar")
    }

    func testEtaFormat() {
        XCTAssertEqual(ShotGlanceable.formatETA(95), "~1:35")
        XCTAssertEqual(ShotGlanceable.formatETA(5), "~0:05")
    }
}
