/**
 * Client-side profile recommendation engine.
 *
 * TypeScript port of the Python `ProfileRecommendationService` scoring
 * logic from `profile_recommendation_service.py`. Runs entirely in the
 * browser — no backend required. Used by DirectModeInterceptor to back
 * the `/api/profiles/find-similar` and `/api/profiles/recommend` endpoints.
 *
 * Scoring allocates 100 points across 5 dimensions:
 *   - Stage structure fingerprint: 35
 *   - Tag/keyword matching:        25
 *   - Target weight similarity:    15
 *   - Peak pressure similarity:    15
 *   - Temperature similarity:      10
 */

import {
  extractFingerprint,
  extractNameTags,
  type AnalyzableProfile,
  type ProfileFingerprint,
} from './profileAnalysis'

// ── Types ──────────────────────────────────────────────────────────────────

export interface Recommendation {
  profile_name: string
  score: number
  explanation: string
  match_reasons: string[]
}

// ── Jaccard similarity ─────────────────────────────────────────────────────

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  const union = new Set([...a, ...b])
  if (union.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  return intersection / union.size
}

// ── Proximity scoring ──────────────────────────────────────────────────────

function proximityScore(
  a: number | null,
  b: number | null,
  fullRange: number,
  partialRange: number,
  maxPoints: number,
): number {
  if (a == null || b == null) return 0
  const diff = Math.abs(a - b)
  if (diff <= fullRange) return maxPoints
  if (diff <= partialRange) {
    const frac = 1 - (diff - fullRange) / (partialRange - fullRange)
    return Math.round(frac * maxPoints * 10) / 10
  }
  return 0
}

// ── Main scoring function ──────────────────────────────────────────────────

/**
 * Score a candidate profile against user tags and fingerprint.
 * Faithful port of Python `_score_profile()`.
 */
function scoreProfile(
  userTags: Set<string>,
  userFingerprint: ProfileFingerprint | null,
  candidate: AnalyzableProfile,
): { score: number; matchReasons: string[]; explanation: string } {
  const reasons: string[] = []
  let score = 0

  const candFp = extractFingerprint(candidate)
  const candTags = extractNameTags(candidate)

  // --- Stage structure (35 points) ---
  if (userFingerprint) {
    let structScore = 0

    // Control mode match (pressure/flow/mixed) — 12 pts
    if (userFingerprint.controlMode === candFp.controlMode) {
      structScore += 12
      reasons.push(`${candFp.controlMode.charAt(0).toUpperCase() + candFp.controlMode.slice(1)}-controlled`)
    } else if (
      userFingerprint.controlMode !== 'unknown' &&
      candFp.controlMode !== 'unknown'
    ) {
      if (userFingerprint.controlMode === 'mixed' || candFp.controlMode === 'mixed') {
        structScore += 4
      }
    }

    // Technique feature overlap — 15 pts
    const userTechniques = userFingerprint.techniqueTags
    const candTechniques = candFp.techniqueTags
    if (userTechniques.size > 0 || candTechniques.size > 0) {
      const techSim = jaccard(userTechniques, candTechniques)
      structScore += techSim * 15
      const overlap: string[] = []
      for (const t of userTechniques) {
        if (candTechniques.has(t)) overlap.push(t)
      }
      if (overlap.length > 0) {
        reasons.push(`Techniques: ${overlap.sort().join(', ')}`)
      }
    }

    // Stage count similarity — 4 pts
    const countDiff = Math.abs(userFingerprint.stageCount - candFp.stageCount)
    if (countDiff === 0) structScore += 4
    else if (countDiff <= 1) structScore += 2
    else if (countDiff <= 2) structScore += 1

    // Flat profile match — 4 pts
    if (userFingerprint.isFlat === candFp.isFlat) {
      structScore += 4
      if (candFp.isFlat) {
        reasons.push('Flat profile')
      }
    }

    score += Math.min(structScore, 35)
  }

  // --- Tag matching (25 points) ---
  const userLower = new Set([...userTags].map(t => t.toLowerCase()))
  // Merge structural technique tags into candidate tags for broader matching
  const allCandTags = new Set([...candTags, ...candFp.techniqueTags])
  if (userLower.size > 0) {
    const tagSim = jaccard(userLower, allCandTags)
    const tagPts = tagSim * 25
    score += tagPts

    const overlap: string[] = []
    for (const t of userLower) {
      if (allCandTags.has(t)) overlap.push(t)
    }
    if (overlap.length > 0) {
      // Filter out already-reported technique tags
      const userTechTags = userFingerprint?.techniqueTags ?? new Set<string>()
      const tagOnly = overlap.filter(t => !userTechTags.has(t))
      if (tagOnly.length > 0) {
        reasons.push(`Matching: ${tagOnly.sort().join(', ')}`)
      }
    }
  }

  // --- Target weight (15 points) ---
  const userWeight = userFingerprint?.finalWeight ?? null
  const candWeight = candFp.finalWeight
  const wPts = proximityScore(userWeight, candWeight, 2.0, 10.0, 15)
  score += wPts
  if (wPts >= 10 && candWeight != null) {
    reasons.push(`Target weight: ${Math.round(candWeight)}g`)
  }

  // --- Peak pressure (15 points) ---
  const userPeak = userFingerprint?.peakPressure ?? 0
  const candPeak = candFp.peakPressure
  if (userPeak > 0 && candPeak > 0) {
    const pPts = proximityScore(userPeak, candPeak, 0.5, 3.0, 15)
    score += pPts
    if (pPts >= 10) {
      reasons.push(`Peak pressure: ${candPeak.toFixed(1)} bar`)
    }
  }

  // --- Temperature (10 points) ---
  const userTemp = userFingerprint?.temperature ?? null
  const candTemp = candFp.temperature
  const tPts = proximityScore(userTemp, candTemp, 2.0, 5.0, 10)
  score += tPts
  if (tPts >= 7 && candTemp != null) {
    reasons.push(`Temperature: ${candTemp.toFixed(1)}°C`)
  }

  const explanation = reasons.join('; ')
  const finalScore = Math.min(Math.round(score * 10) / 10, 100)

  return { score: finalScore, matchReasons: reasons, explanation }
}

// ── User fingerprint from tags ─────────────────────────────────────────────

/**
 * Build a synthetic fingerprint from user tags.
 * Port of Python `_build_user_fingerprint()`.
 */
function buildUserFingerprint(
  userTags: Set<string>,
): ProfileFingerprint {
  const techniqueTags = new Set<string>()

  const tagToTechnique: Record<string, string> = {
    preinfusion: 'preinfusion',
    'pre-infusion': 'preinfusion',
    bloom: 'bloom',
    soak: 'bloom',
    pulse: 'pulse',
    lever: 'lever',
    turbo: 'turbo',
    ramp: 'ramp',
    decline: 'decline',
    taper: 'taper',
    flat: 'flat',
    pressure: 'pressure-profile',
    flow: 'flow-profile',
  }

  for (const tag of userTags) {
    const tLower = tag.toLowerCase()
    if (tLower in tagToTechnique) {
      techniqueTags.add(tagToTechnique[tLower])
    }
  }

  let controlMode: ProfileFingerprint['controlMode'] = 'unknown'
  if (techniqueTags.has('pressure-profile')) controlMode = 'pressure'
  else if (techniqueTags.has('flow-profile')) controlMode = 'flow'

  let stageCount = 2
  if (techniqueTags.has('preinfusion')) stageCount += 1
  if (techniqueTags.has('bloom')) stageCount += 1
  if (techniqueTags.has('pulse')) stageCount = Math.max(stageCount, 5)

  return {
    stageTypes: [],
    controlMode,
    hasPreinfusion: techniqueTags.has('preinfusion'),
    hasBloom: techniqueTags.has('bloom'),
    hasPulse: techniqueTags.has('pulse'),
    isFlat: techniqueTags.has('flat'),
    peakPressure: 0,
    stageCount,
    techniqueTags,
    temperature: null,
    finalWeight: null,
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Find profiles structurally similar to a given source profile.
 * Port of Python `ProfileRecommendationService.find_similar()`.
 */
export function findSimilarProfiles(
  sourceProfile: AnalyzableProfile,
  allProfiles: AnalyzableProfile[],
  limit = 10,
): Recommendation[] {
  const sourceFp = extractFingerprint(sourceProfile)
  const sourceTags = extractNameTags(sourceProfile)
  const sourceName = sourceProfile.name ?? ''

  const scored: Recommendation[] = []
  for (const p of allProfiles) {
    if ((p.name ?? '') === sourceName) continue
    const { score, matchReasons, explanation } = scoreProfile(sourceTags, sourceFp, p)
    scored.push({
      profile_name: p.name ?? 'Unknown',
      score,
      explanation,
      match_reasons: matchReasons,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.filter(s => s.score > 0).slice(0, limit)
}

/**
 * Get profile recommendations based on user-selected tags.
 * Port of Python `ProfileRecommendationService.get_recommendations()`.
 */
export function getRecommendations(
  tags: string[],
  allProfiles: AnalyzableProfile[],
  limit = 5,
): Recommendation[] {
  if (allProfiles.length === 0) return []

  const userTags = new Set(tags)
  const userFingerprint = buildUserFingerprint(userTags)

  const scored: Recommendation[] = []
  for (const p of allProfiles) {
    const { score, matchReasons, explanation } = scoreProfile(userTags, userFingerprint, p)
    scored.push({
      profile_name: p.name ?? 'Unknown',
      score,
      explanation,
      match_reasons: matchReasons,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.filter(s => s.score > 0).slice(0, limit)
}
