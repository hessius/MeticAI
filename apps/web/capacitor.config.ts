import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.metic.app',
  appName: 'Metic.',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    // Enable Safari Web Inspector for debugging (Develop → Simulator → Metic)
    webContentsDebuggingEnabled: true,
  },
  ios: {
    // Capacitor defaults the Xcode scheme to "App"; override for our renamed target
    scheme: 'Metic',
    // Match the dark theme background so safe area edges blend seamlessly
    backgroundColor: '#030202',
    allowsLinkPreview: false,
    // Let CSS env(safe-area-inset-*) handle all insets — disable native adjustment
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: false,
  },
  android: {
    // Match the dark theme background so safe area edges blend seamlessly
    backgroundColor: '#030202',
  },
  plugins: {
    Camera: {
      // iOS camera permissions are declared in Info.plist
    },
    Preferences: {
      // Uses UserDefaults on iOS — no configuration needed
    },
    CapacitorShareTarget: {
      // App Group shared between the main app and the iOS Share Extension.
      // Must match the App Group capability on both targets in Xcode.
      appGroupId: 'group.com.metic.app',
    },
  },
}

export default config
