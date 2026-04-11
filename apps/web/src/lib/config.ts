import { isDirectMode, isDemoMode, isNativePlatform, getDefaultMachineUrl } from './machineMode';

/**
 * Configuration loader for application settings
 * Reads configuration from config.json file
 */

interface AppConfig {
  serverUrl?: string;
}

let cachedConfig: AppConfig | null = null;

/**
 * Loads the application configuration from config.json
 * Falls back to default values if config file is not found or invalid
 * @returns Promise<AppConfig> The application configuration
 */
export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  // In direct/native mode, no config.json exists — use defaults immediately.
  // For native (Capacitor), serverUrl is the stored machine URL so that
  // hooks using getServerUrl() make requests to the machine, not the WebView.
  if (isDirectMode() || isDemoMode()) {
    cachedConfig = getDefaultConfig();
    return cachedConfig;
  }

  try {
    const base = import.meta.env.BASE_URL || '/';
    const response = await fetch(`${base}config.json`);
    if (!response.ok) {
      // Expected when running without a config file — use defaults silently
      cachedConfig = getDefaultConfig();
      return cachedConfig;
    }
    
    // Guard against SPA fallback returning index.html instead of JSON
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // SPA fallback returned HTML — use defaults silently
      cachedConfig = getDefaultConfig();
      return cachedConfig;
    }
    
    const config: AppConfig = await response.json();
    cachedConfig = { ...getDefaultConfig(), ...config };
    return cachedConfig!;
  } catch (error) {
    console.warn('Failed to load config.json, using default configuration:', error);
    cachedConfig = getDefaultConfig();
    return cachedConfig;
  }
}

/**
 * Returns the default configuration.
 *
 * In native mode (Capacitor), serverUrl is set to the machine URL
 * so that hooks making API calls (useShotHistory, useMachineTelemetry, etc.)
 * route to the machine instead of the WebView origin.
 *
 * In machine-hosted direct mode (PWA on port 8080), serverUrl stays empty
 * because relative URLs already resolve to the machine.
 */
function getDefaultConfig(): AppConfig {
  if (isNativePlatform()) {
    return { serverUrl: getDefaultMachineUrl() };
  }
  return { serverUrl: '' };
}

/**
 * Gets the server URL from configuration
 * @returns Promise<string> The server URL
 */
export async function getServerUrl(): Promise<string> {
  const config = await loadConfig();
  return config.serverUrl ?? '';
}

/**
 * Invalidate cached config (e.g., when machine URL changes in native mode).
 */
export function resetConfig(): void {
  cachedConfig = null;
}
