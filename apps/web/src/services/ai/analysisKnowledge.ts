/**
 * Analysis-specific knowledge base + fact-sheet renderer (K1 + K2).
 * Mirror of apps/server/analysis_knowledge.py — keep the two texts in sync.
 */
import type { ShotFacts } from '../../lib/shotFacts'

export const ANALYSIS_KNOWLEDGE = `You are reasoning about a single espresso extraction. Apply this framework:

EXIT TRIGGER CLASSIFICATION (critical — do not confuse intent with failure):
- A stage ends when one of its exit triggers fires. Classify each as Targeted or Failsafe:
  - Targeted: the stage reached the outcome it was designed for. Examples: a weight trigger
    (yield reached), a time trigger that is the stage's ONLY trigger (planned duration), a
    flow-controlled stage hitting its target pressure (puck resistance achieved), a
    pressure-controlled stage hitting target pressure, or a pressure-controlled stage whose
    ONLY trigger is flow (planned flow transition).
  - Failsafe: a backstop fired before the real target. Examples: a time trigger firing when
    OTHER triggers also exist (timeout), or a pressure-controlled stage exiting on a flow
    backstop when other triggers exist (caught channeling or choking).
- NEVER describe a Targeted exit as a problem. A short stage that hit its weight target is a
  correct, successful outcome — not "early termination".

DIAGNOSTIC SIGNALS:
- Stall: a stage exits on a time failsafe with negligible weight gain (< 0.5 g). Indicates the
  puck choked or flow collapsed. Suggest a coarser grind or revisiting the pressure target.
- Channeling: pressure falls while flow rises within the same stage. Indicates an uneven puck.
  Suggest distribution/puck-prep changes, not profile changes, as the first remedy.
- Curve adherence: when measured average diverges from the stage's target by a meaningful margin,
  the machine could not follow the profile — usually a grind/dose mismatch, not a profile flaw.

EXTRACTION THEORY:
- Sour/acidic => under-extraction => grind finer or raise temperature.
- Bitter/harsh => over-extraction => grind coarser or lower temperature.
- Weak/thin body => lower brew ratio (less water per dose) or larger dose.
- Strong/heavy => raise brew ratio.

DISCIPLINE:
- Only state facts supported by the data provided. Do NOT invent pressures, temperatures, weights,
  or events that are not in the fact sheet. If a value is unknown, say so.
- Prefer one or two high-confidence, specific, numeric recommendations over many vague ones.`

const fmtNum = (v: number | null | undefined): string =>
  v == null ? 'n/a' : (typeof v === 'number' ? `${+v.toFixed(2).replace(/\.?0+$/, '')}` : String(v))

export function buildFactSheet(facts: ShotFacts): string {
  const lines: string[] = ['### Deterministic Shot Facts (authoritative — trust over raw telemetry)']
  const w = facts.weight ?? {}
  lines.push(`- Final weight: ${fmtNum(w.actual)} g (target ${fmtNum(w.target)} g, deviation ${fmtNum(w.deviation_pct)}%).`)
  lines.push(`- Total shot time: ${fmtNum(facts.total_time_s)} s.`)
  lines.push('- Stage-by-stage:')
  for (const s of facts.stages) {
    if (!s.reached) {
      lines.push(`  - ${s.stage_name}: not reached during this shot.`)
      continue
    }
    const parts: string[] = [`exit = ${s.trigger_class?.label ?? 'Unknown'}`]
    if (s.stall?.stalled) parts.push(`STALL (only ${fmtNum(s.stall.weight_gain)} g gained)`)
    if (s.channeling?.channeling) {
      parts.push(`CHANNELING (pressure -${fmtNum(s.channeling.pressure_drop)} bar, flow +${fmtNum(s.channeling.flow_rise)} ml/s)`)
    }
    if (s.curve_adherence && Math.abs(s.curve_adherence.delta) >= 0.5) {
      parts.push(`curve off-target by ${fmtNum(s.curve_adherence.delta)}`)
    }
    lines.push(`  - ${s.stage_name} [${s.control_mode}]: ${parts.join('; ')}.`)
  }
  return lines.join('\n')
}
