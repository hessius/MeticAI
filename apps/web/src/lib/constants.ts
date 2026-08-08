/**
 * Shared localStorage key constants — single source of truth for all
 * storage keys used across the application.
 *
 * Using string constants prevents key mismatches between components
 * that read and write the same values.
 */

// -- User settings (persisted in direct/PWA mode) --
export const STORAGE_KEYS = {
  GEMINI_API_KEY: 'meticai-gemini-key',
  GEMINI_MODEL: 'meticai-gemini-model',
  AUTHOR_NAME: 'meticai-author-name',

  // -- AI provider selection (#491). Gemini keeps its legacy keys above for
  // backward compatibility; other providers use namespaced key/model entries. --
  AI_PROVIDER: 'meticai-ai-provider',
  AI_KEY_PREFIX: 'meticai-ai-key-',
  AI_MODEL_PREFIX: 'meticai-ai-model-',

  // -- On-device AI / four-mode routing (#373). AI_MODE is the top-level
  // selector (none | local | hosted | both); when 'both', each text method is
  // routed to local or hosted via the AI_ROUTE_* keys. LOCAL_MODEL_* track the
  // selected on-device backend and any downloaded Gemma model path. --
  AI_MODE: 'meticai-ai-mode',
  LOCAL_MODEL_TYPE: 'meticai-local-model-type',
  LOCAL_MODEL_PATH: 'meticai-local-model-path',
  AI_ROUTE_ANALYZE_SHOT: 'meticai-ai-route-analyze-shot',
  AI_ROUTE_GENERATE_PROFILE: 'meticai-ai-route-generate-profile',
  AI_ROUTE_RECOMMENDATIONS: 'meticai-ai-route-recommendations',
  AI_ROUTE_DIAL_IN: 'meticai-ai-route-dial-in',

  // -- Direct mode caches --
  PROFILE_LIST_CACHE: 'meticai-direct-profile-list',
  DESCRIPTION_CACHE: 'meticai-direct-desc-cache',
  AI_TAGS_CACHE: 'meticai-direct-ai-tags-cache',
  ANALYSIS_CACHE: 'meticai-direct-analysis-cache',
  POUR_OVER_PREFS: 'meticai-direct-pour-over-prefs',

  // -- Machine connection --
  MACHINE_URL: 'meticai-machine-url',

  // -- Favourites (#584 iOS widgets) --
  FAVOURITES: 'meticai-favourites',
  OPEN_APP_ON_START: 'meticai-open-app-on-start',

  // -- Onboarding --
  ONBOARDING_COMPLETE: 'meticai-onboarding-complete',

  // -- Usage tracking --
  INSTALL_DATE: 'meticai-install-date',
  SESSION_COUNT: 'meticai-session-count',

  // -- Greeting tracking --
  GREETING_LOG: 'meticai-greeting-log',
  LAST_GREETING_ID: 'meticai-last-greeting',
  PERSONAL_BEST_SHOTS_DAY: 'meticai-best-shots-day',

  // -- Sound effects --
  SOUNDS_ENABLED: 'meticai-sounds-enabled',

  // -- Demo mode --
  DEMO_PREV_URL: 'meticai-demo-prev-url',
  DEMO_PROFILES: 'meticai-demo-profiles',
  DEMO_SHOTS: 'meticai-demo-shots',
  DEMO_ANNOTATIONS: 'meticai-demo-annotations',
} as const

/** Dispatched on window when the favourites list changes (#584). */
export const FAVOURITES_CHANGED = 'favourites-changed'

/** Maximum number of favourites (bounds App-Group storage for iOS widgets). */
export const FAVOURITES_MAX = 12
