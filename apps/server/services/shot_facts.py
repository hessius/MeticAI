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


# Threshold constants — keep identical to apps/web/src/lib/shotFacts.ts
STALL_MIN_WEIGHT_GAIN_G = 0.5  # below this on a time-failsafe = stalled
CHANNELING_PRESSURE_DROP_BAR = 1.5  # pressure fall within a stage
CHANNELING_FLOW_RISE_MLS = 1.5  # simultaneous flow rise


def _stage_control_mode(stage: dict) -> str:
    """Best-effort: which variable the stage controls."""
    t = (stage.get("stage_type") or stage.get("type") or "").lower()
    if "flow" in t:
        return "flow"
    if "pressure" in t:
        return "pressure"
    return "unknown"


def detect_stall(stage: dict) -> dict:
    """A stage stalled if it exited on a time failsafe with negligible weight gain."""
    result = stage.get("exit_trigger_result") or {}
    triggered = result.get("triggered") or {}
    trig_type = triggered.get("type", "")
    total = len(stage.get("exit_triggers") or [])
    ed = stage.get("execution_data") or {}
    gain = float(ed.get("weight_gain", 0) or 0)
    klass = classify_trigger(_stage_control_mode(stage), trig_type, total)
    stalled = klass["kind"] == "failsafe" and trig_type == "time" and gain < STALL_MIN_WEIGHT_GAIN_G
    return {"stalled": stalled, "weight_gain": round(gain, 2)}


def detect_channeling(execution_data: dict) -> dict:
    """Flag likely channeling: pressure falls while flow rises within the stage."""
    ed = execution_data or {}
    p_drop = float(ed.get("start_pressure", 0) or 0) - float(ed.get("end_pressure", 0) or 0)
    f_rise = float(ed.get("end_flow", 0) or 0) - float(ed.get("start_flow", 0) or 0)
    channeling = p_drop >= CHANNELING_PRESSURE_DROP_BAR and f_rise >= CHANNELING_FLOW_RISE_MLS
    return {"channeling": channeling, "pressure_drop": round(p_drop, 2), "flow_rise": round(f_rise, 2)}


def _build_phases(local_analysis: dict) -> list[dict]:
    """Group stages into pre-infusion / ramp / peak / decline by avg pressure shape."""
    stages = [s for s in local_analysis.get("stage_analyses", []) if s.get("execution_data")]
    phases: list[dict] = []
    for s in stages:
        ed = s["execution_data"]
        avg_p = float(ed.get("avg_pressure", 0) or 0)
        if avg_p < 3.0:
            phase = "pre-infusion"
        elif float(ed.get("end_pressure", 0) or 0) > float(ed.get("start_pressure", 0) or 0):
            phase = "ramp"
        elif float(ed.get("end_pressure", 0) or 0) < float(ed.get("start_pressure", 0) or 0):
            phase = "decline"
        else:
            phase = "peak"
        phases.append({
            "stage_name": s.get("stage_name"),
            "phase": phase,
            "avg_pressure": ed.get("avg_pressure"),
            "avg_flow": ed.get("avg_flow"),
            "weight_gain": ed.get("weight_gain"),
        })
    return phases


def _curve_adherence(stage: dict) -> dict | None:
    """Compare measured avg vs the stage's first target dynamics point, if numeric."""
    points = ((stage.get("profile_target") or {}) if isinstance(stage.get("profile_target"), dict) else {})
    target = points.get("target_value")
    ed = stage.get("execution_data") or {}
    if target is None:
        return None
    mode = _stage_control_mode(stage)
    measured = ed.get("avg_pressure") if mode == "pressure" else ed.get("avg_flow")
    if measured is None:
        return None
    return {"target": target, "measured": measured, "delta": round(float(measured) - float(target), 2)}


def build_shot_facts(local_analysis: dict) -> dict:
    """Assemble the deterministic ShotFacts object consumed by the static view, the
    LLM fact sheet, and the validator. Mirrors buildShotFacts() in shotFacts.ts."""
    stages_out: list[dict] = []
    for s in local_analysis.get("stage_analyses", []):
        ed = s.get("execution_data")
        if not ed:
            stages_out.append({"stage_name": s.get("stage_name"), "reached": False})
            continue
        triggered = (s.get("exit_trigger_result") or {}).get("triggered") or {}
        trig_type = triggered.get("type", "")
        total = len(s.get("exit_triggers") or [])
        stages_out.append({
            "stage_name": s.get("stage_name"),
            "reached": True,
            "control_mode": _stage_control_mode(s),
            "trigger_type": trig_type,
            "trigger_class": classify_trigger(_stage_control_mode(s), trig_type, total),
            "stall": detect_stall(s),
            "channeling": detect_channeling(ed),
            "curve_adherence": _curve_adherence(s),
        })
    wa = local_analysis.get("weight_analysis", {})
    return {
        "stages": stages_out,
        "phases": _build_phases(local_analysis),
        "weight": {
            "actual": wa.get("actual"),
            "target": wa.get("target"),
            "deviation_pct": wa.get("deviation_percent"),
        },
        "total_time_s": (
            local_analysis.get("overall_metrics", {}).get("total_time")
            or local_analysis.get("shot_summary", {}).get("total_time")
        ),
    }
