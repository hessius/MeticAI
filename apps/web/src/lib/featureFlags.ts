/**
 * Feature flags — conditionally enable/disable features based on deployment mode.
 *
 * In proxy mode (Docker): all features available via backend
 * In direct mode (PWA): some features removed or degraded
 */

import { isDirectMode } from '@/lib/machineMode'

export interface FeatureFlags {
  /** mDNS auto-discovery of machine on local network */
  machineDiscovery: boolean
  /** Scheduled/recurring shot execution */
  scheduledShots: boolean
  /** System restart/update commands */
  systemManagement: boolean
  /** Tailscale VPN configuration */
  tailscaleConfig: boolean
  /** MCP server integration */
  mcpServer: boolean
  /** Profile cloud sync (server-side) */
  cloudSync: boolean
  /** AI features (profile gen, analysis, image gen) */
  aiFeatures: boolean
  /** Real-time telemetry from machine */
  liveTelemetry: boolean
  /** Shot history browsing */
  shotHistory: boolean
  /** Profile CRUD */
  profileManagement: boolean
  /** Pour-over mode */
  pourOver: boolean
  /** Espresso compass / dial-in guide */
  dialIn: boolean
  /** Profile recommendations */
  recommendations: boolean
  /** PWA install prompt */
  pwaInstall: boolean
  /** Backend health/bridge status monitoring */
  bridgeStatus: boolean
  /** Watchtower update trigger */
  watchtowerUpdate: boolean
}

const PROXY_FLAGS: FeatureFlags = {
  machineDiscovery: true,
  scheduledShots: true,
  systemManagement: true,
  tailscaleConfig: true,
  mcpServer: true,
  cloudSync: true,
  aiFeatures: true,
  liveTelemetry: true,
  shotHistory: true,
  profileManagement: true,
  pourOver: true,
  dialIn: true,
  recommendations: true,
  pwaInstall: false,
  bridgeStatus: true,
  watchtowerUpdate: true,
}

const DIRECT_FLAGS: FeatureFlags = {
  machineDiscovery: false,   // Browsers can't do mDNS
  scheduledShots: false,     // No persistent scheduler in browser
  systemManagement: false,   // Requires OS access
  tailscaleConfig: false,    // CLI tool, not applicable
  mcpServer: false,          // Server-side integration
  cloudSync: false,          // No server-side storage
  aiFeatures: true,          // Via @google/genai in browser
  liveTelemetry: true,       // Via Socket.IO direct
  shotHistory: true,         // Via espresso-api
  profileManagement: true,   // Via espresso-api
  pourOver: true,            // Timer + espresso-api commands
  dialIn: true,              // Client-side + Gemini
  recommendations: true,     // Token-free engine + optional AI
  pwaInstall: true,          // Show PWA install prompt
  bridgeStatus: false,       // No backend bridge
  watchtowerUpdate: false,   // No watchtower in direct mode
}

let cachedFlags: FeatureFlags | null = null

export function getFeatureFlags(): FeatureFlags {
  if (!cachedFlags) {
    cachedFlags = isDirectMode() ? { ...DIRECT_FLAGS } : { ...PROXY_FLAGS }
  }
  return cachedFlags
}

export function hasFeature(feature: keyof FeatureFlags): boolean {
  return getFeatureFlags()[feature]
}

/** Reset cached flags (useful for testing) */
export function resetFeatureFlags(): void {
  cachedFlags = null
}
