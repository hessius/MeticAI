# Skill: Android (Capacitor)

The Android app is a Capacitor wrapper around the web app, built in **DirectMode**
(no Python backend) and shipped as a **signed APK on GitHub Releases**.

**Full guide:** [`apps/web/android/README.md`](../../apps/web/android/README.md) —
environment setup, dev loop, emulator, signing, CI, and troubleshooting. Read it
before doing any Android work.

## Critical conventions (do not regress)

- **`androidScheme: 'http'`** in `apps/web/capacitor.config.ts` — required so
  DirectMode `axios` + `Socket.IO` reach the machine's cleartext `http://`/`ws://`
  endpoints. `https` origin → mixed-content block → blank Control Center/catalogue/shots.
- **JDK 21** is mandatory for the Gradle toolchain: `export JAVA_HOME` to
  `openjdk@21` before any `./gradlew` command.
- **Edge-to-edge** is handled by Capacitor 8's built-in `SystemBars` plugin
  (default `insetsHandling: 'css'`) — `MainActivity` is a plain `BridgeActivity`,
  no extra plugin or config. Keep CSS on `env(safe-area-inset-*)` and
  `viewport-fit=cover`. True passthrough needs WebView ≥ 140; older WebViews
  (emulators) inset the WebView, showing `#030202` "black bars". See
  `apps/web/android/README.md` §2b/§3.
- App ID `com.metic.app`; minSdk 24; compile/targetSdk in `android/variables.gradle`.
- **Feature parity:** any change to DirectMode/analysis/machine-API logic must be
  mirrored across runtimes (see `frontend.md`) and verified on Android too.

## Build & run (from `apps/web/`)

```bash
VITE_MACHINE_MODE=capacitor bun run build   # 1. web build (DirectMode)
npx cap sync android                         # 2. copy into native project
cd android && ./gradlew assembleDebug        # 3. debug APK
```

## Release

`release-android.yml` builds the signed APK on a published Release using the
`ANDROID_KEYSTORE_BASE64` / `_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD` secrets.
The keystore is **not** in the repo and **must be backed up**.
