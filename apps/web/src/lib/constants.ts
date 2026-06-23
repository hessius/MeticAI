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

  // -- Direct mode caches --
  PROFILE_LIST_CACHE: 'meticai-direct-profile-list',
  DESCRIPTION_CACHE: 'meticai-direct-desc-cache',
  AI_TAGS_CACHE: 'meticai-direct-ai-tags-cache',
  ANALYSIS_CACHE: 'meticai-direct-analysis-cache',
  POUR_OVER_PREFS: 'meticai-direct-pour-over-prefs',

  // -- Machine connection --
  MACHINE_URL: 'meticai-machine-url',

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
