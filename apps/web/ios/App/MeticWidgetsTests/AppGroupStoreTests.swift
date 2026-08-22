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
        XCTAssertEqual(MachineState(raw: "espresso"), .brewing)
        XCTAssertEqual(MachineState(raw: "preheating"), .preheating)
        XCTAssertEqual(MachineState(raw: "heating"), .heating)
        XCTAssertEqual(MachineState(raw: "click to start"), .ready)
        XCTAssertEqual(MachineState(raw: "Pour water..."), .pourWater)
        XCTAssertEqual(MachineState(raw: "wat"), .unknown)
        // Brewing is driven by the `extracting` flag, mirroring the app — a
        // heating state with extracting=true is still Brewing, and a brew-ish
        // name without extracting is not.
        XCTAssertEqual(MachineState(raw: "heating", extracting: true), .brewing)
        XCTAssertEqual(MachineState(raw: "preheating", extracting: false), .preheating)
        XCTAssertTrue(MachineState(raw: "anything", extracting: true).isBrewing)
        XCTAssertEqual(MachineState(raw: "heating").label, "Heating")
    }

    // MARK: - Snapshot overlay lifecycle

    private func freshDefaults() -> (UserDefaults, String) {
        let suite = "test.suite.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suite)!, suite)
    }

    func testShowSnapshotIsActiveWithinWindowAndExpires() {
        let (defaults, suite) = freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }

        let writer = AppGroupWriter(defaults: defaults)
        let store = AppGroupStore(defaults: defaults, containerURL: nil)
        let now = Date()
        let snap = MachineSnapshot(state: .brewing, loadedProfileName: "SPHE-50",
                                   currentTempC: 92, targetTempC: 90,
                                   currentWeightG: 18, targetWeightG: 50)
        writer.showSnapshot(snap, for: 10, now: now)

        XCTAssertEqual(store.activeSnapshot(now: now.addingTimeInterval(2)), snap)
        XCTAssertNil(store.activeSnapshot(now: now.addingTimeInterval(11)))
    }

    func testClearSnapshotDismissesImmediately() {
        let (defaults, suite) = freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }

        let writer = AppGroupWriter(defaults: defaults)
        let store = AppGroupStore(defaults: defaults, containerURL: nil)
        let now = Date()
        writer.showSnapshot(MachineSnapshot(state: .brewing, loadedProfileName: nil,
                                            currentTempC: nil, targetTempC: nil,
                                            currentWeightG: nil, targetWeightG: nil),
                            for: 10, now: now)
        writer.clearSnapshot()
        XCTAssertNil(store.activeSnapshot(now: now))
    }

    func testRecordActionRoundTripsAndFreshnessWindow() {
        let (defaults, suite) = freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }

        let writer = AppGroupWriter(defaults: defaults)
        let store = AppGroupStore(defaults: defaults, containerURL: nil)
        let now = Date()
        writer.recordAction(.error, message: "Machine unreachable", now: now)

        let fb = store.lastActionFeedback()
        XCTAssertEqual(fb?.kind, .error)
        XCTAssertEqual(fb?.message, "Machine unreachable")
        XCTAssertTrue(fb?.isFresh(now: now.addingTimeInterval(1)) ?? false)
        XCTAssertFalse(fb?.isFresh(now: now.addingTimeInterval(3)) ?? true)
    }

    func testRecordActionClearsStaleMessage() {
        let (defaults, suite) = freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }

        let writer = AppGroupWriter(defaults: defaults)
        let store = AppGroupStore(defaults: defaults, containerURL: nil)
        writer.recordAction(.error, message: "boom", now: Date())
        writer.recordAction(.start, message: nil, now: Date())
        XCTAssertEqual(store.lastActionFeedback()?.kind, .start)
        XCTAssertNil(store.lastActionFeedback()?.message)
    }
}

extension AppGroupStoreTests {
    func testGlanceableConfigRoundTrip() {
        let suite = "test.glanceable.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let writer = AppGroupWriter(defaults: defaults)
        writer.setGlanceableConfig(GlanceableConfig(shot: .pressure, heating: .estimatedTime))

        let store = AppGroupStore(defaults: defaults, containerURL: nil)
        let cfg = store.glanceableConfig()
        XCTAssertEqual(cfg.shot, .pressure)
        XCTAssertEqual(cfg.heating, .estimatedTime)
    }

    func testGlanceableConfigDefaults() {
        let suite = "test.glanceable.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let cfg = AppGroupStore(defaults: defaults, containerURL: nil).glanceableConfig()
        XCTAssertEqual(cfg.shot, .weight)
        XCTAssertEqual(cfg.heating, .temp)
    }
}
