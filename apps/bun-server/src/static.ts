/**
 * Static file serving for the built frontend (SPA).
 *
 * Serves `frontend/dist` with sensible cache headers: fingerprinted assets are
 * cached immutably, HTML is never cached, and unknown non-asset routes fall
 * back to `index.html` so client-side routing works on deep links.
 */

import { existsSync } from "node:fs";
import { join, normalize, extname } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";

export function createStaticServer(rootDir: string) {
  const indexPath = join(rootDir, "index.html");

  const serveFile = (absPath: string, cacheControl: string): Response => {
    const ext = extname(absPath).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    return new Response(Bun.file(absPath), {
      headers: { "content-type": type, "cache-control": cacheControl },
    });
  };

  return async function serveStatic(pathname: string): Promise<Response> {
    // Resolve within rootDir only; reject traversal.
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    let candidate = join(rootDir, rel);
    if (!candidate.startsWith(rootDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (pathname === "/" || pathname === "") {
      candidate = indexPath;
    }

    if (existsSync(candidate) && !candidate.endsWith("/")) {
      const isHtml = candidate.endsWith(".html");
      return serveFile(candidate, isHtml ? NO_CACHE : IMMUTABLE);
    }

    // SPA fallback: unknown routes without a file extension serve index.html.
    if (!extname(pathname) && existsSync(indexPath)) {
      return serveFile(indexPath, NO_CACHE);
    }

    return new Response("Not found", { status: 404 });
  };
}
