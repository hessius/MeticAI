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

  try {
    const response = await fetch('/config.json');
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
 * Returns the default configuration
 * @returns AppConfig The default configuration
 */
function getDefaultConfig(): AppConfig {
  return {
    serverUrl: ''
  };
}

/**
 * Gets the server URL from configuration
 * @returns Promise<string> The server URL
 */
export async function getServerUrl(): Promise<string> {
  const config = await loadConfig();
  return config.serverUrl ?? '';
}
