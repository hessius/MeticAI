"""Deterministic shot-fact derivation (#423 + diagnostic signals).

Pure functions: telemetry + profile + local analysis -> typed facts. No I/O, no LLM.
Mirrors apps/web/src/lib/shotFacts.ts — keep thresholds identical across runtimes.
"""

from __future__ import annotations


def classify_trigger(
    stage_control_mode: str,
    trigger_type: str,
    total_triggers: int,
    *,
    trigger_value: float | None = None,
    global_target_weight: float | None = None,
    on_target: bool | None = None,
) -> dict:
    """Classify a stage's exit trigger as Targeted vs Failsafe (#423).

    Args:
        stage_control_mode: the variable the stage effectively controls
            ('pressure' | 'flow' | 'power' | other) — pass the *effective* mode.
        trigger_type: the exit trigger that fired ('weight' | 'time' | 'pressure' | 'flow').
        total_triggers: number of exit triggers defined on the stage.
        trigger_value: resolved value of the fired trigger (for weight triggers,
            enables the final-yield vs stage-milestone distinction).
        global_target_weight: the shot's final target weight (grams).
        on_target: whether the stage tracked its intended target band. Only
            meaningful for a weight-terminated pressure-governed stage: False
            flags puck failure (yield reached off-curve). None = unknown.

    Returns:
        {'kind': 'targeted'|'failsafe'|'unknown', 'label': str, 'reason': str}
    """
    if trigger_type == "weight":
        near_final = (
            global_target_weight is not None
            and global_target_weight > 0
            and trigger_value is not None
            and trigger_value >= global_target_weight * (1 - YIELD_THRESHOLD)
        )
        if near_final and on_target is False:
            return {
                "kind": "failsafe",
                "label": "Failsafe (puck failure — yield hit off-target)",
                "reason": (
                    "The final weight target was reached, but the stage never "
                    "built its intended pressure, so the yield came from an "
                    "uncontrolled extraction (likely channeling or a failed puck)."
                ),
            }
        if (
            not near_final
            and trigger_value is not None
            and global_target_weight is not None
            and global_target_weight > 0
        ):
            return {
                "kind": "targeted",
                "label": "Targeted (stage yield / first-drip check)",
                "reason": "Stage exited on an intermediate weight milestone below the final target.",
            }
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
            "kind": "targeted",
            "label": "Targeted (timed transition)",
            "reason": (
                "The stage transitioned when its planned time elapsed; the other "
                "exit conditions simply did not fire first. A time exit is a valid, "
                "intended transition — a genuine timeout with no extraction is "
                "surfaced separately as a stall."
            ),
        }
    if stage_control_mode in ("flow", "power") and trigger_type == "pressure":
        return {
            "kind": "targeted",
            "label": "Targeted (puck resistance achieved)",
            "reason": "Flow-controlled stage reached its intended pressure.",
        }
    if stage_control_mode in ("flow", "power") and trigger_type == "flow":
        return {
            "kind": "targeted",
            "label": "Targeted (flow target reached)",
            "reason": "Flow-controlled stage reached its intended flow condition.",
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
# #423 effective-mode thresholds (from the superseding issue comment):
# flow target ≥ MIN + pressure limit ⇒ pressure control
EFFECTIVE_FLOW_TARGET_MIN = 6.0
# pressure stage + flow limit ≤ MAX ⇒ flow control
EFFECTIVE_FLOW_LIMIT_MAX = 3.0
# #423 puck-failure detection thresholds:
# a weight trigger within YIELD_THRESHOLD of the global target = a final-yield stage
YIELD_THRESHOLD = 0.10
# peak pressure must reach (1 - TOLERANCE_THRESHOLD)×target to count as "on-target"
TOLERANCE_THRESHOLD = 0.20


def _stage_control_mode(stage: dict) -> str:
    """Best-effort: which variable the stage nominally controls (declared type)."""
    t = (stage.get("stage_type") or stage.get("type") or "").lower()
    if "flow" in t:
        return "flow"
    if "pressure" in t:
        return "pressure"
    if "power" in t:
        return "power"
    return "unknown"


def _limit_value(stage: dict, limit_type: str) -> float | None:
    """Resolved numeric value of a stage limit by type, or None if absent."""
    for lim in stage.get("limits") or []:
        if lim.get("type") == limit_type:
            try:
                return float(lim.get("value"))
            except (TypeError, ValueError):
                return None
    return None


def effective_control_mode(stage: dict) -> str:
    """Determine a stage's *effective* control mode, correcting for #423 cases
    where the declared type does not reflect the true intent.

    Overrides (from the superseding #423 comment):
      1. Aggressive flow (peak target ≥ 6 ml/s) with a pressure limit ⇒ the
         pressure limit governs, so the stage is effectively pressure-controlled.
      2. A pressure stage with a highly restricted flow limit (≤ 3 ml/s) can't
         build pressure, so it is effectively flow-controlled.
      3. Power stages are raw mechanical drive.

    Falls back to the declared control mode when no override applies.
    """
    declared = _stage_control_mode(stage)
    if declared == "power":
        return "power"
    max_target = stage.get("profile_max_target")
    pressure_limit = _limit_value(stage, "pressure")
    flow_limit = _limit_value(stage, "flow")
    if (
        declared == "flow"
        and isinstance(max_target, (int, float))
        and max_target >= EFFECTIVE_FLOW_TARGET_MIN
        and pressure_limit is not None
    ):
        return "pressure"
    if (
        declared == "pressure"
        and flow_limit is not None
        and flow_limit <= EFFECTIVE_FLOW_LIMIT_MAX
    ):
        return "flow"
    return declared


def _yield_stage_on_target(stage: dict, effective_mode: str) -> bool | None:
    """Whether a pressure-governed stage actually built its intended pressure (#423).

    Puck failure is only reliably detectable on pressure-governed extraction: if
    the puck channels or collapses, pressure never reaches the intended band even
    though weight still accrues. For flow-governed / power / target-less stages we
    return None (can't prove failure — a volumetric shot hitting weight is normal).
    """
    if effective_mode != "pressure":
        return None
    target = _limit_value(stage, "pressure")
    if target is None and _stage_control_mode(stage) == "pressure":
        target = stage.get("profile_target_value")
    if not target:
        return None
    ed = stage.get("execution_data") or {}
    max_pressure = ed.get("max_pressure")
    if max_pressure is None:
        return None
    return float(max_pressure) >= (1 - TOLERANCE_THRESHOLD) * float(target)


def detect_stall(stage: dict) -> dict:
    """A stage stalled if it timed out with another unmet target and negligible gain.

    A stall is a time-terminated stage that *had* another exit target it failed to
    reach (total_triggers > 1) yet extracted almost nothing — i.e. the time trigger
    acted as a backstop for a target that was never met. Purely timed stages
    (total_triggers == 1, e.g. pre-infusion) are intentional and never stalled.
    """
    result = stage.get("exit_trigger_result") or {}
    triggered = result.get("triggered") or {}
    trig_type = triggered.get("type", "")
    total = len(stage.get("exit_triggers") or [])
    ed = stage.get("execution_data") or {}
    gain = float(ed.get("weight_gain", 0) or 0)
    stalled = trig_type == "time" and total > 1 and gain < STALL_MIN_WEIGHT_GAIN_G
    return {"stalled": stalled, "weight_gain": round(gain, 2)}


def detect_channeling(execution_data: dict) -> dict:
    """Flag likely channeling: pressure falls while flow rises within the stage."""
    ed = execution_data or {}
    p_drop = float(ed.get("start_pressure", 0) or 0) - float(
        ed.get("end_pressure", 0) or 0
    )
    f_rise = float(ed.get("end_flow", 0) or 0) - float(ed.get("start_flow", 0) or 0)
    channeling = (
        p_drop >= CHANNELING_PRESSURE_DROP_BAR and f_rise >= CHANNELING_FLOW_RISE_MLS
    )
    return {
        "channeling": channeling,
        "pressure_drop": round(p_drop, 2),
        "flow_rise": round(f_rise, 2),
    }


def _build_phases(local_analysis: dict) -> list[dict]:
    """Group stages into pre-infusion / ramp / peak / decline by avg pressure shape."""
    stages = [
        s for s in local_analysis.get("stage_analyses", []) if s.get("execution_data")
    ]
    phases: list[dict] = []
    for s in stages:
        ed = s["execution_data"]
        avg_p = float(ed.get("avg_pressure", 0) or 0)
        if avg_p < 3.0:
            phase = "pre-infusion"
        elif float(ed.get("end_pressure", 0) or 0) > float(
            ed.get("start_pressure", 0) or 0
        ):
            phase = "ramp"
        elif float(ed.get("end_pressure", 0) or 0) < float(
            ed.get("start_pressure", 0) or 0
        ):
            phase = "decline"
        else:
            phase = "peak"
        phases.append(
            {
                "stage_name": s.get("stage_name"),
                "phase": phase,
                "avg_pressure": ed.get("avg_pressure"),
                "avg_flow": ed.get("avg_flow"),
                "weight_gain": ed.get("weight_gain"),
            }
        )
    return phases


def _curve_adherence(stage: dict) -> dict | None:
    """Compare measured avg vs the stage's mean target setpoint, if numeric.

    The numeric target is precomputed at stage-build time as
    ``profile_target_value`` (mean of the resolved dynamics setpoints); see
    analysis_service._mean_dynamics_target and its native mirror
    DirectModeInterceptor.meanDynamicsTarget.
    """
    target = stage.get("profile_target_value")
    ed = stage.get("execution_data") or {}
    if target is None:
        return None
    mode = _stage_control_mode(stage)
    measured = ed.get("avg_pressure") if mode == "pressure" else ed.get("avg_flow")
    if measured is None:
        return None
    return {
        "target": round(float(target), 2),
        "measured": measured,
        "delta": round(float(measured) - float(target), 2),
    }


def build_shot_facts(local_analysis: dict) -> dict:
    """Assemble the deterministic ShotFacts object consumed by the static view, the
    LLM fact sheet, and the validator. Mirrors buildShotFacts() in shotFacts.ts."""
    stages_out: list[dict] = []
    wa = local_analysis.get("weight_analysis", {})
    global_target_weight = wa.get("target")
    for s in local_analysis.get("stage_analyses", []):
        ed = s.get("execution_data")
        if not ed:
            stages_out.append({"stage_name": s.get("stage_name"), "reached": False})
            continue
        triggered = (s.get("exit_trigger_result") or {}).get("triggered") or {}
        trig_type = triggered.get("type", "")
        trig_value = triggered.get("target")
        total = len(s.get("exit_triggers") or [])
        declared_mode = _stage_control_mode(s)
        effective_mode = effective_control_mode(s)
        on_target = _yield_stage_on_target(s, effective_mode)
        stages_out.append(
            {
                "stage_name": s.get("stage_name"),
                "reached": True,
                "control_mode": effective_mode,
                "declared_mode": declared_mode,
                "mode_overridden": effective_mode != declared_mode,
                "trigger_type": trig_type,
                "trigger_class": classify_trigger(
                    effective_mode,
                    trig_type,
                    total,
                    trigger_value=trig_value,
                    global_target_weight=global_target_weight,
                    on_target=on_target,
                ),
                "stall": detect_stall(s),
                "channeling": detect_channeling(ed),
                "curve_adherence": _curve_adherence(s),
            }
        )
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
