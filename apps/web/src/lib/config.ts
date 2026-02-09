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
      console.warn('config.json not found, using default configuration');
      cachedConfig = getDefaultConfig();
      return cachedConfig;
    }
    
    const config = await response.json();
    cachedConfig = { ...getDefaultConfig(), ...config };
    return cachedConfig;
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
    serverUrl: 'http://localhost:8000'
  };
}

/**
 * Gets the server URL from configuration
 * @returns Promise<string> The server URL
 */
export async function getServerUrl(): Promise<string> {
  const config = await loadConfig();
  return config.serverUrl || getDefaultConfig().serverUrl!;
}
