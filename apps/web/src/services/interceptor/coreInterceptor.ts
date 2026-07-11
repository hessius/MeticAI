import { tryHandle, type Platform } from "@metic/core";
import { createBrowserPlatform } from "@/services/platform/browserPlatform";
import { getDirectRequestContext, isMeticAIProxyApiPath, jsonResponse } from "./directModeHttp";
import { handleBrowserNativeRoutes } from "./browserNativeRoutes";

export interface CoreInterceptorDeps {
  /**
   * The original, unpatched `window.fetch`, captured before the interceptor was
   * installed. Used by the browser Platform (and the machine-native passthrough)
   * to reach the machine without re-entering this interceptor.
   */
  originalFetch: typeof fetch;
}

function currentOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "http://localhost";
}

/**
 * Normalise any fetch input into a single `Request` with an absolute URL and a
 * buffered body, so it can be cloned for the browser-native shim and the core
 * handler (constructing a `Request` from another `Request` would otherwise
 * disturb the original's body).
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
 * Install the shared `@metic/core` handler as the direct-mode request path.
 *
 * MeticAI proxy API routes (`/api/*`, excluding machine-native `/api/v1/*`) are
 * served by, in order: the browser-native shim (canvas/sessionStorage-bound
 * routes core cannot own) and then core's `tryHandle`. A route owned by neither
 * returns a terminal 404, matching core's server-side `handle`. Machine-native
 * and external URLs bypass core entirely and go to the original fetch.
 */
export function installCoreInterceptor(deps: CoreInterceptorDeps): void {
  const { originalFetch } = deps;
  const platform: Platform = createBrowserPlatform({ fetchImpl: originalFetch });

  window.fetch = function coreModeFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const { url } = getDirectRequestContext(input, init);

    // Machine-native (`/api/v1/*`) and external URLs are not core's concern.
    if (!isMeticAIProxyApiPath(url)) {
      return originalFetch(input, init);
    }

    return (async () => {
      const canonical = toCanonicalRequest(input, init);
      try {
        const native = await handleBrowserNativeRoutes(canonical.clone(), platform);
        if (native) return native;
        const handled = await tryHandle(canonical.clone(), platform);
        if (handled) return handled;
      } catch (err) {
        console.error("[coreInterceptor] handler threw", err);
        return jsonResponse(
          { detail: err instanceof Error ? err.message : "Internal error" },
          500,
        );
      }
      const { pathname } = new URL(canonical.url);
      return jsonResponse({ detail: `No route for ${canonical.method} ${pathname}` }, 404);
    })();
  };
}
