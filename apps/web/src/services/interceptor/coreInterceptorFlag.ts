/**
 * Experimental flag: route direct/native-mode API calls through the shared
 * `@metic/core` handler (via the browser `Platform`) instead of the bespoke
 * `DirectModeInterceptor`.
 *
 * This is the incremental cutover switch for the 3.0.0 core migration. It is
 * OFF by default so the shipping native path (`DirectModeInterceptor`) is
 * unchanged; when enabled, core handles any route it recognises and everything
 * else falls through to the legacy interceptor, so it is safe to flip on for
 * on-device parity testing before `DirectModeInterceptor` is deleted.
 *
 * Enable at runtime from the browser console (persists across reloads):
 *   localStorage.setItem('metic:experimental:core-interceptor', 'true')
 * or per-load via the URL query `?coreInterceptor=1`.
 */
const STORAGE_KEY = "metic:experimental:core-interceptor";

export function isCoreInterceptorEnabled(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("coreInterceptor");
    if (q === "1" || q === "true") return true;
    if (q === "0" || q === "false") return false;
  } catch {
    /* ignore malformed URL */
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
