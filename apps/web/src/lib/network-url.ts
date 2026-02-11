/**
 * Utility functions for getting network URLs
 */

import { getServerUrl } from './config'

/**
 * Gets the current page URL with network-accessible hostname.
 *
 * Resolution order when the page is served from localhost:
 *  1. Ask the backend for its auto-detected LAN IP  (/api/network-ip)
 *  2. Fall back to the serverUrl in config.json
 *  3. Return the current (localhost) URL as a last resort
 */
export async function getNetworkUrl(): Promise<string> {
  const currentUrl = new URL(window.location.href);
  
  // If not localhost, the URL is already network-accessible
  if (!isLocalhostUrl()) {
    return currentUrl.href;
  }
  
  // 1. Try auto-detected LAN IP from the backend
  try {
    const res = await fetch('/api/network-ip');
    if (res.ok) {
      const data = await res.json();
      const ip: string | undefined = data?.ip;
      if (ip && ip !== '127.0.0.1' && ip !== '::1') {
        currentUrl.hostname = ip;
        return currentUrl.href;
      }
    }
  } catch {
    // Non-fatal – try config.json next
  }
  
  // 2. Fall back to configured serverUrl
  try {
    const serverUrl = await getServerUrl();
    if (serverUrl) {
      const serverUrlObj = new URL(serverUrl);
      const serverHostname = serverUrlObj.hostname;
      if (serverHostname && serverHostname !== 'localhost' && serverHostname !== '127.0.0.1' && serverHostname !== '::1') {
        currentUrl.hostname = serverHostname;
        return currentUrl.href;
      }
    }
  } catch {
    // Non-fatal
  }
  
  // 3. Last resort – return localhost URL
  return currentUrl.href;
}

/**
 * Checks if the current URL is a localhost URL
 * @returns boolean True if the URL is localhost
 */
export function isLocalhostUrl(): boolean {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
