"""Regression tests for boundary-aware stage exit-trigger evaluation.

The Meticulous machine flips a telemetry sample's ``status`` to the next stage
on the control tick where the current stage's exit condition becomes true. That
means the sample which actually satisfies a rising ``pressure >= X`` / ``flow
>= X`` trigger is labeled as the FIRST sample of the next stage. Without
boundary awareness, the exiting stage under-reports its exit metric and is
falsely assessed as "failed" even though the target was reached exactly at the
transition.
"""

from services.analysis_service import (
    _analyze_stage_execution,
    _extract_shot_stage_data,
)


def _build_shot(samples):
    data = []
    t = 0
    for status, pressure, flow, weight in samples:
        data.append(
            {
                "status": status,
                "time": t,
                "profile_time": t,
                "shot": {"pressure": pressure, "flow": flow, "weight": weight},
            }
        )
        t += 130
    return {"data": data}


def test_pressure_target_reached_at_transition_is_not_failed():
    """A Fill stage that exits exactly when pressure hits 3 bar (the spike lands
    on the first Bloom sample) must read as reached_goal, not failed."""
    shot = _build_shot(
        [("Fill", p, 7.5, 0.0) for p in (0.2, 0.5, 0.9, 1.3, 1.7, 2.0, 2.2)]
        + [("Bloom", p, 1.0, 0.5) for p in (3.1, 3.4, 2.0, 1.5, 1.2)]
    )
    stages = _extract_shot_stage_data(shot)

    # The in-stage max stays at 2.2; the crossing sample (3.1) is labeled Bloom.
    assert round(stages["Fill"]["max_pressure"], 1) == 2.2
    assert round(stages["Fill"]["boundary_pressure"], 1) == 3.1

    profile_stage = {
        "name": "Fill",
        "type": "flow",
        "exit_triggers": [{"type": "pressure", "value": 3, "comparison": ">="}],
        "limits": [],
        "dynamics": {"points": [[0, 8.1]]},
    }
    result = _analyze_stage_execution(profile_stage, stages["Fill"], 5.0, [])

    assert result["assessment"]["status"] == "reached_goal"
    triggered = result["exit_trigger_result"]["triggered"]
    assert triggered is not None
    assert triggered["type"] == "pressure"
    assert triggered["actual"] >= 3.0


def test_flow_target_reached_at_transition_is_not_failed():
    """A pressure stage exiting on a rising flow trigger is credited for the
    transition-sample flow value."""
    shot = _build_shot(
        [("Ramp", 6.0, f, 0.0) for f in (0.5, 1.0, 1.5, 1.8)]
        + [("Hold", 6.0, f, 1.0) for f in (2.6, 2.4, 2.2)]
    )
    stages = _extract_shot_stage_data(shot)

    profile_stage = {
        "name": "Ramp",
        "type": "pressure",
        "exit_triggers": [{"type": "flow", "value": 2.5, "comparison": ">="}],
        "limits": [],
        "dynamics": {"points": [[0, 6.0]]},
    }
    result = _analyze_stage_execution(profile_stage, stages["Ramp"], 5.0, [])
    assert result["assessment"]["status"] == "reached_goal"


def test_genuinely_unreached_target_still_fails():
    """When neither the stage nor the transition sample reaches the target, the
    stage must still be reported as failed (no false positive from the fix)."""
    shot = _build_shot(
        [("Fill", p, 7.5, 0.0) for p in (0.2, 0.5, 0.9, 1.3, 1.7)]
        + [("Bloom", p, 1.0, 0.5) for p in (1.9, 1.8, 1.5)]
    )
    stages = _extract_shot_stage_data(shot)
    profile_stage = {
        "name": "Fill",
        "type": "flow",
        "exit_triggers": [{"type": "pressure", "value": 3, "comparison": ">="}],
        "limits": [],
        "dynamics": {"points": [[0, 8.1]]},
    }
    result = _analyze_stage_execution(profile_stage, stages["Fill"], 5.0, [])
    assert result["assessment"]["status"] == "failed"


def test_last_stage_has_no_boundary():
    """The final stage has no following stage, so no boundary keys are set."""
    shot = _build_shot([("Fill", 1.0, 7.5, 0.0), ("Bloom", 2.0, 1.0, 0.5)])
    stages = _extract_shot_stage_data(shot)
    assert "boundary_pressure" in stages["Fill"]
    assert "boundary_pressure" not in stages["Bloom"]


def test_in_stage_satisfied_trigger_keeps_in_stage_actual():
    """Rescue is only for triggers the in-stage value falls short of. A weight
    trigger already satisfied in-stage must report the in-stage value, not the
    (larger, monotonically accumulating) boundary weight."""
    shot = _build_shot(
        [("Fill", 1.0, 7.5, w) for w in (0.5, 1.0, 1.5, 2.0)]
        + [("Bloom", 2.0, 1.0, w) for w in (5.0, 6.0, 7.0)]
    )
    stages = _extract_shot_stage_data(shot)
    profile_stage = {
        "name": "Fill",
        "type": "flow",
        "exit_triggers": [{"type": "weight", "value": 2, "comparison": ">="}],
        "limits": [],
        "dynamics": {"points": [[0, 8.1]]},
    }
    result = _analyze_stage_execution(profile_stage, stages["Fill"], 5.0, [])
    triggered = result["exit_trigger_result"]["triggered"]
    assert triggered is not None
    assert triggered["actual"] == 2.0

