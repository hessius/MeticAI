/**
 * Dynamic Gemini model discovery & ranking.
 *
 * The implementation now lives in @metic/core so the Node server and the
 * browser/Capacitor runtime share one source of truth. This module is a thin
 * re-export shim kept for existing importers.
 */
export {
  rankModels,
  resolveWorkingModel,
  listAvailableModels,
  STATIC_FALLBACK_MODELS,
  __resetModelCache,
} from "@metic/core/ai/modelResolver";
export type {
  DiscoveredModel,
  ModelClient,
  AvailableModel,
} from "@metic/core/ai/modelResolver";
