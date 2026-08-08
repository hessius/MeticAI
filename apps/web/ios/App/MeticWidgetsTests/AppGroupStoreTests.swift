import XCTest

final class AppGroupStoreTests: XCTestCase {
    func testFavouriteRoundTrips() throws {
        let fav = Favourite(id: "a", name: "Alpha", targetTempC: 93, targetWeightG: 36, imageFilename: "a.png")
        let data = try JSONEncoder().encode([fav])
        let decoded = try JSONDecoder().decode([Favourite].self, from: data)
        XCTAssertEqual(decoded.first?.id, "a")
        XCTAssertEqual(decoded.first?.targetWeightG, 36)
        XCTAssertEqual(decoded.first?.imageFilename, "a.png")
    }

    func testDecodesFavouriteWithoutOptionalFields() throws {
        let json = Data(#"[{"id":"b","name":"Bravo"}]"#.utf8)
        let decoded = try JSONDecoder().decode([Favourite].self, from: json)
        XCTAssertEqual(decoded.first?.name, "Bravo")
        XCTAssertNil(decoded.first?.targetTempC)
        XCTAssertNil(decoded.first?.imageFilename)
    }

    func testStoreReadsFromInjectedDefaults() throws {
        let suite = "test.suite.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let favs = [Favourite(id: "x", name: "Xray")]
        defaults.set(try JSONEncoder().encode(favs), forKey: AppGroup.Keys.favourites)
        defaults.set("http://machine.local:8080", forKey: AppGroup.Keys.machineURL)
        defaults.set(true, forKey: AppGroup.Keys.openAppOnStart)
        defaults.set(AppGroup.schemaVersion, forKey: AppGroup.Keys.schemaVersion)

        let store = AppGroupStore(defaults: defaults, containerURL: nil)
        XCTAssertEqual(store.favourites().first?.name, "Xray")
        XCTAssertEqual(store.machineURL()?.absoluteString, "http://machine.local:8080")
        XCTAssertTrue(store.openAppOnStart())
        XCTAssertTrue(store.isSchemaCompatible())
    }

    func testMachineStateMapping() {
        XCTAssertEqual(MachineState(raw: "idle"), .idle)
        XCTAssertEqual(MachineState(raw: "brewing"), .brewing)
        XCTAssertEqual(MachineState(raw: "extracting"), .brewing)
        XCTAssertEqual(MachineState(raw: "preheating"), .heating)
        XCTAssertEqual(MachineState(raw: "ready"), .ready)
        XCTAssertEqual(MachineState(raw: "wat"), .unknown)
        XCTAssertTrue(MachineState(raw: "brewing").isBrewing)
    }
}
