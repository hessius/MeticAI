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
  let controlMode: ProfileFingerprint['controlMode']

  if (pressureCount > 0 && flowCount === 0) {
    controlMode = 'pressure'
    techniqueTags.add('pressure-profile')
  } else if (flowCount > 0 && pressureCount === 0) {
    controlMode = 'flow'
    techniqueTags.add('flow-profile')
  } else if (total > 0) {
    controlMode = 'mixed'
    techniqueTags.add('mixed-profile')
  } else {
    controlMode = 'unknown'
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

// ── Temperature range grouping ─────────────────────────────────────────────

/**
 * Map a temperature to a human-readable range label matching PRESET_TAGS.
 */
export function temperatureRange(temp: number): string {
  if (temp < 82) return 'Very low temp (<82°C)'
  if (temp <= 84) return 'Low temp (82–84°C)'
  if (temp <= 87) return 'Warm (85–87°C)'
  if (temp <= 90) return 'Medium temp (88–90°C)'
  if (temp <= 93) return 'High temp (91–93°C)'
  return 'Very high temp (94°C+)'
}

// ── Structural tag derivation ──────────────────────────────────────────────

/** Map internal fingerprint technique tags to PRESET_TAG labels. */
const TECHNIQUE_TO_LABEL: Record<string, string> = {
  'pressure-profile': 'Pressure-controlled',
  'flow-profile': 'Flow-controlled',
  'mixed-profile': 'Mixed-controlled',
  'preinfusion': 'Pre-infusion',
  'bloom': 'Bloom',
  'pulse': 'Pulse',
  'flat': 'Flat profile',
  'lever': 'Lever',
  'turbo': 'Turbo',
  'ramp': 'Ramp',
  'decline': 'Decline',
  'taper': 'Taper',
}

/**
 * Derive user-facing structural tags from a profile's stage data.
 * Returns sorted PRESET_TAG labels (e.g. "Bloom", "Flow-controlled", "High temp (91–93°C)").
 * Pure function — no side effects, no caching.
 *
 * When `profile.stages` is `undefined` (e.g. partial data from a list endpoint),
 * only temperature tags are derived. When `stages` is an explicit empty array `[]`,
 * the profile is treated as flat (intentionally empty).
 */
export function deriveStructuralTags(profile: AnalyzableProfile): string[] {
  const tags = new Set<string>()

  // Only run fingerprint/technique analysis when stage data is available.
  // Without stages we can't determine control mode, techniques, or flatness.
  if (profile.stages !== undefined) {
    const fp = extractFingerprint(profile)
    for (const tt of fp.techniqueTags) {
      const label = TECHNIQUE_TO_LABEL[tt]
      if (label) tags.add(label)
    }
  }

  // Temperature can come from the profile directly (available even in list responses)
  const temp = profile.temperature
  if (temp != null) {
    tags.add(temperatureRange(temp))
  }

  return [...tags].sort()
}
