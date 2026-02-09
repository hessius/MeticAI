/**
 * Utility functions for getting network URLs
 */

import { getServerUrl } from './config'

/**
 * Gets the current page URL with network-accessible hostname
 * If the current URL uses localhost and a server URL is configured with a non-localhost hostname,
 * replaces localhost with the configured server's hostname/IP for network access.
 * @returns Promise<string> The network-accessible URL
 */
export async function getNetworkUrl(): Promise<string> {
  const currentUrl = new URL(window.location.href);
  
  // If not localhost, return as-is
  if (!isLocalhostUrl()) {
    return currentUrl.href;
  }
  
  try {
    // Get configured server URL
    const serverUrl = await getServerUrl();
    const serverUrlObj = new URL(serverUrl);
    
    // If server URL is also localhost, return current URL
    const serverHostname = serverUrlObj.hostname;
    if (serverHostname === 'localhost' || serverHostname === '127.0.0.1' || serverHostname === '::1') {
      return currentUrl.href;
    }
    
    // Replace localhost with server's hostname/IP
    currentUrl.hostname = serverHostname;
    return currentUrl.href;
  } catch (error) {
    // If config loading fails, return current URL
    console.warn('Failed to get server URL for network access:', error);
    return currentUrl.href;
  }
}

/**
 * Checks if the current URL is a localhost URL
 * @returns boolean True if the URL is localhost
 */
export function isLocalhostUrl(): boolean {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
