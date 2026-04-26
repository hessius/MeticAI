/**
 * Unified profile structural analysis module.
 *
 * TypeScript port of the Python `_extract_fingerprint()` and
 * `_extract_name_tags()` from `profile_recommendation_service.py`.
 * Single source of truth for profile analysis — used by the client-side
 * recommendation engine and auto-tag derivation.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProfileStage {
  name?: string
  type?: string
  dynamics?: {
    points?: unknown[][]
    over?: string
    interpolation?: string
  }
  limits?: { type?: string; value?: unknown }[]
  exit_triggers?: {
    type?: string
    value?: unknown
    comparison?: string
    relative?: boolean
  }[]
}

export interface AnalyzableProfile {
  name?: string
  temperature?: number
  final_weight?: number
  stages?: ProfileStage[]
}

export interface ProfileFingerprint {
  stageTypes: string[]
  controlMode: 'pressure' | 'flow' | 'mixed' | 'unknown'
  hasPreinfusion: boolean
  hasBloom: boolean
  hasPulse: boolean
  isFlat: boolean
  peakPressure: number
  stageCount: number
  techniqueTags: Set<string>
  temperature: number | null
  finalWeight: number | null
}

// ── Name keyword sets (match Python _NAME_KEYWORDS / _STAGE_KEYWORDS) ────

const NAME_KEYWORDS = new Set([
  'fruity', 'chocolate', 'nutty', 'floral', 'caramel', 'berry', 'citrus',
  'sweet', 'balanced', 'creamy', 'syrupy', 'light', 'medium', 'dark',
  'modern', 'italian', 'lever', 'turbo', 'bloom', 'long', 'short',
  'pre-infusion', 'pulse', 'acidity', 'funky', 'thin', 'mouthfeel',
  'ristretto', 'lungo', 'allonge', 'espresso', 'filter',
])

const STAGE_KEYWORDS = new Set([
  'preinfusion', 'pre-infusion', 'bloom', 'ramp', 'soak', 'infusion',
  'extraction', 'decline', 'taper', 'hold', 'pulse', 'turbo', 'lever',
  'flat', 'pressure', 'flow',
])

// ── Fingerprint extraction ─────────────────────────────────────────────────

/**
 * Extract a structural fingerprint from a profile.
 * Faithful port of Python `_extract_fingerprint()`.
 */
export function extractFingerprint(profile: AnalyzableProfile): ProfileFingerprint {
  const stages = profile.stages ?? []
  const temperature = profile.temperature ?? null
  const finalWeight = profile.final_weight ?? null

  const stageTypes: string[] = []
  let peakPressure = 0
  let hasPreinfusion = false
  let hasBloom = false
  let hasPulse = false
  let isFlat = true
  const techniqueTags = new Set<string>()

  for (const stage of stages) {
    const stype = (stage.type ?? '').toLowerCase()
    stageTypes.push(stype)
    const sname = (stage.name ?? '').toLowerCase()

    // Preinfusion detection
    if (sname.includes('preinfusion') || sname.includes('pre-infusion') || sname.includes('pre infusion')) {
      hasPreinfusion = true
      techniqueTags.add('preinfusion')
    }

    // Bloom detection
    if (sname.includes('bloom') || sname.includes('soak')) {
      hasBloom = true
      techniqueTags.add('bloom')
    }

    // Pulse detection
    if (sname.includes('pulse')) {
      hasPulse = true
      techniqueTags.add('pulse')
    }

    // Extract peak pressure from dynamics points
    const dynamics = stage.dynamics
    if (dynamics) {
      const points = dynamics.points ?? []
      for (const point of points) {
        if (Array.isArray(point) && point.length >= 2) {
          const yVal = Number(point[1])
          if (!isNaN(yVal) && stype === 'pressure' && yVal > peakPressure) {
            peakPressure = yVal
          }
        }
      }

      // Check for flatness (all y-values the same in dynamics)
      if (points.length >= 2) {
        const yValues: number[] = []
        for (const p of points) {
          if (Array.isArray(p) && p.length >= 2) {
            const val = Number(p[1])
            if (!isNaN(val)) yValues.push(val)
          }
        }
        if (yValues.length > 0) {
          const rounded = new Set(yValues.map(y => Math.round(y * 10) / 10))
          if (rounded.size > 1) {
            isFlat = false
          }
        }
      }
    }

    // Extract pressure limits
    const limits = stage.limits ?? []
    for (const limitObj of limits) {
      const ltype = (limitObj.type ?? '').toLowerCase()
      const lval = limitObj.value
      if (ltype === 'pressure' && lval != null) {
        const pval = Number(lval)
        if (!isNaN(pval) && pval > peakPressure) {
          peakPressure = pval
        }
      }
    }

    // Stage name technique keywords
    for (const kw of ['lever', 'turbo', 'ramp', 'decline', 'taper']) {
      if (sname.includes(kw)) {
        techniqueTags.add(kw)
      }
    }
  }

  // Determine control mode
  const pressureCount = stageTypes.filter(t => t === 'pressure').length
  const flowCount = stageTypes.filter(t => t === 'flow').length
  const total = pressureCount + flowCount
  let controlMode: ProfileFingerprint['controlMode'] = 'unknown'

  if (total === 0) {
    controlMode = 'unknown'
  } else if (pressureCount > 0 && flowCount === 0) {
    controlMode = 'pressure'
    techniqueTags.add('pressure-profile')
  } else if (flowCount > 0 && pressureCount === 0) {
    controlMode = 'flow'
    techniqueTags.add('flow-profile')
  } else {
    controlMode = 'mixed'
    techniqueTags.add('mixed-profile')
  }

  // Pulse heuristic: many short stages (>4 stages often indicates pulse-like)
  if (stages.length >= 5 && !hasPulse) {
    hasPulse = true
    techniqueTags.add('pulse')
  }

  if (hasPreinfusion) techniqueTags.add('preinfusion')
  if (hasBloom) techniqueTags.add('bloom')
  if (isFlat && stages.length <= 2) techniqueTags.add('flat')

  return {
    stageTypes,
    controlMode,
    hasPreinfusion,
    hasBloom,
    hasPulse,
    isFlat: isFlat && stages.length <= 2,
    peakPressure: Math.round(peakPressure * 10) / 10,
    stageCount: stages.length,
    techniqueTags,
    temperature,
    finalWeight,
  }
}

// ── Name tag extraction ────────────────────────────────────────────────────

/**
 * Extract keyword tags from profile name and stage names.
 * Faithful port of Python `_extract_name_tags()`.
 */
export function extractNameTags(profile: AnalyzableProfile): Set<string> {
  const tags = new Set<string>()
  const name = (profile.name ?? '').toLowerCase()

  for (const kw of NAME_KEYWORDS) {
    if (name.includes(kw)) {
      tags.add(kw)
    }
  }

  const stages = profile.stages ?? []
  for (const stage of stages) {
    const sname = (stage.name ?? '').toLowerCase()
    for (const kw of STAGE_KEYWORDS) {
      if (sname.includes(kw)) {
        tags.add(kw)
      }
    }
  }

  return tags
}
