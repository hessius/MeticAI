/**
 * Single source of truth for the shot-analysis section structure (L2).
 * Consumed by the prompt builders and the structural linter so the format the model is asked
 * to produce and the format we validate can never drift apart.
 * Mirror of apps/server/analysis_schema.py.
 */

export const REQUIRED_ANALYSIS_SECTIONS = [
  'Shot Performance',
  'Root Cause Analysis',
  'Setup Recommendations',
  'Profile Recommendations',
  'Profile Design Observations',
] as const

/** Optional taste section appended when compass taste is supplied. */
export const OPTIONAL_TASTE_SECTION = 'Taste-Based Recommendations'
