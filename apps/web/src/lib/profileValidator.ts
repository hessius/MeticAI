/**
 * Profile Validator — TypeScript port of apps/server/services/validation_service.py
 *
 * Enforces OEPF structural validation rules programmatically in the browser.
 * Used by directModeAI.ts and BrowserAIService.ts to validate AI-generated
 * profiles before uploading to the machine.
 */

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

interface Stage {
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
  exit_type?: string
  [key: string]: unknown
}

interface Variable {
  name?: string
  key?: string
  type?: string
  value?: unknown
  adjustable?: boolean
}

interface Profile {
  name?: string
  author?: string
  temperature?: number
  stages?: Stage[]
  variables?: Variable[]
  [key: string]: unknown
}

/** Recursively collect all $key variable references from an object. */
function collectRefs(obj: unknown, refs: Set<string>): void {
  if (typeof obj === 'string') {
    if (obj.startsWith('$')) refs.add(obj.slice(1))
  } else if (Array.isArray(obj)) {
    for (const item of obj) collectRefs(item, refs)
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) collectRefs(val, refs)
  }
}

/** Check if a string starts with an emoji (common emoji ranges). */
function startsWithEmoji(str: string): boolean {
  if (!str) return false
  // Match common emoji code point ranges
  const cp = str.codePointAt(0) ?? 0
  return (
    (cp >= 0x1F300 && cp <= 0x1FAFF) || // Misc Symbols, Emoticons, etc.
    (cp >= 0x2600 && cp <= 0x27BF) ||    // Misc Symbols
    (cp >= 0x2700 && cp <= 0x27BF) ||    // Dingbats
    (cp >= 0xFE00 && cp <= 0xFE0F) ||    // Variation selectors
    (cp >= 0x200D && cp <= 0x200D) ||    // ZWJ
    cp === 0x2615 || cp === 0x2699 ||    // ☕ ⚙
    cp === 0x26A0 || cp === 0x1F527 ||   // ⚠ 🔧
    cp === 0x1F4A7 || cp === 0x1F3AF    // 💧 🎯
  )
}

const VALID_STAGE_TYPES = new Set(['power', 'flow', 'pressure'])
const VALID_EXIT_TRIGGER_TYPES = new Set([
  'weight', 'pressure', 'flow', 'time', 'piston_position', 'power', 'user_interaction',
])
const VALID_COMPARISONS = new Set(['>=', '<='])
const VALID_DYNAMICS_OVER = new Set(['time', 'weight', 'piston_position'])
const VALID_INTERPOLATIONS = new Set(['linear', 'curve'])

/**
 * Validate an OEPF profile JSON object.
 *
 * Checks the same rules as the Python server's validation_service.py:
 * 1. Exit trigger paradox (flow stage can't have flow trigger, etc.)
 * 2. Backup triggers (every stage needs time backup or multiple triggers)
 * 3. Cross-type limits (flow→pressure limit, pressure→flow limit)
 * 4. Valid interpolation values
 * 5. Valid dynamics.over values
 * 6. Valid stage types
 * 7. Valid exit trigger types + comparison operators
 * 8. Pressure limits (max 15 bar, no negatives)
 * 9. Absolute weight must be strictly increasing
 * 10. Variable naming rules (emoji for info, no emoji for adjustable)
 */
export function validateProfile(profile: unknown): ValidationResult {
  const errors: string[] = []

  if (!profile || typeof profile !== 'object') {
    return { isValid: false, errors: ['Profile must be a JSON object'] }
  }

  const p = profile as Profile

  // Required top-level fields
  if (!p.name) errors.push("Missing required field: 'name'")
  if (!Array.isArray(p.stages)) errors.push("Missing or invalid 'stages' array")
  if (!p.stages?.length) errors.push('Profile must have at least one stage')

  // Track absolute weight triggers for monotonicity check
  let lastAbsoluteWeight = -Infinity

  for (let i = 0; i < (p.stages ?? []).length; i++) {
    const stage = p.stages![i]
    if (!stage || typeof stage !== 'object') {
      errors.push(`Stage ${i + 1}: must be a JSON object`)
      continue
    }

    const sname = stage.name || `Stage ${i + 1}`
    const stype = stage.type

    // Rule 6: Stage type validation
    if (!VALID_STAGE_TYPES.has(stype ?? '')) {
      errors.push(
        `Stage '${sname}': type must be 'power', 'flow', or 'pressure', got '${stype}'`,
      )
    }

    // Exit triggers required
    const triggers = stage.exit_triggers ?? []
    if (!triggers.length) {
      errors.push(`Stage '${sname}': missing exit_triggers`)
    } else {
      const triggerTypes = new Set(
        triggers.filter(t => t && typeof t === 'object').map(t => t.type),
      )

      // Rule 1: Paradox check
      if (stype && triggerTypes.has(stype) && (stype === 'flow' || stype === 'pressure')) {
        errors.push(
          `Stage '${sname}': ${stype} stage cannot have a ${stype} exit trigger (paradox)`,
        )
      }

      // Rule 2: Backup trigger check
      if (triggers.length === 1 && !triggerTypes.has('time')) {
        errors.push(
          `Stage '${sname}': single non-time exit trigger needs a time backup`,
        )
      }

      // Rule 7: Validate each trigger's type and comparison
      for (const trigger of triggers) {
        if (!trigger || typeof trigger !== 'object') continue
        if (trigger.type && !VALID_EXIT_TRIGGER_TYPES.has(trigger.type)) {
          errors.push(
            `Stage '${sname}': invalid exit trigger type '${trigger.type}'`,
          )
        }
        if (trigger.comparison && !VALID_COMPARISONS.has(trigger.comparison)) {
          errors.push(
            `Stage '${sname}': exit trigger comparison must be '>=' or '<=', got '${trigger.comparison}'`,
          )
        }

        // Rule 8: Pressure limits in triggers
        if (trigger.type === 'pressure') {
          const val = Number(trigger.value)
          if (!isNaN(val)) {
            if (val > 15) errors.push(`Stage '${sname}': pressure trigger exceeds 15 bar (${val})`)
            if (val < 0) errors.push(`Stage '${sname}': negative pressure trigger value (${val})`)
          }
        }

        // Rule 9: Absolute weight monotonicity
        if (trigger.type === 'weight' && trigger.relative !== true) {
          const val = Number(trigger.value)
          if (!isNaN(val)) {
            if (val <= lastAbsoluteWeight) {
              errors.push(
                `Stage '${sname}': absolute weight trigger (${val}g) must be > previous stage's (${lastAbsoluteWeight}g)`,
              )
            }
            lastAbsoluteWeight = val
          }
        }
      }
    }

    // Rule 3: Cross-type limits check
    const limits = stage.limits ?? []
    if (stype === 'flow') {
      const hasPressureLimit = limits.some(
        lim => lim && typeof lim === 'object' && lim.type === 'pressure',
      )
      if (!hasPressureLimit) {
        errors.push(`Stage '${sname}': flow stage must have a pressure limit`)
      }
      // Check for same-type limit (invalid)
      const hasSameTypeLimit = limits.some(
        lim => lim && typeof lim === 'object' && lim.type === 'flow',
      )
      if (hasSameTypeLimit) {
        errors.push(`Stage '${sname}': flow stage cannot have a flow limit (same-type)`)
      }
    } else if (stype === 'pressure') {
      const hasFlowLimit = limits.some(
        lim => lim && typeof lim === 'object' && lim.type === 'flow',
      )
      if (!hasFlowLimit) {
        errors.push(`Stage '${sname}': pressure stage must have a flow limit`)
      }
      const hasSameTypeLimit = limits.some(
        lim => lim && typeof lim === 'object' && lim.type === 'pressure',
      )
      if (hasSameTypeLimit) {
        errors.push(`Stage '${sname}': pressure stage cannot have a pressure limit (same-type)`)
      }
    }

    // Rule 8: Pressure limits in stage limits
    for (const lim of limits) {
      if (!lim || typeof lim !== 'object') continue
      if (lim.type === 'pressure') {
        const val = Number(lim.value)
        if (!isNaN(val)) {
          if (val > 15) errors.push(`Stage '${sname}': pressure limit exceeds 15 bar (${val})`)
          if (val < 0) errors.push(`Stage '${sname}': negative pressure limit value (${val})`)
        }
      }
    }

    // Dynamics validation
    const dynamics = stage.dynamics
    if (dynamics && typeof dynamics === 'object') {
      // Rule 5: dynamics.over
      if (dynamics.over && !VALID_DYNAMICS_OVER.has(dynamics.over)) {
        errors.push(
          `Stage '${sname}': dynamics.over must be 'time', 'weight', or 'piston_position', got '${dynamics.over}'`,
        )
      }

      // Rule 4: interpolation
      if (dynamics.interpolation && !VALID_INTERPOLATIONS.has(dynamics.interpolation)) {
        errors.push(
          `Stage '${sname}': interpolation must be 'linear' or 'curve', got '${dynamics.interpolation}'`,
        )
      }

      // Curve needs 2+ points
      if (dynamics.interpolation === 'curve' && Array.isArray(dynamics.points) && dynamics.points.length < 2) {
        errors.push(
          `Stage '${sname}': 'curve' interpolation requires at least 2 dynamics points`,
        )
      }

      // Rule 8: Pressure limits in dynamics points
      if (stype === 'pressure' && Array.isArray(dynamics.points)) {
        for (const point of dynamics.points) {
          if (!Array.isArray(point) || point.length < 2) continue
          const val = typeof point[1] === 'string' && (point[1] as string).startsWith('$')
            ? NaN // Skip variable references
            : Number(point[1])
          if (!isNaN(val)) {
            if (val > 15) errors.push(`Stage '${sname}': dynamics pressure exceeds 15 bar (${val})`)
            if (val < 0) errors.push(`Stage '${sname}': negative dynamics pressure value (${val})`)
          }
        }
      }
    }
  }

  // Rule 10: Variable naming rules + unused adjustable check
  const variables = p.variables ?? []
  if (Array.isArray(variables)) {
    // Collect all $key references in stages
    const usedKeys = new Set<string>()
    for (const stage of p.stages ?? []) {
      if (stage && typeof stage === 'object') collectRefs(stage, usedKeys)
    }

    for (const v of variables) {
      if (!v || typeof v !== 'object') continue
      const key = v.key ?? ''
      const name = v.name ?? ''
      const isInfo = key.startsWith('info_') || v.adjustable === false

      if (isInfo) {
        // Info variables must start with emoji
        if (name && !startsWithEmoji(name)) {
          errors.push(
            `Variable '${key}': info variable name must start with an emoji, got '${name}'`,
          )
        }
      } else {
        // Adjustable variables must NOT start with emoji
        if (name && startsWithEmoji(name)) {
          errors.push(
            `Variable '${key}': adjustable variable name must NOT start with an emoji, got '${name}'`,
          )
        }

        // Adjustable variables must be used in at least one stage
        if (key && !usedKeys.has(key)) {
          errors.push(
            `Adjustable variable '${key}' ('${name}') is defined but never used in any stage. ` +
            `Use $${key} in a dynamics point or remove it.`,
          )
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
