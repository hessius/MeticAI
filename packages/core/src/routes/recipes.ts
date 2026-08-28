/**
 * Recipe library route family.
 *
 * Serves the bundled pour-over recipe library, sorted alphabetically by name.
 * Data lives in ../data/recipes.ts as the single source of truth, shared by the
 * Node/Bun server and the browser/Capacitor runtime (mirroring the native
 * DirectModeInterceptor oracle and the Python recipes.py at parity).
 *
 * Routes:
 *   GET /api/recipes           -> the full recipe list
 *   GET /api/recipes/{slug}    -> a single recipe by slug (404 when unknown)
 */

import type { Platform } from "../platform";
import { jsonResponse, notFound } from "../http";
import { POUR_OVER_RECIPES } from "../data/recipes";

export async function handleRecipesRoutes(
  req: Request,
  _platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/recipes" && req.method === "GET") {
    return jsonResponse(POUR_OVER_RECIPES);
  }

  const slugMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
  if (slugMatch && req.method === "GET") {
    const slug = decodeURIComponent(slugMatch[1]!);
    const recipe = POUR_OVER_RECIPES.find((r) => r.slug === slug);
    if (!recipe) return notFound(`Recipe not found: ${slug}`);
    return jsonResponse(recipe);
  }

  return null;
}
