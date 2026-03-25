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
  AUTHOR_NAME: 'meticai-author-name',

  // -- Direct mode caches --
  PROFILE_LIST_CACHE: 'meticai-direct-profile-list',
  DESCRIPTION_CACHE: 'meticai-direct-desc-cache',
  POUR_OVER_PREFS: 'meticai-direct-pour-over-prefs',
} as const
