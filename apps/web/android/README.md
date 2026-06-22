# Metic — Android (Capacitor)

The Android app is a [Capacitor](https://capacitorjs.com/) wrapper around the same
web app that powers iOS, built in **DirectMode** (no Python backend — the
`DirectModeInterceptor` reproduces the server contract client-side). It is
distributed as a **signed APK on [GitHub Releases](https://github.com/hessius/MeticAI/releases)**,
installable outside the Play Store.

> All commands below are run from `apps/web/` unless noted otherwise.

---

## 1. One-time environment setup (macOS)

The native build needs the Android SDK and **JDK 21** (Capacitor 8 plugins use a
Java 21 Gradle toolchain — the system JDK and Android Studio's bundled JDK 17 are
both incompatible).

```bash
# Android SDK command-line tools (sdkmanager, adb, emulator)
brew install --cask android-commandlinetools

# JDK 21 (keg-only formula, no sudo required)
brew install openjdk@21
```

Export these (add to your shell profile for convenience):

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

Install the required SDK packages and accept licenses:

```bash
sdkmanager "platform-tools" "platforms;android-35" "platforms;android-36" \
  "build-tools;35.0.0" "emulator" \
  "system-images;android-35;google_apis_playstore;arm64-v8a"
sdkmanager --licenses
```

> `compileSdk`/`targetSdk` are pinned in `android/variables.gradle` (currently 36).
> `local.properties` (`sdk.dir=…`) is generated automatically by `cap sync` and is
> gitignored — never commit it.

---

## 2. Development loop

```bash
# 1. Build the web app in Capacitor (DirectMode) flavour
VITE_MACHINE_MODE=capacitor bun run build

# 2. Copy the web build + plugin changes into the native project
npx cap sync android        # or: bun run build:android (build + sync)

# 3. Build the debug APK
cd android && ./gradlew assembleDebug --no-daemon
# → app/build/outputs/apk/debug/app-debug.apk
```

Open the project in Android Studio instead with `npx cap open android`.

After any change to **web code** you must re-run steps 1–2 (the WebView serves the
copied `dist/`, not a live dev server). After changing **native config**
(`AndroidManifest.xml`, `build.gradle`, `MainActivity.java`, plugins) just re-run
`cap sync` + Gradle.

---

## 2b. App icons & splash screen

Launcher icons and splash screens are generated from source art in
`apps/web/assets/` with [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets)
(a devDependency). Source files:

| File | Purpose |
| --- | --- |
| `icon.png` (1024²) | Legacy square/round launcher icon (brand mark on white) |
| `icon-foreground.png` (1024², transparent) | Adaptive-icon foreground — the dark bean disc, full-bleed |
| `icon-background.png` (1024²) | Adaptive-icon background (white) |
| `splash.png` (2732²) | Light splash — blue mark on white |
| `splash-dark.png` (2732²) | Dark splash — blue mark on `#030202` |

Regenerate the Android resources after editing any source asset:

```bash
cd apps/web
npx @capacitor/assets generate --android \
  --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#ffffff' \
  --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#030202'
```

The adaptive-icon XMLs (`res/mipmap-anydpi-v26/ic_launcher*.xml`) are hand-tuned to
use a **full-bleed** `@color/ic_launcher_background` (white) with the foreground
inset 16.7% — do not let the generator overwrite the background with an inset
mipmap (that leaves transparent corners). On Android 12+ the system splash shows
the launcher icon centred on `windowSplashScreenBackground` (`#030202`); the
generated `drawable*/splash.png` images drive the splash on Android < 12.

---

## 3. Emulator

```bash
# Create an AVD once (arm64 image to match Apple Silicon)
avdmanager create avd -n metic_pixel7 -k "system-images;android-35;google_apis_playstore;arm64-v8a" -d pixel_7

# Launch it — ALWAYS use the hardware GPU (-gpu host), see warning below
emulator -avd metic_pixel7 -no-snapshot -no-boot-anim -gpu host &

# Wait for boot, then install + launch
adb wait-for-device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.metic.app/.MainActivity

# Live native logs / screenshot
adb logcat | grep -i capacitor
adb exec-out screencap -p > /tmp/metic.png
```

> ⚠️ **Always launch with `-gpu host` (hardware GPU), never `-gpu swiftshader_indirect`.**
> SwiftShader is a **software** GL renderer and produces false compositing artifacts
> on heavy SVG/Recharts views (e.g. Shot Details shows ghost/duplicate charts, a
> missing tab bar, or content overlap). These **do not occur on real devices** or
> with `-gpu host` (Metal-backed on Apple Silicon). If you see chart "ghosting" in
> the emulator, it's almost certainly the GPU mode — switch to `-gpu host` before
> investigating as a code bug.

> **Edge-to-edge needs WebView ≥ 140.** Capacitor 8's `SystemBars` plugin only does
> true edge-to-edge passthrough (content under the status/nav bars via
> `env(safe-area-inset-*)`) when the system WebView is **≥ 140**. Older WebViews
> inset the WebView instead, so the status/nav-bar areas show the window background
> (`#030202`) as "black bars". Emulator system images bundle older WebViews
> (android-35 → 124, android-36.1 → 134); real devices auto-update WebView via Play
> Store and get true edge-to-edge. To validate edge-to-edge on the emulator, update
> Android System WebView to ≥ 140 via the Play Store on a signed-in playstore image.

> **Emulator limitation:** the standard emulator NATs its network and does **not**
> forward mDNS/multicast to your host LAN, so automatic machine discovery
> (zeroconf) cannot find a real machine there. Use **manual IP entry** during
> onboarding, or test discovery on a physical device on the same Wi-Fi. (The
> emulator *can* still reach a machine on the host LAN by IP, e.g. `http://192.168.x.x`.)

---

## 4. Signing & release

Release builds are signed with a keystore that is **never committed**. CI reads it
from GitHub Secrets; locally you supply it via env vars or `keystore.properties`.

### Keystore secrets (already configured in this repo)

| Secret | Meaning |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of the `.jks` keystore |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | key alias (`metic`) |
| `ANDROID_KEY_PASSWORD` | key password |

> ⚠️ **Back up the keystore.** It lives outside the repo (e.g.
> `~/MeticAI-android-signing/`). Losing it means you can never publish an update
> that upgrades over an installed copy — users would have to uninstall/reinstall.

### Build a signed release APK locally

```bash
cd android
export ANDROID_KEYSTORE_FILE=~/MeticAI-android-signing/metic-release.jks
export ANDROID_KEYSTORE_PASSWORD=…   # from your credentials file
export ANDROID_KEY_ALIAS=metic
export ANDROID_KEY_PASSWORD=…
./gradlew assembleRelease --no-daemon
# → app/build/outputs/apk/release/app-release.apk

# Verify the signature
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

Alternatively, drop a gitignored `android/keystore.properties`:

```properties
storeFile=/absolute/path/to/metic-release.jks
storePassword=…
keyAlias=metic
keyPassword=…
```

If no keystore is present, `assembleRelease` still succeeds but produces an
**unsigned** APK — so PR/local builds never need the secrets.

---

## 5. CI / CD

| Workflow | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/build-android.yml` | push/PR to `main`, `workflow_dispatch` | Builds the debug APK, uploads it as an artifact (verification). |
| `.github/workflows/release-android.yml` | a Release is **published**, `workflow_dispatch` | Builds the **signed** release APK and attaches `Metic-<tag>.apk` to the Release. `workflow_dispatch` uploads the signed APK as a workflow artifact instead. |

`auto-release.yml` (on `VERSION` bump) creates the GitHub Release, which fires
`release-android.yml`. The Android workflows mirror the iOS ones and are gated to
`main`, so they run once changes reach a `main`-targeted PR.

---

## 6. Key configuration & gotchas

- **`androidScheme: 'http'`** (`apps/web/capacitor.config.ts`) — required so
  DirectMode `axios` + `Socket.IO` can reach the machine's cleartext
  `http://`/`ws://` endpoints. An `https://localhost` WebView origin blocks them
  as mixed content (only native `CapacitorHttp` probes get through), which leaves
  Control Center / catalogue / shots blank after a "successful" connection.
- **Cleartext to the LAN** — `AndroidManifest.xml` sets `usesCleartextTraffic`
  with `res/xml/network_security_config.xml` (mirrors iOS `NSAllowsLocalNetworking`).
- **Edge-to-edge / safe areas** — handled by Capacitor 8's **built-in `SystemBars`
  plugin** (default `insetsHandling: 'css'`); no extra plugin or `MainActivity`
  customization is needed. CSS uses `env(safe-area-inset-*)` and `index.html` sets
  `viewport-fit=cover`. On WebView **≥ 140** this is true edge-to-edge passthrough
  (content draws under transparent bars). On older WebViews the plugin insets the
  WebView instead, so the bar areas show the window background `#030202` ("black
  bars") — a WebView-version limitation, not a config bug. Real devices auto-update
  WebView via Play Store; emulator images bundle older WebViews (see §3).
- **App ID:** `com.metic.app`. **Min SDK:** 24.
- **JDK 21 is mandatory** for the Gradle toolchain — set `JAVA_HOME` before any
  `./gradlew` command.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Unsupported class file major version` / toolchain errors | Wrong JDK. `export JAVA_HOME` to JDK 21 before `./gradlew`. |
| `SDK location not found` | `ANDROID_HOME` unset, or run `npx cap sync android` to regenerate `local.properties`. |
| Black bars top/bottom | On WebView **< 140** the WebView is inset (bar areas show `#030202`). Expected on emulator (124/134); real devices on WebView ≥ 140 render true edge-to-edge. Also ensure `viewport-fit=cover` in `index.html` and re-run `cap sync`. |
| Ghost/duplicate charts, missing tab bar, overlapping content (Shot Details) | **Emulator software-GPU (SwiftShader) artifact.** Relaunch the emulator with `-gpu host`. Does not occur on real devices. |
| Control Center / catalogue / shots blank after connecting | `androidScheme` not `http`; rebuild web + `cap sync`. |
| Discovery finds nothing on the emulator | Expected (emulator can't do LAN mDNS) — use manual IP or a real device. |
| App shows a stale UI after a code change | Re-run `VITE_MACHINE_MODE=capacitor bun run build` **and** `npx cap sync android`. |
