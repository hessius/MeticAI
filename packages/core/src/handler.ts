import type { Platform } from "./platform";
import { jsonResponse, notFound } from "./http";
import { handleAnnotationRoutes } from "./routes/annotations";
import { handleDialInRoutes } from "./routes/dialin";
import { handlePourOverRoutes } from "./routes/pourover";

/**
 * The single shared request handler for the unified TS core.
 *
 * Both runtimes route Meticulous API requests through this function:
 *  - the browser installs it over `window.fetch` for direct (native) mode,
 *  - the Bun server consumes it via `Bun.serve({ fetch })` for proxy mode.
 *
 * Route families are registered incrementally; each `handle*Routes` dispatcher
 * returns `null` when the request is not one of its routes so the next family
 * can try it.
 */
export async function handle(req: Request, platform: Platform): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (req.method === "GET" && pathname === "/api/health") {
    return jsonResponse({ status: "ok" });
  }

  const annotation = await handleAnnotationRoutes(req, platform);
  if (annotation) return annotation;

  const dialIn = await handleDialInRoutes(req, platform);
  if (dialIn) return dialIn;

  const pourOver = await handlePourOverRoutes(req, platform);
  if (pourOver) return pourOver;

  return notFound(`No route for ${req.method} ${pathname}`);
}
