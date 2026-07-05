/**
 * Deterministic Espresso-Compass taste -> dial-in adjustment rules (D6).
 * X: -1 sour ... +1 bitter.   Y: -1 weak/thin ... +1 strong/heavy.
 * TS parity of apps/server/services/compass_rules.py — keep DEADBAND identical.
 */

export const COMPASS_DEADBAND = 0.25

export type CompassAdjustmentKind =
  | 'grind_finer' | 'grind_coarser' | 'temp_up' | 'temp_down'
  | 'ratio_up' | 'ratio_down' | 'dose_up'

export interface CompassAdjustment {
  kind: CompassAdjustmentKind
  axis: 'x' | 'y'
  reason: string
}

export function compassAdjustments(tasteX: number, tasteY: number): CompassAdjustment[] {
  const adjustments: CompassAdjustment[] = []

  if (tasteX <= -COMPASS_DEADBAND) {
    adjustments.push({ kind: 'grind_finer', axis: 'x', reason: 'Sour/acidic indicates under-extraction; grind finer to raise yield.' })
    adjustments.push({ kind: 'temp_up', axis: 'x', reason: 'A few degrees hotter increases extraction of sweet/bitter compounds.' })
  } else if (tasteX >= COMPASS_DEADBAND) {
    adjustments.push({ kind: 'grind_coarser', axis: 'x', reason: 'Bitter/harsh indicates over-extraction; grind coarser to lower yield.' })
    adjustments.push({ kind: 'temp_down', axis: 'x', reason: 'A few degrees cooler reduces harsh bitter extraction.' })
  }

  if (tasteY <= -COMPASS_DEADBAND) {
    adjustments.push({ kind: 'ratio_up', axis: 'y', reason: 'Weak/thin body; lower the brew ratio (less water per dose) for more concentration.' })
    adjustments.push({ kind: 'dose_up', axis: 'y', reason: 'A larger dose increases strength and body.' })
  } else if (tasteY >= COMPASS_DEADBAND) {
    adjustments.push({ kind: 'ratio_down', axis: 'y', reason: 'Strong/heavy; raise the brew ratio (more water per dose) to lighten.' })
  }

  return adjustments
}
