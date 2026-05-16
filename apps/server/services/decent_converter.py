"""Decent Espresso profile converter.

Converts Decent Espresso profile JSON (v2 format) to the Meticulous
espresso-profile-schema format used by the Meticulous machine.

Decent profiles use a flat "steps" array with "pump" mode to indicate
whether a step targets flow or pressure.  Meticulous profiles use a
"stages" array where each stage has a "type" field ("flow" or "pressure")
and structured "dynamics", "exit_triggers", and "limits" sub-objects.
"""

import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)


def detect_decent_format(data: Any) -> bool:
    """Detect if a profile dict is in Decent Espresso format.

    Decent profiles are characterised by a top-level ``steps`` array
    where individual steps contain ``pump`` and/or ``sensor`` fields
    (neither of which exists in the Meticulous schema).
    """
    if not isinstance(data, dict):
        return False
    steps = data.get("steps")
    if not steps or not isinstance(steps, list):
        return False
    return any(
        isinstance(s, dict) and ("pump" in s or "sensor" in s)
        for s in steps
    )


def convert_decent_to_meticulous(data: dict) -> dict:
    """Convert a Decent Espresso profile to Meticulous format.

    Returns a dict with two keys:
        - ``profile``: the converted Meticulous profile dict (ready for
          ``_normalize_profile_for_machine``).
        - ``warnings``: a list of human-readable warning strings about
          lossy or unsupported conversions.
    """
    warnings: list[str] = []
    stages: list[dict] = []

    for i, step in enumerate(data.get("steps", [])):
        if not isinstance(step, dict):
            warnings.append(f"Step {i}: not a dict, skipped")
            continue
        stage = _convert_step(step, i, warnings)
        if stage:
            stages.append(stage)

    if not stages:
        warnings.append("No stages could be converted")

    # Build the top-level Meticulous profile
    profile: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": data.get("title", "Imported Decent Profile"),
        "author": data.get("author", "Decent Import"),
        "temperature": _first_temperature(data),
        "final_weight": _first_weight_target(data),
        "stages": stages,
        "variables": [],
        "previous_authors": [],
    }

    notes = data.get("notes", "")
    if notes:
        profile["display"] = {
            "description": notes,
            "shortDescription": notes[:99] if len(notes) > 99 else notes,
        }

    return {"profile": profile, "warnings": warnings}


# ── Internal helpers ─────────────────────────────────────────────────────────


def _first_temperature(data: dict) -> float:
    """Extract the first temperature value from a Decent profile."""
    for step in data.get("steps", []):
        if isinstance(step, dict) and "temperature" in step:
            try:
                return float(step["temperature"])
            except (ValueError, TypeError):
                pass
    return 93.0


def _first_weight_target(data: dict) -> float:
    """Extract the first weight exit target (final_weight) from a Decent profile."""
    for step in data.get("steps", []):
        if not isinstance(step, dict):
            continue
        exit_cond = step.get("exit", {})
        weight = _find_weight_in_exit(exit_cond)
        if weight is not None:
            return weight
    return 36.0


def _find_weight_in_exit(exit_data: dict | None) -> float | None:
    """Recursively search exit conditions for a weight target."""
    if not exit_data or not isinstance(exit_data, dict):
        return None
    if exit_data.get("type") == "weight_over":
        try:
            return float(exit_data["condition"])
        except (ValueError, TypeError, KeyError):
            pass
    return _find_weight_in_exit(exit_data.get("or"))


def _convert_step(step: dict, index: int, warnings: list[str]) -> dict | None:
    """Convert a single Decent step to a Meticulous stage."""
    pump = step.get("pump", "pressure")

    # Determine stage type
    if pump == "flow":
        stage_type = "flow"
    elif pump == "pressure":
        stage_type = "pressure"
    else:
        warnings.append(
            f"Step {index}: unknown pump type '{pump}', defaulting to pressure"
        )
        stage_type = "pressure"

    stage: dict[str, Any] = {
        "name": step.get("name", f"Stage {index + 1}"),
        "type": stage_type,
        "key": f"{stage_type}_{index}",
        "temperature": step.get("temperature", 93.0),
        "limits": [],
    }

    # Build dynamics
    if stage_type == "flow":
        target_value = _safe_float(step.get("flow"), 4.0)
    else:
        target_value = _safe_float(step.get("pressure"), 9.0)

    # Handle ramp transitions: if "smooth" and the step has seconds,
    # create two points [0, start] → [seconds, target].
    transition = step.get("transition", "fast")
    seconds = _safe_float(step.get("seconds"), 0)

    if transition == "smooth" and seconds > 0:
        points = [[0.0, 0.0], [seconds, target_value]]
    else:
        points = [[0.0, target_value]]

    stage["dynamics"] = {
        "type": stage_type,
        "over": "time",
        "interpolation": "linear",
        "points": points,
    }

    # Map exit conditions
    exit_cond = step.get("exit", {})
    stage["exit_triggers"] = _convert_exit(exit_cond, index, warnings)

    # If there are no exit triggers but a seconds value, add a time trigger
    if not stage["exit_triggers"] and seconds > 0:
        stage["exit_triggers"] = [
            {"type": "time", "value": seconds, "relative": True, "comparison": ">="}
        ]

    return stage


def _convert_exit(
    exit_data: dict | None, step_index: int, warnings: list[str]
) -> list[dict]:
    """Convert Decent exit conditions to Meticulous exit triggers."""
    triggers: list[dict] = []
    if not exit_data or not isinstance(exit_data, dict):
        return triggers

    exit_type = exit_data.get("type", "")
    condition = _safe_float(exit_data.get("condition"), 0)

    type_map: dict[str, tuple[str, str | None]] = {
        "pressure_over": ("pressure", "above"),
        "pressure_under": ("pressure", "below"),
        "flow_over": ("flow", "above"),
        "flow_under": ("flow", "below"),
        "time_over": ("time", None),
        "weight_over": ("weight", None),
        "volume_over": ("volume", None),
    }

    if exit_type in type_map:
        mapped_type, direction = type_map[exit_type]
        trigger: dict[str, Any] = {
            "type": mapped_type,
            "value": condition,
            "relative": mapped_type == "time",
            "comparison": ">=",
        }
        if direction:
            trigger["direction"] = direction
        triggers.append(trigger)
    elif exit_type:
        warnings.append(f"Step {step_index}: unknown exit type '{exit_type}'")

    # Handle chained OR conditions
    or_cond = exit_data.get("or")
    if or_cond and isinstance(or_cond, dict):
        triggers.extend(_convert_exit(or_cond, step_index, warnings))

    return triggers


def _safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert a value to float, returning default on failure."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default
