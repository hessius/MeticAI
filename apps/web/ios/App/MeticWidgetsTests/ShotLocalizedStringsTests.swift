import XCTest

final class ShotLocalizedStringsTests: XCTestCase {
    func testDefaultsAreEnglish() {
        let s = ShotLocalizedStrings()
        XCTAssertEqual(s.brewChamber, "Brew Chamber")
        XCTAssertEqual(s.ready, "Ready")
        XCTAssertFalse(s.resumeHint.isEmpty)
    }

    func testAttributesCarryLocalizedStrings() throws {
        let strings = ShotLocalizedStrings(
            brewChamber: "Bryggkammare",
            brewHead: "Brygghuvud",
            ready: "Klar",
            resumeHint: "Öppna Metic")
        let attr = ShotActivityAttributes(
            profileName: "Test",
            targetWeightG: 36,
            setTempC: 93,
            readyCutoffC: 91.5,
            shotGlanceable: .weight,
            heatingGlanceable: .temp,
            strings: strings)
        // Encode/decode the whole attributes to lock the schema used by the
        // widget extension (it must survive JSON round-tripping via ActivityKit).
        let data = try JSONEncoder().encode(attr)
        let back = try JSONDecoder().decode(ShotActivityAttributes.self, from: data)
        XCTAssertEqual(back.strings.brewChamber, "Bryggkammare")
        XCTAssertEqual(back.strings.ready, "Klar")
        XCTAssertEqual(back.strings.resumeHint, "Öppna Metic")
    }

    func testAttributesDefaultStringsWhenOmitted() {
        // The strings arg defaults so existing call sites / older code compile
        // and get English fallbacks.
        let attr = ShotActivityAttributes(
            profileName: "Test",
            targetWeightG: nil,
            setTempC: nil,
            readyCutoffC: nil,
            shotGlanceable: .weight,
            heatingGlanceable: .temp)
        XCTAssertEqual(attr.strings.start, "Start")
    }
}
