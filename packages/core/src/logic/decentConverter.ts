/**
 * Decent Espresso profile converter.
 *
 * TypeScript port of the server-side Python converter
 * (`apps/server/services/decent_converter.py`).  Used by the
 * DirectModeInterceptor so Decent profile conversion works in
 * native/direct mode without a backend.
 */

import { safeRandomUUID } from './uuid'

// ── Types ───────────────────────────────────────────────────────────────────

interface DecentExit {
  type?: string
  condition?: number
  or?: DecentExit
}

interface DecentStep {
  name?: string
  temperature?: number
  sensor?: string
  pump?: string
  transition?: string
  flow?: number
  pressure?: number
  seconds?: number
  volume?: number
  weight?: number
  exit?: DecentExit
}

interface DecentProfile {
  title?: string
  author?: string
  notes?: string
  beverage_type?: string
  steps?: DecentStep[]
}

interface ExitTrigger {
  type: string
  value: number
  relative: boolean
  comparison: string
  direction?: string
}

interface Dynamics {
  type: string
  over: string
  interpolation: string
  points: [number, number][]
}

interface MeticulousStage {
  name: string
  type: string
  key: string
  temperature: number
  limits: unknown[]
  dynamics: Dynamics
  exit_triggers: ExitTrigger[]
}

interface MeticulousProfile {
  id: string
  name: string
  author: string
  temperature: number
  final_weight: number
  stages: MeticulousStage[]
  variables: unknown[]
  previous_authors: unknown[]
  display?: { description?: string; shortDescription?: string }
}

export interface ConversionResult {
  profile: MeticulousProfile
  warnings: string[]
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Detect whether a JSON object is a Decent Espresso profile. */
export function detectDecentFormat(data: unknown): data is DecentProfile {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const obj = data as Record<string, unknown>
  const steps = obj.steps
  if (!Array.isArray(steps) || steps.length === 0) return false
  return steps.some(
    (s) => typeof s === 'object' && s !== null && ('pump' in s || 'sensor' in s),
  )
}

/** Convert a Decent Espresso profile to Meticulous format. */
export function convertDecentToMeticulous(data: DecentProfile): ConversionResult {
  const warnings: string[] = []
  const stages: MeticulousStage[] = []

  for (const [i, step] of (data.steps ?? []).entries()) {
    if (!step || typeof step !== 'object') {
      warnings.push(`Step ${i}: not an object, skipped`)
      continue
    }
    const stage = convertStep(step, i, warnings)
    if (stage) stages.push(stage)
  }

  if (stages.length === 0) {
    warnings.push('No stages could be converted')
  }

  const profile: MeticulousProfile = {
    id: safeRandomUUID(),
    name: data.title ?? 'Imported Decent Profile',
    author: data.author ?? 'Decent Import',
    temperature: firstTemperature(data),
    final_weight: firstWeightTarget(data),
    stages,
    variables: [],
    previous_authors: [],
  }

  const notes = data.notes ?? ''
  if (notes) {
    profile.display = {
      description: notes,
      shortDescription: notes.length > 99 ? notes.slice(0, 99) : notes,
    }
  }

  return { profile, warnings }
}

// ── Internal helpers ────────────────────────────────────────────────────────

function safeFloat(value: unknown, fallback: number): number {
  if (value == null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function firstTemperature(data: DecentProfile): number {
  for (const step of data.steps ?? []) {
    if (step?.temperature != null) {
      const t = Number(step.temperature)
      if (Number.isFinite(t)) return t
    }
  }
  return 93.0
}

function firstWeightTarget(data: DecentProfile): number {
  for (const step of data.steps ?? []) {
    const w = findWeightInExit(step?.exit)
    if (w != null) return w
  }
  return 36.0
}

function findWeightInExit(exit?: DecentExit | null): number | null {
  if (!exit) return null
  if (exit.type === 'weight_over' && exit.condition != null) {
    const v = Number(exit.condition)
    if (Number.isFinite(v)) return v
  }
  return findWeightInExit(exit.or)
}

function convertStep(
  step: DecentStep,
  index: number,
  warnings: string[],
): MeticulousStage | null {
  const pump = step.pump ?? 'pressure'

  let stageType: string
  if (pump === 'flow') {
    stageType = 'flow'
  } else if (pump === 'pressure') {
    stageType = 'pressure'
  } else {
    warnings.push(`Step ${index}: unknown pump type '${pump}', defaulting to pressure`)
    stageType = 'pressure'
  }

  const targetValue =
    stageType === 'flow' ? safeFloat(step.flow, 4.0) : safeFloat(step.pressure, 9.0)

  const transition = step.transition ?? 'fast'
  const seconds = safeFloat(step.seconds, 0)

  let points: [number, number][]
  if (transition === 'smooth' && seconds > 0) {
    points = [
      [0.0, 0.0],
      [seconds, targetValue],
    ]
  } else {
    points = [[0.0, targetValue]]
  }

  const exitTriggers = convertExit(step.exit, index, warnings)

  // If no exit triggers but a seconds value exists, add a time trigger
  if (exitTriggers.length === 0 && seconds > 0) {
    exitTriggers.push({
      type: 'time',
      value: seconds,
      relative: true,
      comparison: '>=',
    })
  }

  return {
    name: step.name ?? `Stage ${index + 1}`,
    type: stageType,
    key: `${stageType}_${index}`,
    temperature: safeFloat(step.temperature, 93.0),
    limits: [],
    dynamics: {
      type: stageType,
      over: 'time',
      interpolation: 'linear',
      points,
    },
    exit_triggers: exitTriggers,
  }
}

const EXIT_TYPE_MAP: Record<string, [string, string | null]> = {
  pressure_over: ['pressure', 'above'],
  pressure_under: ['pressure', 'below'],
  flow_over: ['flow', 'above'],
  flow_under: ['flow', 'below'],
  time_over: ['time', null],
  weight_over: ['weight', null],
  volume_over: ['volume', null],
}

function convertExit(
  exitData: DecentExit | undefined | null,
  stepIndex: number,
  warnings: string[],
): ExitTrigger[] {
  const triggers: ExitTrigger[] = []
  if (!exitData) return triggers

  const exitType = exitData.type ?? ''
  const condition = safeFloat(exitData.condition, 0)

  if (exitType in EXIT_TYPE_MAP) {
    const [mappedType, direction] = EXIT_TYPE_MAP[exitType]
    const trigger: ExitTrigger = {
      type: mappedType,
      value: condition,
      relative: mappedType === 'time',
      comparison: '>=',
    }
    if (direction) trigger.direction = direction
    triggers.push(trigger)
  } else if (exitType) {
    warnings.push(`Step ${stepIndex}: unknown exit type '${exitType}'`)
  }

  if (exitData.or) {
    triggers.push(...convertExit(exitData.or, stepIndex, warnings))
  }

  return triggers
}
