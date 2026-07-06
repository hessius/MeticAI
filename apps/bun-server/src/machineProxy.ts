/**
 * Transparent reverse proxy for the machine's native `/api/v1/*` surface.
 *
 * The frontend talks to the machine's espresso API exactly as it does today; in
 * proxy mode this server forwards those requests upstream unchanged (method,
 * body, headers, status, and streamed response body), so machine behavior is
 * identical to hitting the machine directly. This replaces the nginx + Python
 * pass-through of the 2.x container.
 */

import type { Platform } from "@metic/core/platform";

// Hop-by-hop headers must not be forwarded across a proxy (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function filterHeaders(headers: Headers): Headers {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

export function isMachinePath(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

export async function proxyToMachine(
  request: Request,
  platform: Platform,
): Promise<Response> {
  const baseUrl = platform.machine.getBaseUrl();
  if (!baseUrl) {
    return new Response(
      JSON.stringify({ error: "Machine address not configured" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  const incoming = new URL(request.url);
  const target = `${baseUrl}${incoming.pathname}${incoming.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: filterHeaders(request.headers),
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Bun/undici require this when streaming a request body through fetch.
    (init as { duplex?: string }).duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    platform.logger.error("machine proxy request failed", {
      target,
      message: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: "Machine unreachable" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: filterHeaders(upstream.headers),
  });
}
