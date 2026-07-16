# iOS Share Extension — Xcode wiring (one-time manual step)

Metic's "share a profile to Metic" feature is fully implemented for **web** and
**Android** and ships verified. On **iOS** the app-side receiver
(`@capgo/capacitor-share-target`) is wired and configured, but iOS requires a
native **Share Extension target** plus an **App Group** capability. That target,
its App Group entitlement and its code-signing cannot be created or build-verified
outside Xcode with an Apple Developer account, so the source lives here ready to
add to the Xcode project.

Everything the extension needs is in this folder:

- `ShareViewController.swift` — collects the shared URL / text / file, writes it
  into the App Group under the `share-target-data` key the plugin reads, then
  opens `metic://share` to bring the app forward.
- `Info.plist` — `NSExtension` activation rules (web URL, text, one file).
- `ShareExtension.entitlements` — App Group `group.com.metic.app`.

The main app already has:

- `App/App/App.entitlements` — App Group `group.com.metic.app` (add it to the
  main target's *Signing & Capabilities* / `CODE_SIGN_ENTITLEMENTS`).
- `App/App/Info.plist` — `CFBundleURLTypes` with the `metic` URL scheme.
- `capacitor.config.ts` — `CapacitorShareTarget.appGroupId: 'group.com.metic.app'`.

## Steps in Xcode

1. Open `apps/web/ios/App/App.xcworkspace`.
2. **File > New > Target… > Share Extension.** Name it `ShareExtension`,
   bundle id `com.metic.app.ShareExtension`. When prompted, do **not** activate
   the auto-created scheme is fine.
3. Delete the boilerplate `ShareViewController.swift` and `MainInterface.storyboard`
   Xcode generated, then **Add Files…** and add this folder's
   `ShareViewController.swift`, `Info.plist` and `ShareExtension.entitlements`
   to the `ShareExtension` target. Set the target's *Info.plist File* and
   *Code Signing Entitlements* build settings to the added files. Remove the
   `NSExtensionMainStoryboard` key if Xcode added one (this extension is
   programmatic — it uses `NSExtensionPrincipalClass`).
4. Select the **App** target > *Signing & Capabilities* > **+ Capability >
   App Groups**, and enable `group.com.metic.app`. Confirm its
   `CODE_SIGN_ENTITLEMENTS` points at `App/App/App.entitlements`.
5. Select the **ShareExtension** target > *Signing & Capabilities* >
   **App Groups**, enable the same `group.com.metic.app`.
6. Set both targets to the same Team and let automatic signing register the
   App Group and the new extension's provisioning profile.
7. Build & run on a device. Share a metprofiles link (or a `.json` profile file,
   or selected profile JSON text) from another app; Metic should foreground and
   auto-import via the same flow as the web `?import=` parameter.

## Notes

- Keep `group.com.metic.app` identical across `capacitor.config.ts`, both
  `.entitlements` files and `ShareViewController.swift`.
- App-side handling is `apps/web/src/services/shareImport.ts` +
  the `registerShareTargetListener` effect in `apps/web/src/App.tsx`. The
  resolver that turns the shared source into a profile is
  `@metic/core` `logic/profileSource.ts` — shared with web and the Bun server.
