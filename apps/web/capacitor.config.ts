import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.meticai.app',
  appName: 'MeticAI',
  webDir: 'dist',
  server: {
    // Allow mixed content for local network HTTP connections to the machine
    androidScheme: 'https',
    iosScheme: 'https',
    // Enable Safari Web Inspector for debugging (Develop → Simulator → MeticAI)
    webContentsDebuggingEnabled: true,
  },
  ios: {
    // Allow clear-text HTTP to local network (machine API on port 8080)
    allowsLinkPreview: false,
    contentInset: 'automatic',
    limitsNavigationsToAppBoundDomains: false,
    // Scroll content when keyboard appears (prevents input fields from being hidden)
    scrollEnabled: true,
  },
  plugins: {
    Camera: {
      // iOS camera permissions are declared in Info.plist
    },
    Preferences: {
      // Uses UserDefaults on iOS — no configuration needed
    },
    Keyboard: {
      // Resize viewport when keyboard appears — prevents content from being hidden
      resize: 'body',
      // Show accessory bar with Done button above keyboard
      resizeOnFullScreen: true,
    },
  },
}

export default config
