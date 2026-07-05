import type { Platform } from "./platform";
import { jsonResponse, notFound } from "./http";

/**
 * The single shared request handler for the unified TS core.
 *
 * Both runtimes route Meticulous API requests through this function:
 *  - the browser installs it over `window.fetch` for direct (native) mode,
 *  - the Bun server consumes it via `Bun.serve({ fetch })` for proxy mode.
 *
 * Route families are registered incrementally in Phase 2; for now the handler
 * exposes only the health probe so the contract harness can lock the contract.
 */
export async function handle(req: Request, _platform: Platform): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (req.method === "GET" && pathname === "/api/health") {
    return jsonResponse({ status: "ok" });
  }

  return notFound(`No route for ${req.method} ${pathname}`);
}
