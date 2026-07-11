import { tryHandle } from "@metic/core";
import { createBrowserPlatform } from "@/services/platform/browserPlatform";
import { getDirectRequestContext, isMeticAIProxyApiPath } from "./directModeHttp";

export interface CoreInterceptorDeps {
  /**
   * The original, unpatched `window.fetch`, captured before any interceptor was
   * installed. Used by the browser Platform to reach the machine without
   * re-entering this or the legacy interceptor.
   */
  originalFetch: typeof fetch;
  /**
   * The handler to delegate to when core does not recognise a route. In
   * practice this is the already-installed `DirectModeInterceptor` fetch, so
   * every route core has not yet taken over keeps working unchanged.
   */
  fallbackFetch: typeof fetch;
}

function currentOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "http://localhost";
}

/**
 * Normalise any fetch input into a single `Request` with an absolute URL and a
 * buffered body, so it can be cloned for the core handler while remaining
 * usable for the fallback path (constructing a `Request` from another `Request`
 * would otherwise disturb the original's body).
 */
function toCanonicalRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request && !init) return input;
  const url =
    typeof input === "string"
      ? new URL(input, currentOrigin()).href
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input);
  return new Request(url, init ?? (input instanceof Request ? input : undefined));
}

/**
 * Layer the shared `@metic/core` handler on top of the existing direct-mode
 * fetch. For MeticAI proxy API paths it asks core first; core answers the
 * routes it owns and returns `null` for the rest, which delegates to
 * `fallbackFetch` (the legacy `DirectModeInterceptor`). Non-proxy URLs and
 * machine-native `/api/v1/...` calls bypass core entirely.
 *
 * Install AFTER `installDirectModeInterceptor()` so `fallbackFetch` is the
 * legacy interceptor.
 */
export function installCoreInterceptor(deps: CoreInterceptorDeps): void {
  const { originalFetch, fallbackFetch } = deps;
  const platform = createBrowserPlatform({ fetchImpl: originalFetch });

  window.fetch = function coreModeFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const { url } = getDirectRequestContext(input, init);

    // Only proxy-API routes are candidates for core; machine-native and
    // external URLs go straight to the legacy path.
    if (!isMeticAIProxyApiPath(url)) {
      return fallbackFetch(input, init);
    }

    return (async () => {
      const canonical = toCanonicalRequest(input, init);
      let handled: Response | null;
      try {
        handled = await tryHandle(canonical.clone(), platform);
      } catch (err) {
        console.error("[coreInterceptor] core handler threw; falling back", err);
        handled = null;
      }
      if (handled) return handled;
      return fallbackFetch(canonical);
    })();
  };
}
