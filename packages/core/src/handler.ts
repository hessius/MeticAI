import type { Platform } from "./platform";
import { jsonResponse, notFound } from "./http";
import { handleAnnotationRoutes } from "./routes/annotations";
import { handleDialInRoutes } from "./routes/dialin";
import { handlePourOverRoutes } from "./routes/pourover";
import { handleShotAnalysisRoutes } from "./routes/shots";
import { handleProfileRecommendationRoutes } from "./routes/profiles";
import { handleApplyRecommendationsRoute } from "./routes/profileApply";
import { handleRegenerateDescriptionRoute } from "./routes/profileDescription";
import { handleAnalyzeAndProfileRoute } from "./routes/analyzeAndProfile";
import { handleSystemRoutes } from "./routes/system";
import { handleHistoryRoutes } from "./routes/history";
import { handleShotsReadRoutes } from "./routes/shotsRead";
import { handleMachineCommandRoutes } from "./routes/machineCommands";

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

  const shotAnalysis = await handleShotAnalysisRoutes(req, platform);
  if (shotAnalysis) return shotAnalysis;

  const profileRecommendation = await handleProfileRecommendationRoutes(req, platform);
  if (profileRecommendation) return profileRecommendation;

  const applyRecommendations = await handleApplyRecommendationsRoute(req, platform);
  if (applyRecommendations) return applyRecommendations;

  const regenerateDescription = await handleRegenerateDescriptionRoute(req, platform);
  if (regenerateDescription) return regenerateDescription;

  const analyzeAndProfile = await handleAnalyzeAndProfileRoute(req, platform);
  if (analyzeAndProfile) return analyzeAndProfile;

  const system = await handleSystemRoutes(req, platform);
  if (system) return system;

  const history = await handleHistoryRoutes(req, platform);
  if (history) return history;

  const shotsRead = await handleShotsReadRoutes(req, platform);
  if (shotsRead) return shotsRead;

  const machineCommands = await handleMachineCommandRoutes(req, platform);
  if (machineCommands) return machineCommands;

  return notFound(`No route for ${req.method} ${pathname}`);
}
