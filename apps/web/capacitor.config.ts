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
    // Match the dark theme background so overscroll bounce doesn't show white
    backgroundColor: '#151413',
    allowsLinkPreview: false,
    contentInset: 'automatic',
    limitsNavigationsToAppBoundDomains: false,
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
