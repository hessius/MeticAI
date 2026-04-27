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
  maxFlow: number
  isAdaptive: boolean
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
  let maxFlow = 0
  let hasPreinfusion = false
  let hasBloom = false
  let hasPulse = false
  let isFlat = true
  let isAdaptive = false
  const techniqueTags = new Set<string>()

  /** Check if a value is a $variable reference */
  const isVarRef = (v: unknown): boolean => typeof v === 'string' && v.startsWith('$')

  for (const stage of stages) {
    const stype = (stage.type ?? '').toLowerCase()
    stageTypes.push(stype)
    const sname = (stage.name ?? '').toLowerCase()

    // Preinfusion detection (name-based)
    if (sname.includes('preinfusion') || sname.includes('pre-infusion') || sname.includes('pre infusion')) {
      hasPreinfusion = true
      techniqueTags.add('preinfusion')
    }

    // Bloom detection (name-based)
    if (sname.includes('bloom') || sname.includes('soak')) {
      hasBloom = true
      techniqueTags.add('bloom')
    }

    // Pulse detection
    if (sname.includes('pulse')) {
      hasPulse = true
      techniqueTags.add('pulse')
    }

    // Extract peak pressure and max flow from dynamics points
    const dynamics = stage.dynamics
    if (dynamics) {
      const points = dynamics.points ?? []
      for (const point of points) {
        if (Array.isArray(point) && point.length >= 2) {
          // Check for $variable references → adaptive
          if (isVarRef(point[0]) || isVarRef(point[1])) {
            isAdaptive = true
            continue
          }
          const yVal = Number(point[1])
          if (!isNaN(yVal)) {
            if (stype === 'pressure' && yVal > peakPressure) peakPressure = yVal
            if (stype === 'flow' && yVal > maxFlow) maxFlow = yVal
          }
        }
      }

      // Check for flatness (all y-values the same in dynamics)
      if (points.length >= 2) {
        const yValues: number[] = []
        for (const p of points) {
          if (Array.isArray(p) && p.length >= 2 && !isVarRef(p[1])) {
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

    // Extract pressure limits (also check for variable refs)
    const limits = stage.limits ?? []
    for (const limitObj of limits) {
      if (isVarRef(limitObj.value)) { isAdaptive = true; continue }
      const ltype = (limitObj.type ?? '').toLowerCase()
      const lval = limitObj.value
      if (ltype === 'pressure' && lval != null) {
        const pval = Number(lval)
        if (!isNaN(pval) && pval > peakPressure) {
          peakPressure = pval
        }
      }
    }

    // Check exit triggers for variable refs
    const exits = stage.exit_triggers ?? []
    for (const ex of exits) {
      if (isVarRef(ex.value)) { isAdaptive = true }
    }

    // Stage name technique keywords
    for (const kw of ['lever', 'turbo', 'ramp', 'decline', 'taper']) {
      if (sname.includes(kw)) {
        techniqueTags.add(kw)
      }
    }
  }

  // ── Structural bloom detection (content-based, not name-based) ──
  // A stage with all dynamics points at near-zero flow/pressure AND a time-based exit
  if (!hasBloom) {
    for (const stage of stages) {
      const stype = (stage.type ?? '').toLowerCase()
      const pts = stage.dynamics?.points ?? []
      const exits = stage.exit_triggers ?? []
      const hasTimeExit = exits.some(e => (e.type ?? '').toLowerCase() === 'time')

      // Zero/near-zero flow stage with time exit = bloom/soak
      if (stype === 'flow' && hasTimeExit && pts.length > 0) {
        const yVals = pts
          .filter(p => Array.isArray(p) && p.length >= 2 && !isVarRef(p[1]))
          .map(p => Math.abs(Number(p[1])))
          .filter(v => !isNaN(v))
        if (yVals.length > 0 && yVals.every(v => v <= 0.1)) {
          hasBloom = true
          techniqueTags.add('bloom')
          break
        }
      }
      // Power stage with power ≤ 5 (near-zero pump) and time exit = bloom
      if (stype === 'power' && hasTimeExit && pts.length > 0) {
        const yVals = pts
          .filter(p => Array.isArray(p) && p.length >= 2 && !isVarRef(p[1]))
          .map(p => Math.abs(Number(p[1])))
          .filter(v => !isNaN(v))
        if (yVals.length > 0 && yVals.every(v => v <= 5)) {
          hasBloom = true
          techniqueTags.add('bloom')
          break
        }
      }
    }
  }

  // ── Structural pre-infusion detection (content-based) ──
  // First stage(s) with low pressure/flow or power-type pump fill, before higher-energy stages
  if (!hasPreinfusion && stages.length >= 2) {
    const first = stages[0]
    const ftype = (first.type ?? '').toLowerCase()

    // Power-type first stage = pump fill pre-infusion
    if (ftype === 'power') {
      hasPreinfusion = true
      techniqueTags.add('preinfusion')
    } else {
      const pts = first.dynamics?.points ?? []
      const yVals = pts
        .filter(p => Array.isArray(p) && p.length >= 2 && !isVarRef(p[1]))
        .map(p => Number(p[1]))
        .filter(v => !isNaN(v))
      const maxY = yVals.length > 0 ? Math.max(...yVals) : Infinity
      // Low pressure first stage (≤ 4 bar) or low flow first stage (≤ 2 ml/s)
      if ((ftype === 'pressure' && maxY <= 4) || (ftype === 'flow' && maxY <= 2)) {
        hasPreinfusion = true
        techniqueTags.add('preinfusion')
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
    maxFlow: Math.round(maxFlow * 10) / 10,
    isAdaptive,
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

// ── Weight range grouping ──────────────────────────────────────────────────

/**
 * Map a target weight (grams) to an espresso size label.
 */
export function weightRange(weight: number): string {
  if (weight <= 35) return 'Ristretto (≤35g)'
  if (weight <= 44) return 'Normale (36–44g)'
  if (weight <= 54) return 'Lungo (45–54g)'
  return 'Allongé (55g+)'
}

// ── Pressure range grouping ────────────────────────────────────────────────

/**
 * Map peak pressure (bar) to a human-readable range label.
 */
export function pressureRange(pressure: number): string {
  if (pressure <= 4) return 'Low pressure (≤4 bar)'
  if (pressure <= 7) return 'Medium pressure (5–7 bar)'
  if (pressure <= 9) return 'Standard pressure (8–9 bar)'
  return 'High pressure (10+ bar)'
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
 * Returns sorted PRESET_TAG labels.
 * Pure function — no side effects, no caching.
 *
 * When `profile.stages` is `undefined` (e.g. partial data from a list endpoint),
 * only temperature and weight tags are derived, plus name-based bloom/pre-infusion
 * fallback. When `stages` is present, full fingerprint analysis runs.
 */
export function deriveStructuralTags(profile: AnalyzableProfile): string[] {
  const tags = new Set<string>()

  if (profile.stages !== undefined) {
    // Full fingerprint analysis — stages available
    const fp = extractFingerprint(profile)

    // Technique tags (bloom, pre-infusion, pulse, control mode, etc.)
    for (const tt of fp.techniqueTags) {
      const label = TECHNIQUE_TO_LABEL[tt]
      if (label) tags.add(label)
    }

    // Pressure range (from peak pressure across all stages)
    if (fp.peakPressure > 0) {
      tags.add(pressureRange(fp.peakPressure))
    }

    // Adaptive/parametric profile
    if (fp.isAdaptive) {
      tags.add('Adaptive')
    }
  } else {
    // Partial profile — name-based fallback for bloom/pre-infusion
    const name = (profile.name ?? '').toLowerCase()
    if (name.includes('bloom') || name.includes('soak')) tags.add('Bloom')
    if (name.includes('preinfusion') || name.includes('pre-infusion') || name.includes('pre infusion')) tags.add('Pre-infusion')
  }

  // Temperature — available even in partial profiles
  const temp = profile.temperature
  if (temp != null) {
    tags.add(temperatureRange(temp))
  }

  // Weight range — available even in partial profiles
  const weight = profile.final_weight
  if (weight != null) {
    tags.add(weightRange(weight))
  }

  return [...tags].sort()
}
