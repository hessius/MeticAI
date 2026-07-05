/**
 * Analysis-specific knowledge base + fact-sheet renderer (K1 + K2).
 * Mirror of apps/server/analysis_knowledge.py — keep the two texts in sync.
 */
import type { ShotFacts } from '../logic/shotFacts'

export const ANALYSIS_KNOWLEDGE = `You are reasoning about a single espresso extraction. Apply this framework:

EXIT TRIGGER CLASSIFICATION (critical — do not confuse intent with failure):
- A stage ends when one of its exit triggers fires. Classify each as Targeted or Failsafe:
  - Targeted: the stage reached the outcome it was designed for. Examples: a weight trigger
    (yield reached), any time trigger (a timed transition is a valid, intended exit — the
    stage ran for its planned duration), a flow-controlled stage hitting its target pressure
    (puck resistance achieved) or its target flow, a pressure-controlled stage hitting target
    pressure, or a pressure-controlled stage whose ONLY trigger is flow (planned flow transition).
    A stage with NO exit triggers is also Targeted: an intermediate one transitions on its planned
    dynamics duration, and the final one ends when the shot reaches its global target weight (yield reached).
  - Failsafe: a backstop fired instead of the real target. Examples: a weight target reached
    off-curve without building intended pressure (puck failure), or a pressure-controlled stage
    exiting on a flow backstop when other triggers exist (caught channeling or choking).
- A time exit is NOT a failure by itself. A genuine timeout — a timed stage that extracted
  almost nothing while another target went unmet — is surfaced separately as a STALL signal.
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
    const modeLabel = s.mode_overridden && s.declared_mode
      ? `${s.control_mode} — effective; declared ${s.declared_mode}, reclassified by its limit`
      : s.control_mode
    lines.push(`  - ${s.stage_name} [${modeLabel}]: ${parts.join('; ')}.`)
  }
  return lines.join('\n')
}

export const FEW_SHOT_ANALYSIS_EXAMPLE = `### Worked Example (format + reasoning reference — do not copy its numbers)
Facts: Pre-infusion [flow] exit = Targeted (planned duration); Ramp [pressure] exit = Targeted
(pressure threshold reached); Hold [pressure] exit = Targeted (yield reached); final weight 36 g
(target 36 g, deviation 0%); total time 28 s.

Good analysis excerpt:
## 1. Shot Performance
**What Happened:**
- Pre-infusion ran its planned duration, then pressure ramped cleanly to target.
- The hold stage ended exactly on the weight target — a correct, intentional finish.
**Assessment:** Good

Note how every claim maps to a fact, no values are invented, and the Targeted weight exit is
described as success, not "early termination".`
