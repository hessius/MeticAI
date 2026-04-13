import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.meticai.app',
  appName: 'MeticAI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Enable Safari Web Inspector for debugging (Develop → Simulator → MeticAI)
    webContentsDebuggingEnabled: true,
  },
  ios: {
    // Match the dark theme background so safe area edges blend seamlessly
    backgroundColor: '#030202',
    allowsLinkPreview: false,
    // Let CSS env(safe-area-inset-*) handle all insets — disable native adjustment
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: false,
  },
  plugins: {
    Camera: {
      // iOS camera permissions are declared in Info.plist
    },
    Preferences: {
      // Uses UserDefaults on iOS — no configuration needed
    },
  },
}

export default config
