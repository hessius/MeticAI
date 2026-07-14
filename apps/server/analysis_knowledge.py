"""Analysis-specific knowledge base + fact-sheet renderer (K1 + K2).

ANALYSIS_KNOWLEDGE is injected into the shot-analysis prompt (parallel to PROFILING_KNOWLEDGE)
so small models share the same reasoning framework. build_fact_sheet renders the deterministic
ShotFacts into compact prose that replaces the raw local-analysis JSON dump in the prompt.

Mirror of apps/web/src/services/ai/analysisKnowledge.ts — keep the two texts in sync.
"""

from __future__ import annotations

ANALYSIS_KNOWLEDGE = """\
You are reasoning about a single espresso extraction. Apply this framework:

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
- Prefer one or two high-confidence, specific, numeric recommendations over many vague ones.
"""


def _fmt_num(value) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def build_fact_sheet(facts: dict) -> str:
    """Render ShotFacts into compact prose for the LLM prompt (replaces raw JSON dump)."""
    lines: list[str] = [
        "### Deterministic Shot Facts (authoritative — trust over raw telemetry)"
    ]

    weight = facts.get("weight") or {}
    lines.append(
        f"- Final weight: {_fmt_num(weight.get('actual'))} g "
        f"(target {_fmt_num(weight.get('target'))} g, "
        f"deviation {_fmt_num(weight.get('deviation_pct'))}%)."
    )
    lines.append(f"- Total shot time: {_fmt_num(facts.get('total_time_s'))} s.")

    lines.append("- Stage-by-stage:")
    for s in facts.get("stages", []):
        if not s.get("reached"):
            lines.append(f"  - {s.get('stage_name')}: not reached during this shot.")
            continue
        tc = s.get("trigger_class") or {}
        parts = [f"exit = {tc.get('label', 'Unknown')}"]
        stall = s.get("stall") or {}
        if stall.get("stalled"):
            parts.append(f"STALL (only {_fmt_num(stall.get('weight_gain'))} g gained)")
        chan = s.get("channeling") or {}
        if chan.get("channeling"):
            parts.append(
                f"CHANNELING (pressure -{_fmt_num(chan.get('pressure_drop'))} bar, "
                f"flow +{_fmt_num(chan.get('flow_rise'))} ml/s)"
            )
        ca = s.get("curve_adherence")
        if ca and abs(float(ca.get("delta", 0) or 0)) >= 0.5:
            parts.append(f"curve off-target by {_fmt_num(ca.get('delta'))}")
        if s.get("mode_overridden") and s.get("declared_mode"):
            mode_label = (
                f"{s.get('control_mode')} — effective; declared "
                f"{s.get('declared_mode')}, reclassified by its limit"
            )
        else:
            mode_label = s.get("control_mode")
        lines.append(
            f"  - {s.get('stage_name')} [{mode_label}]: " + "; ".join(parts) + "."
        )

    return "\n".join(lines)


FEW_SHOT_ANALYSIS_EXAMPLE = """\
### Worked Example (format + reasoning reference — do not copy its numbers)
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
described as success, not "early termination".
"""
