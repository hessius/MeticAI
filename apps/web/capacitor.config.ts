import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.meticai.app',
  appName: 'MeticAI',
  webDir: 'dist',
  server: {
    // Allow mixed content for local network HTTP connections to the machine
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    // Allow clear-text HTTP to local network (machine API on port 8080)
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
