"""Deterministic shot-fact derivation (#423 + diagnostic signals).

Pure functions: telemetry + profile + local analysis -> typed facts. No I/O, no LLM.
Mirrors apps/web/src/lib/shotFacts.ts — keep thresholds identical across runtimes.
"""

from __future__ import annotations


def classify_trigger(
    stage_control_mode: str, trigger_type: str, total_triggers: int
) -> dict:
    """Classify a stage's exit trigger as Targeted vs Failsafe (#423).

    Args:
        stage_control_mode: the variable the stage controls ('pressure' | 'flow' | other).
        trigger_type: the exit trigger that fired ('weight' | 'time' | 'pressure' | 'flow').
        total_triggers: number of exit triggers defined on the stage.

    Returns:
        {'kind': 'targeted'|'failsafe'|'unknown', 'label': str, 'reason': str}
    """
    if trigger_type == "weight":
        return {
            "kind": "targeted",
            "label": "Targeted (yield reached)",
            "reason": "Weight is the ultimate goal of the shot.",
        }
    if trigger_type == "time":
        if total_triggers == 1:
            return {
                "kind": "targeted",
                "label": "Targeted (planned duration)",
                "reason": "Time is the only trigger, so this is an intentional timed stage.",
            }
        return {
            "kind": "failsafe",
            "label": "Failsafe (timeout limit)",
            "reason": "Stage hit its time backstop before another target was reached.",
        }
    if stage_control_mode == "flow" and trigger_type == "pressure":
        return {
            "kind": "targeted",
            "label": "Targeted (puck resistance achieved)",
            "reason": "Flow-controlled stage reached its intended pressure.",
        }
    if stage_control_mode == "pressure" and trigger_type == "flow":
        if total_triggers == 1:
            return {
                "kind": "targeted",
                "label": "Targeted (planned flow transition)",
                "reason": "Flow is the only trigger, so the transition is intentional.",
            }
        return {
            "kind": "failsafe",
            "label": "Failsafe (caught channeling or choking)",
            "reason": "Pressure-controlled stage exited on a flow backstop.",
        }
    if stage_control_mode == "pressure" and trigger_type == "pressure":
        return {
            "kind": "targeted",
            "label": "Targeted (pressure threshold reached)",
            "reason": "Pressure-controlled stage reached its target pressure.",
        }
    return {
        "kind": "unknown",
        "label": "Unknown",
        "reason": "Trigger/control-mode combination is not classified.",
    }
