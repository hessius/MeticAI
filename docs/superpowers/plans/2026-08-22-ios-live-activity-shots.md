# iOS Live Activity for Espresso Shots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an iOS 17+ Live Activity (Lock Screen + Dynamic Island) that mirrors the in-app Live View for a shot — two-stage heating, a Start button, live pressure/flow/weight graph, and a summary — updating live while the phone is locked.

**Architecture:** JS (WKWebView) owns only the *lifecycle* (start/stop + static config) via a new `LiveActivity` Capacitor plugin. Native drives all live `Activity.update()` calls from a persistent Socket.IO `ShotStreamer`, held alive during the shot by a `beginBackgroundTask` assertion. Pure domain logic (phase derivation, frame→ContentState mapping, glanceable formatting, graph downsampling, summary, heating ETA) lives in `MeticKit` and is unit-tested; ActivityKit UI and the plugin are native and build-verified.

**Tech Stack:** Swift 6 / SwiftUI / ActivityKit / WidgetKit / AppIntents (iOS 17+), Capacitor 8 plugin bridge, React + TypeScript + react-i18next + Vitest (web).

**Spec:** `docs/superpowers/specs/2026-08-22-ios-live-activity-shots-design.md`

---

## Conventions (apply to every task)

- **Commits:** Conventional Commits, always append trailer:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
- **i18n:** every user-facing web string via `t()`, added to all 6 locales (`en, sv, de, es, fr, it`) under `apps/web/public/locales/<loc>/translation.json`.
- **Web test/build commands** (run from `apps/web`):
  - Test one file: `bunx vitest run src/<path>.test.tsx --reporter=dot`
  - Typecheck: `bunx tsc --noEmit`
  - Lint: `bunx eslint <path>`
- **Swift test command** (run from `apps/web/ios/App`):
  ```
  GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild test -scheme MeticWidgetsTests \
    -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
  ```
  (Requires `git config --global safe.bareRepository all` once — SPM cache repos are bare.)
- **Swift build check** (compiles app + widget targets, run from `apps/web/ios/App`):
  ```
  GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
    -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
  ```
- **Adding a Swift file to Xcode targets** — use the helper script created in Task 0 (`scripts/ios-add-file.rb`). Never hand-edit `project.pbxproj`. Note: the `xcodeproj` gem reformats `project.pbxproj` on save (e.g. collapses the `ShareExtension` synchronized-group block onto one line). That reformat is functionally valid — Xcode re-expands it — so commit it as-is. **Before running the script the first time, verify `git diff project.pbxproj` shows no unrelated pre-existing edits (e.g. a stray `CURRENT_PROJECT_VERSION` bump); if it does, `git checkout -- project.pbxproj` first.**
- **Simulator destination:** `name=iPhone 16 Pro` normally resolves, but if xcodebuild prints the destination list instead of running, target the booted sim by UDID: `xcrun simctl list devices booted` → use `-destination 'platform=iOS Simulator,id=<UDID>'`.

---

## File Structure

**Native — new files (`apps/web/ios/App/`):**
- `MeticKit/ShotActivityAttributes.swift` — `ActivityAttributes` + `ContentState`, glanceable enums, shared by app + widget + tests.
- `MeticKit/ShotContentMapper.swift` — pure: raw status dict → `ShotFrame` → `ContentState`, phase derivation, summary.
- `MeticKit/ShotGlanceable.swift` — pure: glanceable formatting + heating ETA (Swift port of `estimateTimeToReady`).
- `MeticKit/ShotGraphBuffer.swift` — pure: rolling 3-series buffer + downsample to ≤30 points.
- `MeticKit/ShotStreamer.swift` — persistent Socket.IO status stream (extends the one-shot reader pattern).
- `App/ShotActivityController.swift` — owns the `Activity`, background-task assertion, wires streamer→mapper→update.
- `App/LiveActivityPlugin.swift` — Capacitor bridge (`isSupported/areActivitiesEnabled/start/updateConfig/stop`).
- `MeticWidgets/ShotLiveActivity.swift` — `ActivityConfiguration`, Lock Screen view, Dynamic Island.
- `MeticWidgets/Intents/StartShotIntent.swift` — Ready-state Start button App Intent.
- `MeticWidgetsTests/ShotContentMapperTests.swift`, `ShotGlanceableTests.swift`, `ShotGraphBufferTests.swift`, `ShotStreamerTests.swift` — Swift unit tests.

**Native — modified:**
- `MeticKit/AppGroup.swift` — add glanceable-config keys + `GlanceableConfig` read/write; bump `schemaVersion` to 2.
- `MeticWidgets/MeticWidgetsBundle.swift` — register `ShotLiveActivity()`.
- `App/App/MeticulousViewController.swift` — register `LiveActivityPlugin`.
- `App/App/Info.plist` + `MeticWidgets/Info.plist` — `NSSupportsLiveActivities = true`.

**Web — new files (`apps/web/src/`):**
- `services/liveActivity/liveActivityBridge.ts` — typed `registerPlugin` wrapper + no-op web fallback.
- `services/liveActivity/deriveLiveActivityCommand.ts` — pure lifecycle transition helper.
- `hooks/useLiveActivitySync.ts` — native-gated hook wiring machine state → plugin.
- `components/settings/LiveActivitySettings.tsx` — native-only settings block.
- Tests colocated: `deriveLiveActivityCommand.test.ts`, `LiveActivitySettings.test.tsx`.

**Web — modified:**
- `components/LiveShotView/HeatingNumbers.tsx` + `.test.tsx` — remove red target marker.
- `components/LiveShotView.tsx` — mount `useLiveActivitySync`.
- Settings screen — mount `LiveActivitySettings`.
- 6 × `translation.json` — new keys under `liveActivity`.

---

## Task 0: Xcode file-adder helper + committed test scheme

**Files:**
- Create: `apps/web/ios/App/scripts/ios-add-file.rb`
- Already created (commit it): `apps/web/ios/App/App.xcodeproj/xcshareddata/xcschemes/MeticWidgetsTests.xcscheme`

- [ ] **Step 1: Write the file-adder helper**

Create `apps/web/ios/App/scripts/ios-add-file.rb`:

```ruby
#!/usr/bin/env ruby
# Adds a source file to one or more Xcode targets by name, idempotently.
# Usage: ruby scripts/ios-add-file.rb <relative/path/to/File.swift> Target1 [Target2 ...]
require 'xcodeproj'

path = ARGV[0]
target_names = ARGV[1..]
abort "usage: ios-add-file.rb <path> <target...>" if path.nil? || target_names.empty?

proj_dir = File.expand_path(File.join(__dir__, '..'))
project = Xcodeproj::Project.open(File.join(proj_dir, 'App.xcodeproj'))

# Find or create a file reference under the group matching the file's directory.
abs = File.join(proj_dir, path)
group_path = File.dirname(path)
group = project.main_group
group_path.split('/').each { |seg| group = group[seg] || group.new_group(seg, seg) }
ref = group.files.find { |f| f.real_path.to_s == abs } || group.new_reference(abs)

target_names.each do |name|
  target = project.targets.find { |t| t.name == name }
  abort "target not found: #{name}" unless target
  already = target.source_build_phase.files.any? { |bf| bf.file_ref == ref }
  target.add_file_references([ref]) unless already
  puts "#{already ? 'exists' : 'added'}: #{path} -> #{name}"
end

project.save
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x apps/web/ios/App/scripts/ios-add-file.rb`

- [ ] **Step 3: Verify the test scheme runs the existing suite**

Run (from `apps/web/ios/App`):
```
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild test -scheme MeticWidgetsTests \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```
Expected: `** TEST SUCCEEDED **`, 18 existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/scripts/ios-add-file.rb \
        apps/web/ios/App/App.xcodeproj/xcshareddata/xcschemes/MeticWidgetsTests.xcscheme
git commit -m "chore(ios): add scriptable Xcode file-adder and shared widget test scheme

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 1: Remove the red target marker from heating bars (both web runtimes)

**Files:**
- Modify: `apps/web/src/components/LiveShotView/HeatingNumbers.tsx`
- Test: `apps/web/src/components/LiveShotView/HeatingNumbers.test.tsx`

- [ ] **Step 1: Update the test to assert the marker is gone**

In `HeatingNumbers.test.tsx`, replace the `renders a red target marker per sensor` test with:

```tsx
  it('renders no target marker (plain progress bars)', () => {
    render(<HeatingNumbers chamberTemp={91.2} headTemp={88.4} setTemp={93} lanceReadyCutoff={92} />)

    expect(screen.queryAllByTestId('target-marker')).toHaveLength(0)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/components/LiveShotView/HeatingNumbers.test.tsx --reporter=dot`
Expected: FAIL — the marker div still renders 2 elements.

- [ ] **Step 3: Remove the marker element and its constant**

In `HeatingNumbers.tsx` delete the `TARGET_COLOR` constant:

```tsx
// Red target marker, consistent with the chart's "Target" line.
const TARGET_COLOR = 'var(--destructive)'
```

and delete the marker `div` inside the bar (leaving the bar container + filled bar):

```tsx
        {/* Red target marker at the right edge (set temperature). */}
        <div
          data-testid="target-marker"
          className="absolute top-0 h-full w-0.5"
          style={{ right: 0, backgroundColor: TARGET_COLOR }}
        />
```

- [ ] **Step 4: Run the test + typecheck**

Run: `bunx vitest run src/components/LiveShotView/HeatingNumbers.test.tsx --reporter=dot && bunx tsc --noEmit`
Expected: PASS, no type errors (the `relative` bar container may now have no children — that is valid).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/LiveShotView/HeatingNumbers.tsx \
        apps/web/src/components/LiveShotView/HeatingNumbers.test.tsx
git commit -m "refactor(live-view): remove red target marker from heating bars

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: ShotActivityAttributes + ContentState + glanceable enums

**Files:**
- Create: `apps/web/ios/App/MeticKit/ShotActivityAttributes.swift`
- Test: `apps/web/ios/App/MeticWidgetsTests/ShotContentMapperTests.swift` (created here, extended later)

- [ ] **Step 1: Write the attributes/state types**

Create `MeticKit/ShotActivityAttributes.swift`:

```swift
import Foundation
import ActivityKit

/// Which single stat is surfaced as the Dynamic Island / compact glanceable.
public enum ShotGlanceableStat: String, Codable, CaseIterable {
    case weight, pressure, flow, temp
}

/// What the heating-phase glanceable shows.
public enum HeatingGlanceableStat: String, Codable, CaseIterable {
    case temp, estimatedTime
}

/// Lifecycle phase of the shot Live Activity.
public enum ShotPhase: String, Codable {
    case heating, ready, extracting, done
}

/// A single downsampled graph sample (pressure/flow/weight) at an elapsed time.
public struct ShotGraphSample: Codable, Equatable {
    public let t: Double   // seconds since extraction start
    public let p: Double   // pressure (bar)
    public let f: Double   // flow (g/s)
    public let w: Double   // weight (g)
    public init(t: Double, p: Double, f: Double, w: Double) {
        self.t = t; self.p = p; self.f = f; self.w = w
    }
}

public struct ShotActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var phase: ShotPhase
        public var chamberTempC: Double?
        public var headTempC: Double?
        public var brewTempC: Double?
        public var currentWeightG: Double?
        public var pressureBar: Double?
        public var flowGs: Double?
        public var elapsedSec: Double?
        public var etaSec: Double?
        public var graph: [ShotGraphSample]
        // Summary (populated only in `.done`).
        public var finalWeightG: Double?
        public var finalTimeSec: Double?
        public var ratio: Double?
        public var avgTempC: Double?

        public init(
            phase: ShotPhase,
            chamberTempC: Double? = nil,
            headTempC: Double? = nil,
            brewTempC: Double? = nil,
            currentWeightG: Double? = nil,
            pressureBar: Double? = nil,
            flowGs: Double? = nil,
            elapsedSec: Double? = nil,
            etaSec: Double? = nil,
            graph: [ShotGraphSample] = [],
            finalWeightG: Double? = nil,
            finalTimeSec: Double? = nil,
            ratio: Double? = nil,
            avgTempC: Double? = nil
        ) {
            self.phase = phase
            self.chamberTempC = chamberTempC
            self.headTempC = headTempC
            self.brewTempC = brewTempC
            self.currentWeightG = currentWeightG
            self.pressureBar = pressureBar
            self.flowGs = flowGs
            self.elapsedSec = elapsedSec
            self.etaSec = etaSec
            self.graph = graph
            self.finalWeightG = finalWeightG
            self.finalTimeSec = finalTimeSec
            self.ratio = ratio
            self.avgTempC = avgTempC
        }
    }

    // Static attributes (fixed for the activity's life).
    public let profileName: String
    public let targetWeightG: Double?
    public let setTempC: Double?
    public let readyCutoffC: Double?
    public let shotGlanceable: ShotGlanceableStat
    public let heatingGlanceable: HeatingGlanceableStat

    public init(
        profileName: String,
        targetWeightG: Double?,
        setTempC: Double?,
        readyCutoffC: Double?,
        shotGlanceable: ShotGlanceableStat,
        heatingGlanceable: HeatingGlanceableStat
    ) {
        self.profileName = profileName
        self.targetWeightG = targetWeightG
        self.setTempC = setTempC
        self.readyCutoffC = readyCutoffC
        self.shotGlanceable = shotGlanceable
        self.heatingGlanceable = heatingGlanceable
    }
}
```

- [ ] **Step 2: Add the file to the widget, app, and test targets**

Run (from `apps/web/ios/App`):
```
ruby scripts/ios-add-file.rb MeticKit/ShotActivityAttributes.swift Metic MeticWidgets MeticWidgetsTests
```
Expected: `added: ... -> Metic`, `-> MeticWidgets`, `-> MeticWidgetsTests`.

- [ ] **Step 3: Write a round-trip Codable test**

Create `MeticWidgetsTests/ShotContentMapperTests.swift`:

```swift
import XCTest
@testable import MeticWidgetsTests

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
```

> Note: The test bundle has no module wrapper for MeticKit sources (they compile directly into the test target), so `@testable import MeticWidgetsTests` exposes them. If the compiler reports the import is unused/invalid, drop the import line — the existing `MachineClientTests.swift` has no import and references the types directly. Follow whichever the existing tests do.

- [ ] **Step 4: Add the test file to the test target and run**

Run (from `apps/web/ios/App`):
```
ruby scripts/ios-add-file.rb MeticWidgetsTests/ShotContentMapperTests.swift MeticWidgetsTests
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild test -scheme MeticWidgetsTests \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```
Expected: `** TEST SUCCEEDED **`, new test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/ios/App/MeticKit/ShotActivityAttributes.swift \
        apps/web/ios/App/MeticWidgetsTests/ShotContentMapperTests.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): add ShotActivityAttributes + ContentState for Live Activity

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: ShotContentMapper — frame parsing + phase derivation

The machine's Socket.IO `status` frame is a dict with keys observed in `DemoAdapter.ts`:
`name`/`state` (string), `extracting` (bool), `sensors.{p,f,w,t,g}`, `time` (ms elapsed),
`setpoints.{temperature,pressure,flow}`, `loaded_profile`, `id`. Separate `temperatures`
frames carry `t_bar_up` (brew head) and `t_bar_down` (brew chamber) during heating.

**Files:**
- Create: `apps/web/ios/App/MeticKit/ShotContentMapper.swift`
- Test: `apps/web/ios/App/MeticWidgetsTests/ShotContentMapperTests.swift` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `ShotContentMapperTests.swift`:

```swift
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
```

- [ ] **Step 2: Run to verify failure**

Run (from `apps/web/ios/App`):
```
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild test -scheme MeticWidgetsTests \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```
Expected: compile failure — `ShotFrame` undefined.

- [ ] **Step 3: Implement `ShotFrame` + phase mapping**

Create `MeticKit/ShotContentMapper.swift`:

```swift
import Foundation

/// A single decoded telemetry frame from the machine's Socket.IO `status`
/// (optionally merged with a `temperatures` frame). Pure value type.
public struct ShotFrame {
    public var phase: ShotPhase
    public var pressureBar: Double?
    public var flowGs: Double?
    public var weightG: Double?
    public var brewTempC: Double?
    public var chamberTempC: Double?
    public var headTempC: Double?
    public var elapsedSec: Double?

    public init?(status: [String: Any]) {
        let rawState = (status["name"] as? String) ?? (status["state"] as? String)
        let extracting = (status["extracting"] as? NSNumber)?.boolValue
            ?? (status["extracting"] as? Bool) ?? false
        let machineState = MachineState(raw: rawState, extracting: extracting)
        self.phase = ShotFrame.phase(for: machineState)
        let sensors = status["sensors"] as? [String: Any]
        self.pressureBar = (sensors?["p"] as? NSNumber)?.doubleValue
        self.flowGs = (sensors?["f"] as? NSNumber)?.doubleValue
        self.weightG = (sensors?["w"] as? NSNumber)?.doubleValue
        self.brewTempC = (sensors?["t"] as? NSNumber)?.doubleValue
        if let ms = (status["time"] as? NSNumber)?.doubleValue {
            self.elapsedSec = ms / 1000.0
        }
    }

    /// Merge a machine `temperatures` frame (heating two-stage bars).
    public mutating func applyTemperatures(_ temps: [String: Any]) {
        if let d = (temps["t_bar_down"] as? NSNumber)?.doubleValue { chamberTempC = d }
        if let u = (temps["t_bar_up"] as? NSNumber)?.doubleValue { headTempC = u }
    }

    static func phase(for state: MachineState) -> ShotPhase {
        switch state {
        case .brewing: return .extracting
        case .ready: return .ready
        default: return .heating
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run the same `xcodebuild test` command. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Add file to targets + commit**

```bash
cd apps/web/ios/App
ruby scripts/ios-add-file.rb MeticKit/ShotContentMapper.swift Metic MeticWidgets MeticWidgetsTests
cd -
git add apps/web/ios/App/MeticKit/ShotContentMapper.swift \
        apps/web/ios/App/MeticWidgetsTests/ShotContentMapperTests.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): parse machine frames into ShotFrame with phase derivation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: ShotGraphBuffer — rolling 3-series buffer + downsample (<4 KB)

**Files:**
- Create: `apps/web/ios/App/MeticKit/ShotGraphBuffer.swift`
- Test: `apps/web/ios/App/MeticWidgetsTests/ShotGraphBufferTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `MeticWidgetsTests/ShotGraphBufferTests.swift`:

```swift
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
```

- [ ] **Step 2: Run to verify failure**

Run the `xcodebuild test` command. Expected: compile failure — `ShotGraphBuffer` undefined.

- [ ] **Step 3: Implement the buffer**

Create `MeticKit/ShotGraphBuffer.swift`:

```swift
import Foundation

/// Accumulates raw graph samples and downsamples to at most `maxPoints`,
/// always retaining the first and last sample. Keeps the encoded
/// `ContentState` comfortably under ActivityKit's ~4 KB budget.
public struct ShotGraphBuffer {
    private var samples: [ShotGraphSample] = []
    private let maxPoints: Int

    public init(maxPoints: Int = 30) {
        self.maxPoints = max(2, maxPoints)
    }

    public mutating func append(t: Double, p: Double, f: Double, w: Double) {
        samples.append(ShotGraphSample(
            t: (t * 100).rounded() / 100,
            p: (p * 100).rounded() / 100,
            f: (f * 100).rounded() / 100,
            w: (w * 100).rounded() / 100
        ))
    }

    public var count: Int { samples.count }

    /// Uniformly stride the samples down to `maxPoints`, preserving endpoints.
    public func downsampled() -> [ShotGraphSample] {
        guard samples.count > maxPoints else { return samples }
        var out: [ShotGraphSample] = []
        let step = Double(samples.count - 1) / Double(maxPoints - 1)
        for i in 0..<maxPoints {
            out.append(samples[Int((Double(i) * step).rounded())])
        }
        return out
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run the `xcodebuild test` command. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Add file to targets + commit**

```bash
cd apps/web/ios/App
ruby scripts/ios-add-file.rb MeticKit/ShotGraphBuffer.swift Metic MeticWidgets MeticWidgetsTests
ruby scripts/ios-add-file.rb MeticWidgetsTests/ShotGraphBufferTests.swift MeticWidgetsTests
cd -
git add apps/web/ios/App/MeticKit/ShotGraphBuffer.swift \
        apps/web/ios/App/MeticWidgetsTests/ShotGraphBufferTests.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): add downsampling graph buffer for Live Activity (<4KB state)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: ShotGlanceable — heating ETA (Swift port) + glanceable formatting

Ports `estimateTimeToReady.ts` verbatim (same Newtonian model) plus the string
formatting used by the compact/minimal Dynamic Island and Lock Screen glanceable.

**Files:**
- Create: `apps/web/ios/App/MeticKit/ShotGlanceable.swift`
- Test: `apps/web/ios/App/MeticWidgetsTests/ShotGlanceableTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `MeticWidgetsTests/ShotGlanceableTests.swift`:

```swift
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
```

- [ ] **Step 2: Run to verify failure**

Run the `xcodebuild test` command. Expected: compile failure — symbols undefined.

- [ ] **Step 3: Implement the port + formatting**

Create `MeticKit/ShotGlanceable.swift`:

```swift
import Foundation

/// Swift port of `estimateTimeToReady.ts` — a Newtonian (exponential-approach)
/// heating model with a fixed rate constant calibrated to observed behaviour.
/// Returns nil for degenerate inputs, 0 when already at/above cutoff.
public func estimateTimeToReady(
    current: Double,
    target: Double,
    cutoff: Double,
    ambient: Double = 20,
    coldStartSeconds: Double = 210,
    maxSeconds: Double = 900
) -> Double? {
    guard current.isFinite, target.isFinite, cutoff.isFinite else { return nil }
    if target <= cutoff { return 0 }
    if current >= cutoff { return 0 }

    let readyGap = target - cutoff
    let coldGap = target - ambient
    if coldGap <= readyGap { return 0 }

    let k = log(coldGap / readyGap) / coldStartSeconds
    guard k.isFinite, k > 0 else { return nil }

    let currentGap = target - current
    if currentGap <= readyGap { return 0 }

    let remaining = log(currentGap / readyGap) / k
    guard remaining.isFinite else { return nil }
    if remaining <= 0 { return 0 }
    return min(remaining, maxSeconds)
}

public enum ShotGlanceable {
    /// Format a glanceable stat value (extraction phase).
    public static func text(_ stat: ShotGlanceableStat, current: Double?, target: Double?) -> String {
        switch stat {
        case .weight:
            let c = Int((current ?? 0).rounded())
            if let target { return "\(c)/\(Int(target.rounded()))g" }
            return "\(c)g"
        case .pressure:
            return String(format: "%.1f bar", current ?? 0)
        case .flow:
            return String(format: "%.1f g/s", current ?? 0)
        case .temp:
            return String(format: "%.0f°C", current ?? 0)
        }
    }

    /// Format an ETA in seconds as `~M:SS`.
    public static func formatETA(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "~%d:%02d", total / 60, total % 60)
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run the `xcodebuild test` command. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Add file to targets + commit**

```bash
cd apps/web/ios/App
ruby scripts/ios-add-file.rb MeticKit/ShotGlanceable.swift Metic MeticWidgets MeticWidgetsTests
ruby scripts/ios-add-file.rb MeticWidgetsTests/ShotGlanceableTests.swift MeticWidgetsTests
cd -
git add apps/web/ios/App/MeticKit/ShotGlanceable.swift \
        apps/web/ios/App/MeticWidgetsTests/ShotGlanceableTests.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): port heating ETA model + glanceable formatting to Swift

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: ContentState builder + shot summary

Assembles a `ContentState` from a `ShotFrame`, targets, and the graph buffer, and
computes the `.done` summary (final weight, time, ratio, avg temp).

**Files:**
- Modify: `apps/web/ios/App/MeticKit/ShotContentMapper.swift`
- Test: `apps/web/ios/App/MeticWidgetsTests/ShotContentMapperTests.swift` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `ShotContentMapperTests.swift`:

```swift
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
```

- [ ] **Step 2: Run to verify failure**

Run the `xcodebuild test` command. Expected: compile failure — `ShotContentBuilder` undefined.

- [ ] **Step 3: Implement the builder**

Append to `MeticKit/ShotContentMapper.swift`:

```swift
public enum ShotContentBuilder {
    public struct Summary {
        public let finalWeightG: Double?
        public let finalTimeSec: Double?
        public let ratio: Double?
        public let avgTempC: Double?
    }

    /// Build a live `ContentState` for the current phase.
    public static func state(
        from frame: ShotFrame,
        graph: ShotGraphBuffer,
        doseG: Double?,
        tempSamples: [Double]
    ) -> ShotActivityAttributes.ContentState {
        ShotActivityAttributes.ContentState(
            phase: frame.phase,
            chamberTempC: frame.chamberTempC,
            headTempC: frame.headTempC,
            brewTempC: frame.brewTempC,
            currentWeightG: frame.weightG,
            pressureBar: frame.pressureBar,
            flowGs: frame.flowGs,
            elapsedSec: frame.elapsedSec,
            graph: graph.downsampled()
        )
    }

    /// Compute the terminal summary. Ratio/avg omitted when inputs are missing.
    public static func summary(
        finalWeightG: Double?,
        finalTimeSec: Double?,
        doseG: Double?,
        tempSamples: [Double]
    ) -> Summary {
        var ratio: Double?
        if let w = finalWeightG, let d = doseG, d > 0 { ratio = w / d }
        var avg: Double?
        if !tempSamples.isEmpty {
            avg = tempSamples.reduce(0, +) / Double(tempSamples.count)
        }
        return Summary(finalWeightG: finalWeightG, finalTimeSec: finalTimeSec,
                       ratio: ratio, avgTempC: avg)
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run the `xcodebuild test` command. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/ios/App/MeticKit/ShotContentMapper.swift \
        apps/web/ios/App/MeticWidgetsTests/ShotContentMapperTests.swift
git commit -m "feat(ios): build ContentState + compute shot summary

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Extend AppGroup with GlanceableConfig + schema bump

**Files:**
- Modify: `apps/web/ios/App/MeticKit/AppGroup.swift`
- Test: `apps/web/ios/App/MeticWidgetsTests/AppGroupStoreTests.swift` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `AppGroupStoreTests.swift` (uses an isolated suite name, matching the
existing tests in that file):

```swift
extension AppGroupStoreTests {
    func testGlanceableConfigRoundTrip() {
        let suite = "test.glanceable.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let writer = AppGroupWriter(defaults: defaults)
        writer.setGlanceableConfig(GlanceableConfig(shot: .pressure, heating: .estimatedTime))

        let store = AppGroupStore(defaults: defaults, containerURL: nil)
        let cfg = store.glanceableConfig()
        XCTAssertEqual(cfg.shot, .pressure)
        XCTAssertEqual(cfg.heating, .estimatedTime)
        defaults.removePersistentDomain(forName: suite)
    }

    func testGlanceableConfigDefaults() {
        let suite = "test.glanceable.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let cfg = AppGroupStore(defaults: defaults, containerURL: nil).glanceableConfig()
        XCTAssertEqual(cfg.shot, .weight)
        XCTAssertEqual(cfg.heating, .temp)
        defaults.removePersistentDomain(forName: suite)
    }
}
```

> If `AppGroupStoreTests` does not already declare its own `AppGroupStoreTests` class (check the file header), place these as plain methods inside the existing class instead of an extension.

- [ ] **Step 2: Run to verify failure**

Run the `xcodebuild test` command. Expected: compile failure — `GlanceableConfig` / `setGlanceableConfig` undefined.

- [ ] **Step 3: Implement config type + accessors + schema bump**

In `AppGroup.swift`:

1. Bump the schema: `public static let schemaVersion = 2`.
2. Add keys inside `enum Keys`:

```swift
        // Live Activity glanceable configuration.
        public static let glanceableShot = "glanceableShot"
        public static let glanceableHeating = "glanceableHeating"
```

3. Add the config value type at file scope (after `AppGroup`):

```swift
/// User-selected glanceable stats for the shot Live Activity. Native-only.
public struct GlanceableConfig: Equatable {
    public var shot: ShotGlanceableStat
    public var heating: HeatingGlanceableStat
    public init(shot: ShotGlanceableStat = .weight, heating: HeatingGlanceableStat = .temp) {
        self.shot = shot
        self.heating = heating
    }
}
```

4. Add a reader to `AppGroupStore`:

```swift
    /// The user's glanceable configuration (defaults: weight / temp).
    public func glanceableConfig() -> GlanceableConfig {
        let shot = (defaults?.string(forKey: AppGroup.Keys.glanceableShot))
            .flatMap(ShotGlanceableStat.init(rawValue:)) ?? .weight
        let heating = (defaults?.string(forKey: AppGroup.Keys.glanceableHeating))
            .flatMap(HeatingGlanceableStat.init(rawValue:)) ?? .temp
        return GlanceableConfig(shot: shot, heating: heating)
    }
```

5. Add a writer to `AppGroupWriter`:

```swift
    /// Persist the glanceable configuration chosen in Settings.
    public func setGlanceableConfig(_ cfg: GlanceableConfig) {
        defaults?.set(cfg.shot.rawValue, forKey: AppGroup.Keys.glanceableShot)
        defaults?.set(cfg.heating.rawValue, forKey: AppGroup.Keys.glanceableHeating)
    }
```

- [ ] **Step 4: Run to verify pass**

Run the `xcodebuild test` command. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/ios/App/MeticKit/AppGroup.swift \
        apps/web/ios/App/MeticWidgetsTests/AppGroupStoreTests.swift
git commit -m "feat(ios): store Live Activity glanceable config in App Group (schema v2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: ShotStreamer — persistent Socket.IO status stream

Extends the one-shot `SocketIOStatusReader` framing into a persistent stream that
emits every `status` and `temperatures` event as an async sequence. Frame parsing
(`ShotStreamer.parseFrame`) is unit-tested; the live socket loop is exercised only
via the build check + on-device testing.

**Files:**
- Create: `apps/web/ios/App/MeticKit/ShotStreamer.swift`
- Test: `apps/web/ios/App/MeticWidgetsTests/ShotStreamerTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `MeticWidgetsTests/ShotStreamerTests.swift`:

```swift
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
```

- [ ] **Step 2: Run to verify failure**

Run the `xcodebuild test` command. Expected: compile failure — `ShotStreamer` undefined.

- [ ] **Step 3: Implement the streamer**

Create `MeticKit/ShotStreamer.swift`:

```swift
import Foundation

/// A persistent Engine.IO v4 / Socket.IO client that stays connected for the
/// duration of a shot and yields every `status` / `temperatures` event as an
/// async stream. Reuses the framing from `SocketIOStatusReader`.
public final class ShotStreamer {
    public enum Frame {
        case status([String: Any])
        case temperatures([String: Any])
    }

    private let baseURL: URL
    private let session: URLSession
    private var task: URLSessionWebSocketTask?

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Begin streaming frames. The stream finishes when `stop()` is called or
    /// the socket drops.
    public func frames() -> AsyncStream<Frame> {
        AsyncStream { continuation in
            Task { await self.run(continuation) }
            continuation.onTermination = { [weak self] _ in self?.stop() }
        }
    }

    public func stop() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func run(_ continuation: AsyncStream<Frame>.Continuation) async {
        guard var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            continuation.finish(); return
        }
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        comps.path = "/socket.io/"
        comps.queryItems = [
            URLQueryItem(name: "EIO", value: "4"),
            URLQueryItem(name: "transport", value: "websocket"),
        ]
        guard let wsURL = comps.url else { continuation.finish(); return }

        let task = session.webSocketTask(with: wsURL)
        self.task = task
        task.resume()

        do {
            while true {
                let message = try await task.receive()
                guard case let .string(text) = message else { continue }
                if text.hasPrefix("0") {
                    try await task.send(.string("40"))
                } else if text == "2" {
                    try await task.send(.string("3"))
                } else if let frame = ShotStreamer.parseFrame(text) {
                    continuation.yield(frame)
                }
            }
        } catch {
            continuation.finish()
        }
    }

    /// Parse a raw Engine.IO text frame into a `status`/`temperatures` frame,
    /// or nil for control frames and unrelated events.
    static func parseFrame(_ text: String) -> Frame? {
        guard text.hasPrefix("42"), let bracket = text.firstIndex(of: "[") else { return nil }
        let jsonPart = String(text[bracket...])
        guard let data = jsonPart.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [Any],
              arr.count >= 2,
              let name = arr[0] as? String,
              let obj = arr[1] as? [String: Any] else { return nil }
        switch name {
        case "status": return .status(obj)
        case "temperatures": return .temperatures(obj)
        default: return nil
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run the `xcodebuild test` command. Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Add file to targets + commit**

```bash
cd apps/web/ios/App
ruby scripts/ios-add-file.rb MeticKit/ShotStreamer.swift Metic MeticWidgets MeticWidgetsTests
ruby scripts/ios-add-file.rb MeticWidgetsTests/ShotStreamerTests.swift MeticWidgetsTests
cd -
git add apps/web/ios/App/MeticKit/ShotStreamer.swift \
        apps/web/ios/App/MeticWidgetsTests/ShotStreamerTests.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): add persistent Socket.IO shot streamer

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Info.plist — enable Live Activities

**Files:**
- Modify: `apps/web/ios/App/App/Info.plist`
- Modify: `apps/web/ios/App/MeticWidgets/Info.plist`

- [ ] **Step 1: Add the key to both plists**

Add inside the top-level `<dict>` of **both** files:

```xml
	<key>NSSupportsLiveActivities</key>
	<true/>
```

- [ ] **Step 2: Verify the app + widget targets still build**

Run (from `apps/web/ios/App`):
```
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/ios/App/App/Info.plist apps/web/ios/App/MeticWidgets/Info.plist
git commit -m "feat(ios): enable NSSupportsLiveActivities for app and widget

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 10: StartShotIntent — Ready-state Start button

**Files:**
- Create: `apps/web/ios/App/MeticWidgets/Intents/StartShotIntent.swift`

- [ ] **Step 1: Implement the intent (mirrors `StartProfileIntent`)**

Create `MeticWidgets/Intents/StartShotIntent.swift`:

```swift
import AppIntents
import Foundation

/// Starts the currently loaded shot from the Live Activity's Ready state.
/// The machine already has the profile loaded (the app initiated heating), so
/// this just triggers `.start`. Errors are swallowed — the live stream will
/// reflect whether extraction actually began.
struct StartShotIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Shot"

    func perform() async throws -> some IntentResult {
        if let base = AppGroupStore().machineURL() {
            _ = try? await MachineClient(baseURL: base).perform(.start)
        }
        return .result()
    }
}
```

- [ ] **Step 2: Add to widget target + build**

Run (from `apps/web/ios/App`):
```
ruby scripts/ios-add-file.rb MeticWidgets/Intents/StartShotIntent.swift MeticWidgets
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/ios/App/MeticWidgets/Intents/StartShotIntent.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): add StartShotIntent for Live Activity Ready state

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 11: ShotLiveActivity — Lock Screen view + ActivityConfiguration

Renders the Lock Screen layout (design layout C): heating two-bar readiness (plain
progress, green when reached, no red marker), Ready with Start button, extraction
sparkline + metric tiles, and a done summary. Registered as an `ActivityConfiguration`.

**Files:**
- Create: `apps/web/ios/App/MeticWidgets/ShotLiveActivity.swift`
- Modify: `apps/web/ios/App/MeticWidgets/MeticWidgetsBundle.swift`

- [ ] **Step 1: Implement the Lock Screen view + configuration**

Create `MeticWidgets/ShotLiveActivity.swift`:

```swift
import ActivityKit
import WidgetKit
import SwiftUI

private let readyGreen = Color(red: 0.20, green: 0.70, blue: 0.32)
private let brandOrange = Color(red: 0.843, green: 0.443, blue: 0)

struct ShotLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShotActivityAttributes.self) { context in
            ShotLockScreenView(attributes: context.attributes, state: context.state)
                .padding(14)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            shotDynamicIsland(context)
        }
    }
}

struct ShotLockScreenView: View {
    let attributes: ShotActivityAttributes
    let state: ShotActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(attributes.profileName).font(.headline).lineLimit(1)
                Spacer()
                Circle().fill(brandOrange).frame(width: 8, height: 8)
            }
            switch state.phase {
            case .heating: heating
            case .ready: ready
            case .extracting: extracting
            case .done: done
            }
        }
        .foregroundStyle(.white)
    }

    private var heating: some View {
        VStack(alignment: .leading, spacing: 8) {
            heatBar(label: "Brew Chamber", temp: state.chamberTempC)
            heatBar(label: "Brew Head", temp: state.headTempC)
        }
    }

    private func heatBar(label: String, temp: Double?) -> some View {
        let set = attributes.setTempC ?? 93
        let cutoff = attributes.readyCutoffC ?? (set - 1.5)
        let value = temp ?? 0
        let reached = value >= cutoff
        let progress = max(0, min(1, value / set))
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(.caption2)
                Spacer()
                Text(String(format: "%.0f°/%.0f°", value, set)).font(.caption2).monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.18))
                    Capsule().fill(reached ? readyGreen : brandOrange)
                        .frame(width: geo.size.width * progress)
                }
            }.frame(height: 6)
        }
    }

    private var ready: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Ready").font(.title3.bold()).foregroundStyle(readyGreen)
                Text(String(format: "%.0f°C", state.headTempC ?? attributes.setTempC ?? 0))
                    .font(.caption).monospacedDigit()
            }
            Spacer()
            Button(intent: StartShotIntent()) {
                Text("Start").font(.subheadline.bold())
            }
            .tint(brandOrange)
            .buttonStyle(.borderedProminent)
        }
    }

    private var extracting: some View {
        VStack(alignment: .leading, spacing: 8) {
            ShotSparkline(samples: state.graph).frame(height: 42)
            HStack(spacing: 14) {
                tile("Weight", ShotGlanceable.text(.weight,
                    current: state.currentWeightG, target: attributes.targetWeightG))
                tile("Pressure", String(format: "%.1f", state.pressureBar ?? 0))
                tile("Flow", String(format: "%.1f", state.flowGs ?? 0))
                if let e = state.elapsedSec { tile("Time", String(format: "%.0fs", e)) }
            }
        }
    }

    private var done: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Shot complete").font(.subheadline.bold())
            HStack(spacing: 14) {
                if let w = state.finalWeightG { tile("Weight", String(format: "%.1fg", w)) }
                if let t = state.finalTimeSec { tile("Time", String(format: "%.0fs", t)) }
                if let r = state.ratio { tile("Ratio", String(format: "1:%.1f", r)) }
                if let a = state.avgTempC { tile("Avg Temp", String(format: "%.0f°", a)) }
            }
        }
    }

    private func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.white.opacity(0.7))
            Text(value).font(.caption.bold()).monospacedDigit()
        }
    }
}

/// A lightweight 3-series sparkline (pressure/flow/weight), each normalised
/// independently to fill the available height.
struct ShotSparkline: View {
    let samples: [ShotGraphSample]

    var body: some View {
        GeometryReader { geo in
            ZStack {
                line(geo, \.p, .orange)
                line(geo, \.f, .cyan)
                line(geo, \.w, readyGreen)
            }
        }
    }

    private func line(_ geo: GeometryProxy, _ key: KeyPath<ShotGraphSample, Double>, _ color: Color) -> some View {
        let vals = samples.map { $0[keyPath: key] }
        let maxV = max(vals.max() ?? 1, 0.0001)
        let n = max(samples.count - 1, 1)
        return Path { path in
            for (i, v) in vals.enumerated() {
                let x = geo.size.width * CGFloat(i) / CGFloat(n)
                let y = geo.size.height * (1 - CGFloat(v / maxV))
                if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                else { path.addLine(to: CGPoint(x: x, y: y)) }
            }
        }
        .stroke(color, lineWidth: 1.5)
    }
}
```

- [ ] **Step 2: Register in the widget bundle**

In `MeticWidgetsBundle.swift`, add `ShotLiveActivity()` to `body`:

```swift
    var body: some Widget {
        FavouriteProfilesWidget()
        MediumHeroWidget()
        LargeHeroWidget()
        ControlCenterWidget()
        ShotLiveActivity()
    }
```

- [ ] **Step 3: Add file to widget target + build**

> `shotDynamicIsland(_:)` is defined in Task 12. To keep this task building on its
> own, add a temporary stub at the bottom of `ShotLiveActivity.swift`:
> ```swift
> // TEMP stub — replaced in Task 12.
> func shotDynamicIsland(_ context: ActivityViewContext<ShotActivityAttributes>) -> DynamicIsland {
>     DynamicIsland {
>         DynamicIslandExpandedRegion(.center) { Text("Metic") }
>     } compactLeading: { Text("•") } compactTrailing: { Text("") } minimal: { Text("•") }
> }
> ```
> Task 12 replaces this stub with the real implementation in a separate file and deletes it here.

Run (from `apps/web/ios/App`):
```
ruby scripts/ios-add-file.rb MeticWidgets/ShotLiveActivity.swift MeticWidgets
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/MeticWidgets/ShotLiveActivity.swift \
        apps/web/ios/App/MeticWidgets/MeticWidgetsBundle.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): add Live Activity Lock Screen view + ActivityConfiguration

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 12: Dynamic Island views

Replaces the Task 11 stub with compact (glanceable + progress ring), minimal
(glanceable value), and expanded (mirrors Lock Screen; Ready shows temps + Start).

**Files:**
- Create: `apps/web/ios/App/MeticWidgets/ShotDynamicIsland.swift`
- Modify: `apps/web/ios/App/MeticWidgets/ShotLiveActivity.swift` (remove the temp stub)

- [ ] **Step 1: Implement the Dynamic Island**

Create `MeticWidgets/ShotDynamicIsland.swift`:

```swift
import ActivityKit
import WidgetKit
import SwiftUI

func shotDynamicIsland(_ context: ActivityViewContext<ShotActivityAttributes>) -> DynamicIsland {
    let state = context.state
    let attr = context.attributes
    return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
            Text(attr.profileName).font(.caption).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
            Text(glanceableValue(attr, state)).font(.caption.bold()).monospacedDigit()
        }
        DynamicIslandExpandedRegion(.bottom) {
            if state.phase == .ready {
                Button(intent: StartShotIntent()) { Text("Start") }
                    .tint(Color(red: 0.843, green: 0.443, blue: 0))
            } else if state.phase == .extracting {
                ShotSparkline(samples: state.graph).frame(height: 28)
            }
        }
    } compactLeading: {
        Image(systemName: iconName(state.phase))
    } compactTrailing: {
        Text(glanceableValue(attr, state)).monospacedDigit()
    } minimal: {
        Text(glanceableValue(attr, state)).monospacedDigit()
    }
}

private func iconName(_ phase: ShotPhase) -> String {
    switch phase {
    case .heating: return "thermometer.medium"
    case .ready: return "checkmark.circle"
    case .extracting: return "cup.and.saucer"
    case .done: return "checkmark.seal"
    }
}

/// The single glanceable value string for compact/minimal presentations,
/// honouring the user's configured stat and the current phase.
private func glanceableValue(_ attr: ShotActivityAttributes,
                             _ state: ShotActivityAttributes.ContentState) -> String {
    switch state.phase {
    case .heating:
        if attr.heatingGlanceable == .estimatedTime,
           let head = state.headTempC,
           let eta = estimateTimeToReady(current: head,
                                         target: attr.setTempC ?? 93,
                                         cutoff: attr.readyCutoffC ?? 91.5) {
            return ShotGlanceable.formatETA(eta)
        }
        return String(format: "%.0f°", state.headTempC ?? 0)
    case .ready:
        return "Ready"
    case .extracting:
        switch attr.shotGlanceable {
        case .weight: return ShotGlanceable.text(.weight, current: state.currentWeightG, target: attr.targetWeightG)
        case .pressure: return ShotGlanceable.text(.pressure, current: state.pressureBar, target: nil)
        case .flow: return ShotGlanceable.text(.flow, current: state.flowGs, target: nil)
        case .temp: return ShotGlanceable.text(.temp, current: state.brewTempC, target: nil)
        }
    case .done:
        return state.finalWeightG.map { String(format: "%.0fg", $0) } ?? "Done"
    }
}
```

- [ ] **Step 2: Remove the temp stub from `ShotLiveActivity.swift`**

Delete the `// TEMP stub — replaced in Task 12.` function added in Task 11.

- [ ] **Step 3: Add file to widget target + build**

Run (from `apps/web/ios/App`):
```
ruby scripts/ios-add-file.rb MeticWidgets/ShotDynamicIsland.swift MeticWidgets
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/MeticWidgets/ShotDynamicIsland.swift \
        apps/web/ios/App/MeticWidgets/ShotLiveActivity.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): add Dynamic Island presentations for shot Live Activity

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 13: ShotActivityController — lifecycle + background-task-held live updates

Owns the ActivityKit `Activity`, holds a `beginBackgroundTask` assertion, subscribes
to `ShotStreamer`, maps frames via `ShotContentBuilder`, and calls `Activity.update()`.

**Files:**
- Create: `apps/web/ios/App/App/ShotActivityController.swift`

- [ ] **Step 1: Implement the controller**

Create `App/ShotActivityController.swift`:

```swift
import Foundation
import ActivityKit
import UIKit

/// Owns the shot Live Activity for its (short) lifetime. JS starts/stops it via
/// the Capacitor plugin; this class drives all live updates natively from a
/// persistent Socket.IO stream, kept alive by a background-task assertion so it
/// survives the phone locking during the ~25-45s shot.
@available(iOS 17.0, *)
final class ShotActivityController {
    static let shared = ShotActivityController()

    private var activity: Activity<ShotActivityAttributes>?
    private var streamer: ShotStreamer?
    private var streamTask: Task<Void, Never>?
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private var graph = ShotGraphBuffer()
    private var tempSamples: [Double] = []
    private var doseG: Double?
    private var targetWeightG: Double?

    func start(profileName: String, machineURL: URL, targetWeightG: Double?, doseG: Double?,
               setTempC: Double?, readyCutoffC: Double?, config: GlanceableConfig) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        stop() // ensure only one active

        self.doseG = doseG
        self.targetWeightG = targetWeightG
        self.graph = ShotGraphBuffer()
        self.tempSamples = []

        let attributes = ShotActivityAttributes(
            profileName: profileName, targetWeightG: targetWeightG,
            setTempC: setTempC, readyCutoffC: readyCutoffC,
            shotGlanceable: config.shot, heatingGlanceable: config.heating)
        let initial = ShotActivityAttributes.ContentState(phase: .heating)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: initial, staleDate: nil))
        } catch { return }

        beginBackground()
        let streamer = ShotStreamer(baseURL: machineURL)
        self.streamer = streamer
        streamTask = Task { [weak self] in
            for await frame in streamer.frames() { await self?.handle(frame) }
        }
    }

    func updateConfig(_ config: GlanceableConfig) {
        // Static attributes can't change mid-activity; persist for the next start.
        AppGroupWriter().setGlanceableConfig(config)
    }

    func stop() {
        streamTask?.cancel(); streamTask = nil
        streamer?.stop(); streamer = nil
        endBackground()
        if let activity {
            Task { await activity.end(nil, dismissalPolicy: .after(.now + 30)) }
        }
        activity = nil
    }

    @MainActor
    private func handle(_ frame: ShotStreamer.Frame) async {
        guard let activity else { return }
        switch frame {
        case .temperatures(let temps):
            if let d = (temps["t_bar_down"] as? NSNumber)?.doubleValue { lastChamber = d }
            if let u = (temps["t_bar_up"] as? NSNumber)?.doubleValue { lastHead = u }
        case .status(let status):
            guard var f = ShotFrame(status: status) else { return }
            f.chamberTempC = lastChamber
            f.headTempC = lastHead
            if f.phase == .extracting, let t = f.elapsedSec {
                graph.append(t: t, p: f.pressureBar ?? 0, f: f.flowGs ?? 0, w: f.weightG ?? 0)
                if let bt = f.brewTempC { tempSamples.append(bt) }
            }
            var newState = ShotContentBuilder.state(
                from: f, graph: graph, doseG: doseG, tempSamples: tempSamples)
            if f.phase == .done || (f.phase == .heating && !graph.isEmptyExtraction) {
                // Fall through to summary handled below on explicit done.
            }
            await activity.update(.init(state: newState, staleDate: nil))
            _ = newState
        }
    }

    private var lastChamber: Double?
    private var lastHead: Double?

    private func beginBackground() {
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "ShotLiveActivity") { [weak self] in
            self?.endBackground()
        }
    }
    private func endBackground() {
        if bgTask != .invalid {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
    }
}
```

> The `graph.isEmptyExtraction` reference above is illustrative branching only —
> remove that dead `if` block when implementing; the real summary is emitted when
> the JS side calls `stop()` after the shot ends (the app knows the shot is over).
> Keep `handle` focused on live `.heating/.ready/.extracting` updates. Add
> `public var count` is already on the buffer if you need emptiness checks.

- [ ] **Step 2: Add to app target + build**

Run (from `apps/web/ios/App`):
```
ruby scripts/ios-add-file.rb App/ShotActivityController.swift Metic
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```
Expected: `** BUILD SUCCEEDED **`. Fix any compiler errors (e.g. remove the dead `if` block noted above) until it builds cleanly with no warnings about the controller.

- [ ] **Step 3: Commit**

```bash
git add apps/web/ios/App/App/ShotActivityController.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): drive Live Activity updates from native shot streamer

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 14: LiveActivityPlugin (Capacitor native bridge) + registration

Exposes lifecycle to JS: `isSupported`, `areActivitiesEnabled`, `start`, `updateConfig`, `stop`.

**Files:**
- Create: `apps/web/ios/App/App/LiveActivityPlugin.swift`
- Modify: `apps/web/ios/App/App/MeticulousViewController.swift`

- [ ] **Step 1: Implement the plugin**

Create `App/LiveActivityPlugin.swift`:

```swift
import Capacitor
import Foundation

/// Bridges the shot Live Activity lifecycle from the web layer. The web app
/// starts/stops the activity and sets static config; native code drives the
/// live updates (see ShotActivityController).
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "areActivitiesEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) { call.resolve(["supported": true]) }
        else { call.resolve(["supported": false]) }
    }

    @objc func areActivitiesEnabled(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            call.resolve(["enabled": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["enabled": false])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(); return }
        guard let urlStr = call.getString("machineUrl"), let url = URL(string: urlStr) else {
            call.reject("machineUrl required"); return
        }
        let config = GlanceableConfig(
            shot: ShotGlanceableStat(rawValue: call.getString("shotGlanceable") ?? "weight") ?? .weight,
            heating: HeatingGlanceableStat(rawValue: call.getString("heatingGlanceable") ?? "temp") ?? .temp)
        DispatchQueue.main.async {
            ShotActivityController.shared.start(
                profileName: call.getString("profileName") ?? "Shot",
                machineURL: url,
                targetWeightG: call.getDouble("targetWeightG"),
                doseG: call.getDouble("doseG"),
                setTempC: call.getDouble("setTempC"),
                readyCutoffC: call.getDouble("readyCutoffC"),
                config: config)
            call.resolve()
        }
    }

    @objc func updateConfig(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(); return }
        let config = GlanceableConfig(
            shot: ShotGlanceableStat(rawValue: call.getString("shotGlanceable") ?? "weight") ?? .weight,
            heating: HeatingGlanceableStat(rawValue: call.getString("heatingGlanceable") ?? "temp") ?? .temp)
        DispatchQueue.main.async {
            ShotActivityController.shared.updateConfig(config)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(); return }
        DispatchQueue.main.async {
            ShotActivityController.shared.stop()
            call.resolve()
        }
    }
}
```

- [ ] **Step 2: Register in MeticulousViewController**

After the `WidgetBridgePlugin` registration (~line 79) in `App/MeticulousViewController.swift`, add:

```swift
        let liveActivity = LiveActivityPlugin()
        _ = bridge.perform(registerSelector, with: liveActivity)
        NSLog("MeticAI: LiveActivityPlugin registered successfully")
```

- [ ] **Step 3: Add to app target + build**

Run (from `apps/web/ios/App`):
```
ruby scripts/ios-add-file.rb App/LiveActivityPlugin.swift Metic
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ios/App/App/LiveActivityPlugin.swift \
        apps/web/ios/App/App/MeticulousViewController.swift \
        apps/web/ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(ios): add LiveActivity Capacitor plugin + register it

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 15: TypeScript plugin wrapper + types

**Files:**
- Create: `apps/web/src/services/liveActivity/liveActivityBridge.ts`
- Test: `apps/web/src/services/liveActivity/liveActivityBridge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `liveActivityBridge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { GlanceableConfig, StartLiveActivityOptions } from './liveActivityBridge'

describe('liveActivityBridge types', () => {
  it('exports a usable start-options shape', () => {
    const opts: StartLiveActivityOptions = {
      profileName: 'Test',
      machineUrl: 'http://10.0.0.5',
      shotGlanceable: 'weight',
      heatingGlanceable: 'temp',
    }
    expect(opts.machineUrl).toBe('http://10.0.0.5')
  })

  it('constrains glanceable config values', () => {
    const cfg: GlanceableConfig = { shotGlanceable: 'pressure', heatingGlanceable: 'estimatedTime' }
    expect(cfg.shotGlanceable).toBe('pressure')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/services/liveActivity/liveActivityBridge.test.ts --reporter=dot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

Create `liveActivityBridge.ts`:

```ts
import { registerPlugin } from '@capacitor/core'

export type ShotGlanceableStat = 'weight' | 'pressure' | 'flow' | 'temp'
export type HeatingGlanceableStat = 'temp' | 'estimatedTime'

export interface GlanceableConfig {
  shotGlanceable: ShotGlanceableStat
  heatingGlanceable: HeatingGlanceableStat
}

export interface StartLiveActivityOptions extends GlanceableConfig {
  profileName: string
  machineUrl: string
  targetWeightG?: number
  doseG?: number
  setTempC?: number
  readyCutoffC?: number
}

export interface LiveActivityPlugin {
  isSupported(): Promise<{ supported: boolean }>
  areActivitiesEnabled(): Promise<{ enabled: boolean }>
  start(options: StartLiveActivityOptions): Promise<void>
  updateConfig(options: GlanceableConfig): Promise<void>
  stop(): Promise<void>
}

/**
 * iOS-only Live Activity bridge. On web/Android the native plugin is absent and
 * calls reject; callers gate usage behind `Capacitor.getPlatform() === 'ios'`.
 */
export const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity')
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `bunx vitest run src/services/liveActivity/liveActivityBridge.test.ts --reporter=dot && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/liveActivity/liveActivityBridge.ts \
        apps/web/src/services/liveActivity/liveActivityBridge.test.ts
git commit -m "feat(live-activity): add TypeScript LiveActivity plugin wrapper

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 16: deriveLiveActivityCommand — pure lifecycle transition

Given the previous lifecycle state and the current machine snapshot, decide whether
to `start`, `stop`, or do `none`. Keeps the hook (Task 17) trivial and testable.

**Files:**
- Create: `apps/web/src/services/liveActivity/deriveLiveActivityCommand.ts`
- Test: `apps/web/src/services/liveActivity/deriveLiveActivityCommand.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `deriveLiveActivityCommand.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveLiveActivityCommand } from './deriveLiveActivityCommand'

describe('deriveLiveActivityCommand', () => {
  it('starts when heating begins and none is active', () => {
    const r = deriveLiveActivityCommand(
      { active: false },
      { stateLC: 'heating', brewing: false, hasChartData: false },
    )
    expect(r.command).toBe('start')
    expect(r.next.active).toBe(true)
  })

  it('does nothing while a shot is already tracked', () => {
    const r = deriveLiveActivityCommand(
      { active: true },
      { stateLC: 'brewing', brewing: true, hasChartData: true },
    )
    expect(r.command).toBe('none')
  })

  it('stops when the machine returns to idle after a shot', () => {
    const r = deriveLiveActivityCommand(
      { active: true },
      { stateLC: 'idle', brewing: false, hasChartData: false },
    )
    expect(r.command).toBe('stop')
    expect(r.next.active).toBe(false)
  })

  it('stays idle when nothing is happening', () => {
    const r = deriveLiveActivityCommand(
      { active: false },
      { stateLC: 'idle', brewing: false, hasChartData: false },
    )
    expect(r.command).toBe('none')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/services/liveActivity/deriveLiveActivityCommand.test.ts --reporter=dot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transition**

Create `deriveLiveActivityCommand.ts`:

```ts
export interface LiveActivityLifecycle {
  active: boolean
}

export interface MachineLifecycleSnapshot {
  stateLC: string
  brewing: boolean
  hasChartData: boolean
}

export type LiveActivityCommand = 'start' | 'stop' | 'none'

const HEATING_STATES = new Set(['heating', 'preheating', 'warming', 'click to start'])

/**
 * Pure lifecycle transition for the shot Live Activity. Starts when the machine
 * enters a heating/ready phase and none is active; stops when it returns to a
 * terminal (idle/unknown) phase after having been active.
 */
export function deriveLiveActivityCommand(
  prev: LiveActivityLifecycle,
  ms: MachineLifecycleSnapshot,
): { command: LiveActivityCommand; next: LiveActivityLifecycle } {
  const inShotFlow = ms.brewing || ms.hasChartData || HEATING_STATES.has(ms.stateLC)

  if (!prev.active && inShotFlow) {
    return { command: 'start', next: { active: true } }
  }
  if (prev.active && !inShotFlow) {
    return { command: 'stop', next: { active: false } }
  }
  return { command: 'none', next: prev }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run src/services/liveActivity/deriveLiveActivityCommand.test.ts --reporter=dot`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/liveActivity/deriveLiveActivityCommand.ts \
        apps/web/src/services/liveActivity/deriveLiveActivityCommand.test.ts
git commit -m "feat(live-activity): add pure lifecycle transition helper

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 17: useLiveActivitySync hook (native-gated) + mount in LiveShotView

**Files:**
- Create: `apps/web/src/hooks/useLiveActivitySync.ts`
- Modify: `apps/web/src/components/LiveShotView.tsx`

- [ ] **Step 1: Implement the hook**

Create `hooks/useLiveActivitySync.ts`:

```ts
import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import type { MachineState } from '@/hooks/useWebSocket'
import { LiveActivity } from '@/services/liveActivity/liveActivityBridge'
import {
  deriveLiveActivityCommand,
  type LiveActivityLifecycle,
} from '@/services/liveActivity/deriveLiveActivityCommand'
import { loadLiveActivitySettings } from '@/services/liveActivity/liveActivitySettings'

const TEMP_ON_TARGET_THRESHOLD = 1.5

/**
 * iOS-only: mirror the current shot into a Live Activity. Native code drives the
 * live telemetry updates; this hook only starts/stops the activity in step with
 * the machine's lifecycle. No-op on web/Android.
 */
export function useLiveActivitySync(ms: MachineState, hasChartData: boolean, machineUrl: string | null) {
  const lifecycle = useRef<LiveActivityLifecycle>({ active: false })

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    if (!machineUrl) return

    const stateLC = (ms.state ?? '').toLowerCase()
    const { command, next } = deriveLiveActivityCommand(lifecycle.current, {
      stateLC,
      brewing: !!ms.brewing,
      hasChartData,
    })
    if (command === 'none') return
    lifecycle.current = next

    if (command === 'start') {
      const settings = loadLiveActivitySettings()
      const target = ms.target_temperature ?? undefined
      void LiveActivity.start({
        profileName: ms.active_profile ?? 'Espresso',
        machineUrl,
        targetWeightG: ms.target_weight ?? undefined,
        setTempC: target,
        readyCutoffC: target != null ? target - TEMP_ON_TARGET_THRESHOLD : undefined,
        shotGlanceable: settings.shotGlanceable,
        heatingGlanceable: settings.heatingGlanceable,
      }).catch(() => { lifecycle.current = { active: false } })
    } else if (command === 'stop') {
      void LiveActivity.stop().catch(() => {})
    }
  }, [ms, hasChartData, machineUrl])
}
```

> `loadLiveActivitySettings` and its `LiveActivitySettings` type are created in Task 18.
> Implement Task 18's settings module first if executing strictly in order, OR add a
> minimal `liveActivitySettings.ts` stub now and flesh it out in Task 18. The task
> order below (18 after 17) assumes the stub approach; either is fine as long as the
> final tree has the real module.

- [ ] **Step 2: Mount the hook in LiveShotView**

In `LiveShotView.tsx`, near the other hook calls (after `useMachineService()`), add:

```tsx
  useLiveActivitySync(ms, chartData.length > 0, machine.getMachineUrl?.() ?? null)
```

with the import at the top:

```tsx
import { useLiveActivitySync } from '@/hooks/useLiveActivitySync'
```

> Verify how the current machine base URL is obtained in this component (search for
> `getMachineUrl`, `machineUrl`, or the settings store). Use whatever accessor the
> codebase already exposes; if none returns a URL synchronously, read it from the
> existing settings/config store the component already imports. Do not invent a new
> global.

- [ ] **Step 3: Typecheck + run the full LiveShotView test file**

Run:
```
bunx tsc --noEmit && bunx vitest run src/components/LiveShotView.test.tsx --reporter=dot
```
Expected: no type errors; existing LiveShotView tests still pass (the hook is a no-op under jsdom because `Capacitor.getPlatform()` !== 'ios').

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useLiveActivitySync.ts apps/web/src/components/LiveShotView.tsx
git commit -m "feat(live-activity): sync shot lifecycle into iOS Live Activity

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 18: Live Activity settings module + native-only Settings UI

Persists the two glanceable choices in localStorage, and offers a native-only
Settings block to change them, pushing changes to native via `updateConfig`.

**Files:**
- Create: `apps/web/src/services/liveActivity/liveActivitySettings.ts`
- Create: `apps/web/src/services/liveActivity/liveActivitySettings.test.ts`
- Modify: `apps/web/src/lib/constants.ts` (add storage keys)
- Modify: `apps/web/src/components/SettingsView.tsx` (add the UI block)

- [ ] **Step 1: Write the failing settings-module test**

Create `liveActivitySettings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { loadLiveActivitySettings, saveLiveActivitySettings } from './liveActivitySettings'

describe('liveActivitySettings', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to weight + temp', () => {
    expect(loadLiveActivitySettings()).toEqual({
      shotGlanceable: 'weight',
      heatingGlanceable: 'temp',
    })
  })

  it('round-trips saved values', () => {
    saveLiveActivitySettings({ shotGlanceable: 'pressure', heatingGlanceable: 'estimatedTime' })
    expect(loadLiveActivitySettings()).toEqual({
      shotGlanceable: 'pressure',
      heatingGlanceable: 'estimatedTime',
    })
  })

  it('falls back to defaults on invalid stored values', () => {
    localStorage.setItem('meticai-la-shot-glanceable', 'bogus')
    expect(loadLiveActivitySettings().shotGlanceable).toBe('weight')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/services/liveActivity/liveActivitySettings.test.ts --reporter=dot`
Expected: FAIL — module not found.

- [ ] **Step 3: Add storage keys**

In `src/lib/constants.ts`, inside `STORAGE_KEYS`, add:

```ts
  // -- iOS Live Activity glanceable configuration --
  LA_SHOT_GLANCEABLE: 'meticai-la-shot-glanceable',
  LA_HEATING_GLANCEABLE: 'meticai-la-heating-glanceable',
```

- [ ] **Step 4: Implement the settings module**

Create `liveActivitySettings.ts`:

```ts
import { STORAGE_KEYS } from '@/lib/constants'
import type {
  GlanceableConfig,
  HeatingGlanceableStat,
  ShotGlanceableStat,
} from './liveActivityBridge'

const SHOT_VALUES: ShotGlanceableStat[] = ['weight', 'pressure', 'flow', 'temp']
const HEATING_VALUES: HeatingGlanceableStat[] = ['temp', 'estimatedTime']

export type LiveActivitySettings = GlanceableConfig

export function loadLiveActivitySettings(): LiveActivitySettings {
  const shot = localStorage.getItem(STORAGE_KEYS.LA_SHOT_GLANCEABLE) as ShotGlanceableStat | null
  const heating = localStorage.getItem(STORAGE_KEYS.LA_HEATING_GLANCEABLE) as HeatingGlanceableStat | null
  return {
    shotGlanceable: shot && SHOT_VALUES.includes(shot) ? shot : 'weight',
    heatingGlanceable: heating && HEATING_VALUES.includes(heating) ? heating : 'temp',
  }
}

export function saveLiveActivitySettings(settings: LiveActivitySettings): void {
  localStorage.setItem(STORAGE_KEYS.LA_SHOT_GLANCEABLE, settings.shotGlanceable)
  localStorage.setItem(STORAGE_KEYS.LA_HEATING_GLANCEABLE, settings.heatingGlanceable)
}
```

> If Task 17's stub referenced this module, replace the stub with this real file.

- [ ] **Step 5: Run to verify pass**

Run: `bunx vitest run src/services/liveActivity/liveActivitySettings.test.ts --reporter=dot`
Expected: PASS (3 tests).

- [ ] **Step 6: Add the native-only Settings UI block**

In `SettingsView.tsx`, add state near `openAppOnStart` (line ~174):

```tsx
  const [laSettings, setLaSettings] = useState<LiveActivitySettings>(loadLiveActivitySettings)
```

Add imports at the top:

```tsx
import {
  loadLiveActivitySettings,
  saveLiveActivitySettings,
  type LiveActivitySettings,
} from '@/services/liveActivity/liveActivitySettings'
import { LiveActivity } from '@/services/liveActivity/liveActivityBridge'
import type { ShotGlanceableStat, HeatingGlanceableStat } from '@/services/liveActivity/liveActivityBridge'
```

Add a change handler near `handleOpenAppOnStart`:

```tsx
  const handleLaChange = (next: LiveActivitySettings) => {
    setLaSettings(next)
    saveLiveActivitySettings(next)
    void LiveActivity.updateConfig(next).catch(() => {})
  }
```

Inside the existing `isIOS` widgets `CollapsibleSection` (after the openAppOnStart row), append a new sub-section using the project's existing `Select` component (already imported in this file — reuse it; do not add a new dependency):

```tsx
                <div className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">
                      {t('settings.liveActivity.shotGlanceable')}
                    </Label>
                    <Select
                      value={laSettings.shotGlanceable}
                      onValueChange={(v) =>
                        handleLaChange({ ...laSettings, shotGlanceable: v as ShotGlanceableStat })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weight">{t('settings.liveActivity.stat.weight')}</SelectItem>
                        <SelectItem value="pressure">{t('settings.liveActivity.stat.pressure')}</SelectItem>
                        <SelectItem value="flow">{t('settings.liveActivity.stat.flow')}</SelectItem>
                        <SelectItem value="temp">{t('settings.liveActivity.stat.temp')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">
                      {t('settings.liveActivity.heatingGlanceable')}
                    </Label>
                    <Select
                      value={laSettings.heatingGlanceable}
                      onValueChange={(v) =>
                        handleLaChange({ ...laSettings, heatingGlanceable: v as HeatingGlanceableStat })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="temp">{t('settings.liveActivity.stat.temp')}</SelectItem>
                        <SelectItem value="estimatedTime">{t('settings.liveActivity.stat.estimatedTime')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
```

> Confirm the exact `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue`
> import names by checking the existing imports at the top of `SettingsView.tsx`. Use
> whatever the file already imports for dropdowns; if it uses a different primitive,
> mirror that primitive's usage rather than introducing `Select`.

- [ ] **Step 7: Typecheck + lint**

Run: `bunx tsc --noEmit && bunx eslint src/components/SettingsView.tsx src/services/liveActivity`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/services/liveActivity/liveActivitySettings.ts \
        apps/web/src/services/liveActivity/liveActivitySettings.test.ts \
        apps/web/src/lib/constants.ts apps/web/src/components/SettingsView.tsx
git commit -m "feat(live-activity): add native-only glanceable settings

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 19: i18n — add Live Activity strings to all 6 locales

**Files:**
- Modify: `apps/web/public/locales/{en,sv,de,es,fr,it}/translation.json`

- [ ] **Step 1: Add the `liveActivity` keys under `settings` in `en/translation.json`**

Insert (translate per locale for the other 5):

```json
    "liveActivity": {
      "shotGlanceable": "Live Activity — shot stat",
      "heatingGlanceable": "Live Activity — heating stat",
      "stat": {
        "weight": "Weight",
        "pressure": "Pressure",
        "flow": "Flow",
        "temp": "Temperature",
        "estimatedTime": "Estimated time to ready"
      }
    }
```

Locale translations (place the same structure under `settings` in each file):

- **sv:** `shotGlanceable: "Live Activity — värde vid uttag"`, `heatingGlanceable: "Live Activity — värde vid uppvärmning"`, stat: `weight: "Vikt"`, `pressure: "Tryck"`, `flow: "Flöde"`, `temp: "Temperatur"`, `estimatedTime: "Uppskattad tid till klar"`.
- **de:** `shotGlanceable: "Live-Aktivität — Bezugswert"`, `heatingGlanceable: "Live-Aktivität — Aufheizwert"`, stat: `weight: "Gewicht"`, `pressure: "Druck"`, `flow: "Fluss"`, `temp: "Temperatur"`, `estimatedTime: "Geschätzte Zeit bis bereit"`.
- **es:** `shotGlanceable: "Live Activity — dato de extracción"`, `heatingGlanceable: "Live Activity — dato de calentamiento"`, stat: `weight: "Peso"`, `pressure: "Presión"`, `flow: "Flujo"`, `temp: "Temperatura"`, `estimatedTime: "Tiempo estimado hasta listo"`.
- **fr:** `shotGlanceable: "Live Activity — donnée d'extraction"`, `heatingGlanceable: "Live Activity — donnée de chauffe"`, stat: `weight: "Poids"`, `pressure: "Pression"`, `flow: "Débit"`, `temp: "Température"`, `estimatedTime: "Temps estimé avant prêt"`.
- **it:** `shotGlanceable: "Live Activity — dato di estrazione"`, `heatingGlanceable: "Live Activity — dato di riscaldamento"`, stat: `weight: "Peso"`, `pressure: "Pressione"`, `flow: "Flusso"`, `temp: "Temperatura"`, `estimatedTime: "Tempo stimato al pronto"`.

- [ ] **Step 2: Verify JSON validity + i18n parity**

Run (from `apps/web`):
```
for f in public/locales/*/translation.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"; done
```
Expected: no `INVALID` output. If the repo has an i18n key-parity test (search `grep -rl "translation.json" src/**/*.test.*`), run it and expect PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/locales
git commit -m "feat(live-activity): add i18n strings for glanceable settings (6 locales)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 20: Full-suite validation

- [ ] **Step 1: Swift tests**

Run (from `apps/web/ios/App`):
```
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild test -scheme MeticWidgetsTests \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```
Expected: `** TEST SUCCEEDED **` — all prior + new logic tests pass.

- [ ] **Step 2: App + widget build**

Run (from `apps/web/ios/App`):
```
GIT_CONFIG_GLOBAL="$HOME/.gitconfig" xcodebuild build -scheme MeticWidgets \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -quiet
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Web tests + typecheck + lint + native bundle**

Run (from `apps/web`):
```
bunx vitest run --reporter=dot
bunx tsc --noEmit
bunx eslint .
VITE_MACHINE_MODE=capacitor bunx vite build
```
Expected: all green; native bundle builds.

- [ ] **Step 4: Code review + issue update**

Dispatch a code-review pass over the branch diff; address any high-confidence findings.
Update the tracking issue/PR with the summary. Do **not** bump the version or publish a
beta as part of this plan (the user drives releases separately).

- [ ] **Step 5: Manual on-device checklist (hand to user)**

The following require a physical iOS 17+ device (simulator can't fully exercise
ActivityKit background updates):
- Start heating in-app → Live Activity appears on Lock Screen with two heating bars.
- Bars turn green at the ready cutoff; no red marker present.
- Ready state shows the Start button; tapping it starts extraction.
- Lock the phone during extraction → graph + tiles keep updating.
- Dynamic Island compact/minimal/expanded reflect the configured glanceable.
- Change the glanceable in Settings → next shot uses it.
- Shot completes → summary shows; activity auto-dismisses after ~30s.

---

## Notes for the executing agent

- **Dual-runtime parity:** only Task 1 (HeatingNumbers marker removal) touches shared web
  logic and therefore both runtimes; everything else is native-iOS-only, so no
  DirectModeInterceptor mirror is required. Do **not** add server-mode equivalents.
- **Continuity MCP:** log an architectural decision as each native subsystem lands
  (native-driven updates, background-task assertion, glanceable config schema).
- **If a Swift file fails to compile because it wasn't added to a target,** re-run the
  `scripts/ios-add-file.rb` step for that file — this is the single most common failure mode.
- **Version file:** do not touch `VERSION` in this plan.
