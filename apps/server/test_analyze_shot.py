"""Tests for the tools.analyze_shot CLI runner."""

import json
from pathlib import Path

import pytest

from tools import analyze_shot

SAMPLE_SHOT = Path(__file__).parent / "tools" / "samples" / "slayer_at_home.shot.json"


def _slayer_profile() -> dict:
    """A 'Slayer at Home'-style profile: nested dynamics, aggressive flow
    target governed by a pressure limit — should read as effectively pressure."""
    return {
        "name": "Slayer at Home",
        "temperature": 93,
        "final_weight": 36,
        "variables": [
            {
                "key": "flow_MaxFlowRate",
                "name": "flow_MaxFlowRate",
                "type": "flow",
                "value": 10.8,
            },
            {
                "key": "pressure_Max",
                "name": "Max Pressure",
                "type": "pressure",
                "value": 6,
            },
        ],
        "stages": [
            {
                "name": "Extraction",
                "type": "flow",
                "key": "flow_extraction",
                "dynamics": {
                    "points": [[0, "$flow_MaxFlowRate"], [30, "$flow_MaxFlowRate"]],
                    "over": "time",
                    "interpolation": "linear",
                },
                "exit_triggers": [{"type": "weight", "value": 36, "comparison": ">="}],
                "limits": [{"type": "pressure", "value": "$pressure_Max"}],
            }
        ],
    }


def _shot_log(with_profile: bool = False) -> dict:
    shot: dict = {
        "data": [
            {
                "time": 0,
                "status": "Extraction",
                "shot": {"pressure": 0, "flow": 0, "weight": 0},
            },
            {
                "time": 5000,
                "status": "Extraction",
                "shot": {"pressure": 6, "flow": 3.2, "weight": 8},
            },
            {
                "time": 30000,
                "status": "Extraction",
                "shot": {"pressure": 6, "flow": 2.1, "weight": 36},
            },
        ]
    }
    if with_profile:
        shot["profile"] = _slayer_profile()
    return shot


def test_run_analysis_with_separate_profile(tmp_path):
    shot_path = tmp_path / "shot.json"
    profile_path = tmp_path / "profile.json"
    shot_path.write_text(json.dumps(_shot_log()), encoding="utf-8")
    profile_path.write_text(json.dumps(_slayer_profile()), encoding="utf-8")

    analysis = analyze_shot.run_analysis(str(shot_path), str(profile_path))

    stage = analysis["stage_analyses"][0]
    assert stage["profile_max_target"] == 10.8
    fact = next(
        s for s in analysis["shot_facts"]["stages"] if s["stage_name"] == "Extraction"
    )
    assert fact["control_mode"] == "pressure"
    assert fact["mode_overridden"] is True


def test_run_analysis_uses_embedded_profile(tmp_path):
    shot_path = tmp_path / "shot.json"
    shot_path.write_text(json.dumps(_shot_log(with_profile=True)), encoding="utf-8")

    analysis = analyze_shot.run_analysis(str(shot_path))

    assert analysis["profile_info"]["name"] == "Slayer at Home"
    assert analysis["shot_facts"]["stages"][0]["control_mode"] == "pressure"


def test_run_analysis_missing_embedded_profile_raises(tmp_path):
    shot_path = tmp_path / "shot.json"
    shot_path.write_text(json.dumps(_shot_log()), encoding="utf-8")

    with pytest.raises(ValueError, match="no embedded 'profile'"):
        analyze_shot.run_analysis(str(shot_path))


def test_format_report_includes_stage_facts(tmp_path):
    shot_path = tmp_path / "shot.json"
    shot_path.write_text(json.dumps(_shot_log(with_profile=True)), encoding="utf-8")
    analysis = analyze_shot.run_analysis(str(shot_path))

    report = analyze_shot.format_report(analysis)

    assert "Slayer at Home" in report
    assert "Extraction" in report
    assert "control mode: pressure" in report


def test_main_json_output(tmp_path, capsys):
    shot_path = tmp_path / "shot.json"
    shot_path.write_text(json.dumps(_shot_log(with_profile=True)), encoding="utf-8")

    exit_code = analyze_shot.main([str(shot_path), "--json"])

    assert exit_code == 0
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["profile_info"]["name"] == "Slayer at Home"


def test_main_reports_error_for_missing_file(tmp_path, capsys):
    exit_code = analyze_shot.main([str(tmp_path / "nope.json")])

    assert exit_code == 1
    assert "error:" in capsys.readouterr().err


def test_real_slayer_export_resolves_extraction_as_pressure():
    """The bundled real 'Slayer at Home' export uses nested dynamics with an
    aggressive flow target and a pressure limit. Its Extraction stage must
    resolve as effectively pressure-controlled (#423)."""
    analysis = analyze_shot.run_analysis(str(SAMPLE_SHOT))

    assert analysis["profile_info"]["name"] == "Slayer at Home"
    extraction = next(
        s for s in analysis["shot_facts"]["stages"] if s["stage_name"] == "Extraction"
    )
    assert extraction["control_mode"] == "pressure"
    assert extraction["declared_mode"] == "flow"
    assert extraction["mode_overridden"] is True
    # The flow target ($flow_MaxFlowRate = 10.8) must resolve from nested points.
    stage_analysis = next(
        s for s in analysis["stage_analyses"] if s["stage_name"] == "Extraction"
    )
    assert stage_analysis["profile_max_target"] == 10.8
