"""Command-line runner for Metic's deterministic (no-LLM) shot analysis.

This wraps the exact same algorithm the app uses in production
(``analysis_service._perform_local_shot_analysis`` →
``shot_facts.build_shot_facts``) so you can run it against real shot logs
and profiles from the terminal — perfect for tinkering with the
stage-classification / effective-control-mode / puck-failure logic without
touching the UI.

Usage (from ``apps/server``):

    python -m tools.analyze_shot <shot.json> [profile.json]
    python -m tools.analyze_shot <shot.json> [profile.json] --json

- ``shot.json``    A machine shot log (the object with a ``data`` array; it may
                   also embed its own ``profile``).
- ``profile.json`` Optional. The profile used for the shot. When omitted, the
                   profile embedded in the shot file is used.

Where the algorithm lives (edit these to tinker):
- ``services/analysis_service.py`` — stage execution + curve extraction.
- ``services/shot_facts.py``       — control-mode / trigger / stall / puck logic.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from services.analysis_service import _perform_local_shot_analysis


def load_json(path: str) -> dict[str, Any]:
    """Load and parse a JSON file, raising a clear error on failure."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object, got {type(data).__name__}")
    return data


def run_analysis(shot_path: str, profile_path: str | None = None) -> dict[str, Any]:
    """Load the shot (and profile) and run the local analysis pipeline.

    When ``profile_path`` is omitted, the profile embedded in the shot file
    (``shot["profile"]``) is used. Returns the full analysis dict, including
    the deterministic ``shot_facts`` object.
    """
    shot_data = load_json(shot_path)
    if profile_path:
        profile_data = load_json(profile_path)
    else:
        profile_data = shot_data.get("profile") or {}
        if not profile_data:
            raise ValueError(
                f"{shot_path} has no embedded 'profile'; pass a profile file as "
                "the second argument."
            )
    return _perform_local_shot_analysis(shot_data, profile_data)


def _fmt(value: Any) -> str:
    return "—" if value is None else str(value)


def format_report(analysis: dict[str, Any]) -> str:
    """Render a concise, human-readable report of the analysis."""
    lines: list[str] = []
    summary = analysis.get("shot_summary", {})
    profile_info = analysis.get("profile_info", {})
    facts = analysis.get("shot_facts", {})

    lines.append(f"Profile:      {_fmt(profile_info.get('name'))}")
    lines.append(f"Temperature:  {_fmt(profile_info.get('temperature'))} °C")
    lines.append(
        "Weight:       "
        f"{_fmt(summary.get('final_weight'))} g "
        f"(target {_fmt(summary.get('target_weight'))} g)"
    )
    lines.append(f"Total time:   {_fmt(summary.get('total_time'))} s")
    lines.append(f"Max pressure: {_fmt(summary.get('max_pressure'))} bar")
    lines.append(f"Max flow:     {_fmt(summary.get('max_flow'))} ml/s")
    lines.append("")
    lines.append("Stage facts")
    lines.append("-----------")

    for stage in facts.get("stages", []):
        name = _fmt(stage.get("stage_name"))
        if not stage.get("reached"):
            lines.append(f"• {name}: not reached")
            continue
        declared = _fmt(stage.get("declared_mode"))
        effective = _fmt(stage.get("control_mode"))
        mode = effective
        if stage.get("mode_overridden"):
            mode = f"{effective} (declared {declared})"
        trig_class = stage.get("trigger_class") or {}
        stall = stage.get("stall") or {}
        chan = stage.get("channeling") or {}
        curve = stage.get("curve_adherence")

        lines.append(f"• {name}")
        lines.append(f"    control mode: {mode}")
        lines.append(
            "    trigger:      "
            f"{_fmt(stage.get('trigger_type'))} → {_fmt(trig_class.get('label'))}"
        )
        if trig_class.get("reason"):
            lines.append(f"                  {trig_class['reason']}")
        lines.append(
            "    stall:        "
            f"{'yes' if stall.get('stalled') else 'no'} "
            f"(weight gain {_fmt(stall.get('weight_gain'))} g)"
        )
        if isinstance(chan, dict) and chan.get("detected") is not None:
            lines.append(f"    channeling:   {'yes' if chan.get('detected') else 'no'}")
        if isinstance(curve, dict):
            lines.append(
                "    curve delta:  "
                f"target {_fmt(curve.get('target'))}, "
                f"measured {_fmt(curve.get('measured'))}, "
                f"Δ {_fmt(curve.get('delta'))}"
            )

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tools.analyze_shot",
        description="Run Metic's deterministic shot analysis on a shot log.",
    )
    parser.add_argument("shot", help="Path to a machine shot-log JSON file.")
    parser.add_argument(
        "profile",
        nargs="?",
        default=None,
        help="Path to a profile JSON file (defaults to the shot's embedded profile).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full analysis object as JSON instead of a report.",
    )
    args = parser.parse_args(argv)

    try:
        analysis = run_analysis(args.shot, args.profile)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(analysis, indent=2, ensure_ascii=False))
    else:
        print(format_report(analysis))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
