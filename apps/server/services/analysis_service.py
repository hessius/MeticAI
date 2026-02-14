"""
Shot Analysis Service

This module provides shot analysis functionality including:
- Profile formatting and utilities for display
- Shot stage analysis and execution comparison
- Local algorithmic shot analysis
- Profile description generation
"""

import json
from typing import Any, Optional

from services.gemini_service import get_vision_model, PROFILING_KNOWLEDGE
from logging_config import get_logger

logger = get_logger()

# Constants
STAGE_STATUS_RETRACTING = "retracting"
PREINFUSION_KEYWORDS = ['bloom', 'soak', 'preinfusion', 'pre-infusion', 'pre infusion', 'wet', 'fill', 'landing']


# ============================================================================
# Profile Formatting & Utilities
# ============================================================================

def _format_dynamics_description(stage: dict, variables: list | None = None) -> str:
    """Format a human-readable description of the stage dynamics.
    
    Resolves $variable references in dynamics_points using the provided variables list.
    """
    variables = variables or []
    stage_type = stage.get("type", "unknown")
    dynamics_points = stage.get("dynamics_points", [])
    dynamics_over = stage.get("dynamics_over", "time")
    
    if not dynamics_points:
        return f"{stage_type} stage (no dynamics data)"
    
    unit = "bar" if stage_type == "pressure" else "ml/s"
    over_unit = "s" if dynamics_over == "time" else "g"
    
    def _resolve_dp_value(val):
        """Resolve a dynamics point value, handling $variable references."""
        if isinstance(val, str) and val.startswith('$'):
            resolved, _ = _resolve_variable(val, variables)
            return _safe_float(resolved)
        return _safe_float(val)
    
    if len(dynamics_points) == 1:
        # Constant value
        raw_value = dynamics_points[0][1] if len(dynamics_points[0]) > 1 else dynamics_points[0][0]
        value = _resolve_dp_value(raw_value)
        return f"Constant {stage_type} at {value} {unit}"
    elif len(dynamics_points) == 2:
        start_x = _safe_float(dynamics_points[0][0])
        start_y = _resolve_dp_value(dynamics_points[0][1])
        end_x = _safe_float(dynamics_points[1][0])
        end_y = _resolve_dp_value(dynamics_points[1][1])
        if start_y == end_y:
            return f"Constant {stage_type} at {start_y} {unit} for {end_x}{over_unit}"
        else:
            direction = "ramp up" if end_y > start_y else "ramp down"
            return f"{stage_type.capitalize()} {direction} from {start_y} to {end_y} {unit} over {end_x}{over_unit}"
    else:
        # Multiple points - describe curve
        values = [_resolve_dp_value(p[1]) for p in dynamics_points if len(p) > 1]
        if values:
            return f"{stage_type.capitalize()} curve: {' → '.join(str(v) for v in values)} {unit}"
        return f"Multi-point {stage_type} curve"


def _generate_execution_description(
    stage_type: str,
    duration: float,
    start_pressure: float,
    end_pressure: float,
    max_pressure: float,
    start_flow: float,
    end_flow: float,
    max_flow: float,
    weight_gain: float
) -> str:
    """Generate a human-readable description of what actually happened during stage execution.
    
    This describes the actual behavior observed, not the target.
    Examples:
    - "Pressure rose from 2.1 bar to 8.5 bar over 4.2s"
    - "Declining pressure from 9.0 bar to 6.2 bar"
    - "Steady flow at 2.1 ml/s, extracted 18.5g"
    """
    descriptions = []
    
    # Determine pressure behavior
    pressure_delta = end_pressure - start_pressure
    if abs(pressure_delta) > 0.5:
        if pressure_delta > 0:
            descriptions.append(f"Pressure rose from {start_pressure:.1f} to {end_pressure:.1f} bar")
        else:
            descriptions.append(f"Pressure declined from {start_pressure:.1f} to {end_pressure:.1f} bar")
    elif max_pressure > 0:
        descriptions.append(f"Pressure held around {(start_pressure + end_pressure) / 2:.1f} bar")
    
    # Determine flow behavior
    flow_delta = end_flow - start_flow
    if abs(flow_delta) > 0.3:
        if flow_delta > 0:
            descriptions.append(f"Flow increased from {start_flow:.1f} to {end_flow:.1f} ml/s")
        else:
            descriptions.append(f"Flow decreased from {start_flow:.1f} to {end_flow:.1f} ml/s")
    elif max_flow > 0:
        descriptions.append(f"Flow steady at {(start_flow + end_flow) / 2:.1f} ml/s")
    
    # Add weight info if significant
    if weight_gain > 1.0:
        descriptions.append(f"extracted {weight_gain:.1f}g")
    
    # Add duration
    if duration > 0:
        descriptions.append(f"over {duration:.1f}s")
    
    if descriptions:
        # Capitalize first letter and join
        result = ", ".join(descriptions)
        return result[0].upper() + result[1:]
    
    return f"Stage executed for {duration:.1f}s"


def _safe_float(val, default: float = 0.0) -> float:
    """Safely convert a value to float, handling strings and None."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _resolve_variable(value, variables: list) -> tuple[Any, str | None]:
    """Resolve a variable reference like '$flow_hold limit' to its actual value.
    
    Returns:
        Tuple of (resolved_value, variable_name or None if not a variable)
    """
    if not isinstance(value, str) or not value.startswith('$'):
        return value, None
    
    # Extract variable key (remove the $)
    var_key = value[1:]
    
    # Search for matching variable
    for var in variables:
        if var.get("key") == var_key:
            return var.get("value", value), var.get("name", var_key)
    
    # Variable not found - return original
    return value, var_key


def _format_exit_triggers(exit_triggers: list, variables: list | None = None) -> list[dict]:
    """Format exit triggers into structured descriptions."""
    variables = variables or []
    formatted = []
    for trigger in exit_triggers:
        trigger_type = trigger.get("type", "unknown")
        raw_value = trigger.get("value", 0)
        comparison = trigger.get("comparison", ">=")
        
        # Resolve variable reference if present
        resolved_value, var_name = _resolve_variable(raw_value, variables)
        display_value = _safe_float(resolved_value, 0)
        
        comp_text = {
            ">=": "≥",
            "<=": "≤",
            ">": ">",
            "<": "<",
            "==": "="
        }.get(comparison, comparison)
        
        unit = {
            "time": "s",
            "weight": "g",
            "pressure": "bar",
            "flow": "ml/s"
        }.get(trigger_type, "")
        
        formatted.append({
            "type": trigger_type,
            "value": display_value,
            "comparison": comparison,
            "description": f"{trigger_type} {comp_text} {display_value}{unit}"
        })
    
    return formatted


def _format_limits(limits: list, variables: list | None = None) -> list[dict]:
    """Format stage limits into structured descriptions."""
    variables = variables or []
    formatted = []
    for limit in limits:
        limit_type = limit.get("type", "unknown")
        raw_value = limit.get("value", 0)
        
        # Resolve variable reference if present
        resolved_value, var_name = _resolve_variable(raw_value, variables)
        display_value = _safe_float(resolved_value, 0)
        
        unit = {
            "time": "s",
            "weight": "g",
            "pressure": "bar",
            "flow": "ml/s"
        }.get(limit_type, "")
        
        formatted.append({
            "type": limit_type,
            "value": display_value,
            "description": f"Limit {limit_type} to {display_value}{unit}"
        })
    
    return formatted


# ============================================================================
# Shot Analysis Core
# ============================================================================

def _determine_exit_trigger_hit(
    stage_data: dict,
    exit_triggers: list,
    next_stage_start: float | None = None,
    variables: list | None = None
) -> dict:
    """Determine which exit trigger caused the stage to end.
    
    Returns:
        Dict with 'triggered' (the exit that fired) and 'not_triggered' (exits that didn't fire)
    """
    variables = variables or []
    duration = _safe_float(stage_data.get("duration", 0))
    end_weight = _safe_float(stage_data.get("end_weight", 0))
    # Pressure values for different comparison types
    max_pressure = _safe_float(stage_data.get("max_pressure", 0))
    end_pressure = _safe_float(stage_data.get("end_pressure", 0))
    # Flow values for different comparison types
    max_flow = _safe_float(stage_data.get("max_flow", 0))
    end_flow = _safe_float(stage_data.get("end_flow", 0))
    
    triggered = None
    not_triggered = []
    
    for trigger in exit_triggers:
        trigger_type = trigger.get("type", "")
        raw_value = trigger.get("value", 0)
        comparison = trigger.get("comparison", ">=")
        
        # Resolve variable reference if present
        resolved_value, _ = _resolve_variable(raw_value, variables)
        value = _safe_float(resolved_value)
        
        # Check if this trigger was satisfied
        # Select the appropriate actual value based on comparison operator
        actual_value = 0.0
        if trigger_type == "time":
            actual_value = duration
        elif trigger_type == "weight":
            actual_value = end_weight
        elif trigger_type == "pressure":
            # For >= or >: we want to know if max reached the target
            # For <= or <: we want to know if pressure dropped below target (use end)
            if comparison in (">=", ">"):
                actual_value = max_pressure
            else:  # <= or < or ==
                actual_value = end_pressure
        elif trigger_type == "flow":
            # For >= or >: we want to know if max reached the target
            # For <= or <: we want to know if flow dropped below target (use end)
            if comparison in (">=", ">"):
                actual_value = max_flow
            else:  # <= or < or ==
                actual_value = end_flow
        
        # Evaluate comparison with small tolerance
        tolerance = 0.5 if trigger_type in ["time", "weight"] else 0.2
        was_hit = False
        
        if comparison == ">=":
            was_hit = actual_value >= (value - tolerance)
        elif comparison == ">":
            was_hit = actual_value > value
        elif comparison == "<=":
            was_hit = actual_value <= (value + tolerance)
        elif comparison == "<":
            was_hit = actual_value < value
        elif comparison == "==":
            was_hit = abs(actual_value - value) < tolerance
        
        # Build a proper description with the resolved value
        unit = {"time": "s", "weight": "g", "pressure": "bar", "flow": "ml/s"}.get(trigger_type, "")
        trigger_info = {
            "type": trigger_type,
            "target": value,
            "actual": round(actual_value, 1),
            "description": f"{trigger_type} >= {value}{unit}"
        }
        
        if was_hit:
            if triggered is None:  # First trigger that was hit
                triggered = trigger_info
        else:
            not_triggered.append(trigger_info)
    
    return {
        "triggered": triggered,
        "not_triggered": not_triggered
    }


def _analyze_stage_execution(
    profile_stage: dict,
    shot_stage_data: dict | None,
    total_shot_duration: float,
    variables: list | None = None
) -> dict:
    """Analyze how a single stage executed compared to its profile definition."""
    variables = variables or []
    stage_name = profile_stage.get("name", "Unknown")
    stage_type = profile_stage.get("type", "unknown")
    stage_key = profile_stage.get("key", "")
    
    # Build profile target description
    dynamics_desc = _format_dynamics_description(profile_stage, variables)
    exit_triggers = _format_exit_triggers(profile_stage.get("exit_triggers", []), variables)
    limits = _format_limits(profile_stage.get("limits", []), variables)
    
    result = {
        "stage_name": stage_name,
        "stage_key": stage_key,
        "stage_type": stage_type,
        "profile_target": dynamics_desc,
        "exit_triggers": exit_triggers,
        "limits": limits,
        "executed": shot_stage_data is not None,
        "execution_data": None,
        "exit_trigger_result": None,
        "limit_hit": None,
        "assessment": None
    }
    
    if shot_stage_data is None:
        result["assessment"] = {
            "status": "not_reached",
            "message": "This stage was never executed during the shot"
        }
        return result
    
    # Stage was executed - analyze it
    duration = _safe_float(shot_stage_data.get("duration", 0))
    start_weight = _safe_float(shot_stage_data.get("start_weight", 0))
    end_weight = _safe_float(shot_stage_data.get("end_weight", 0))
    weight_gain = end_weight - start_weight
    start_pressure = _safe_float(shot_stage_data.get("start_pressure", 0))
    end_pressure = _safe_float(shot_stage_data.get("end_pressure", 0))
    avg_pressure = _safe_float(shot_stage_data.get("avg_pressure", 0))
    max_pressure = _safe_float(shot_stage_data.get("max_pressure", 0))
    min_pressure = _safe_float(shot_stage_data.get("min_pressure", 0))
    start_flow = _safe_float(shot_stage_data.get("start_flow", 0))
    end_flow = _safe_float(shot_stage_data.get("end_flow", 0))
    avg_flow = _safe_float(shot_stage_data.get("avg_flow", 0))
    max_flow = _safe_float(shot_stage_data.get("max_flow", 0))
    
    # Generate execution description based on what actually happened
    execution_description = _generate_execution_description(
        stage_type, duration, 
        start_pressure, end_pressure, max_pressure,
        start_flow, end_flow, max_flow,
        weight_gain
    )
    
    result["execution_data"] = {
        "duration": round(duration, 1),
        "weight_gain": round(weight_gain, 1),
        "start_weight": round(start_weight, 1),
        "end_weight": round(end_weight, 1),
        "start_pressure": round(start_pressure, 1),
        "end_pressure": round(end_pressure, 1),
        "avg_pressure": round(avg_pressure, 1),
        "max_pressure": round(max_pressure, 1),
        "min_pressure": round(min_pressure, 1),
        "start_flow": round(start_flow, 1),
        "end_flow": round(end_flow, 1),
        "avg_flow": round(avg_flow, 1),
        "max_flow": round(max_flow, 1),
        "description": execution_description
    }
    
    # Determine which exit trigger was hit
    if profile_stage.get("exit_triggers"):
        exit_result = _determine_exit_trigger_hit(
            shot_stage_data,
            profile_stage.get("exit_triggers", []),
            variables=variables
        )
        result["exit_trigger_result"] = exit_result
    
    # Check if any limits were hit
    stage_limits = profile_stage.get("limits", [])
    for limit in stage_limits:
        limit_type = limit.get("type", "")
        raw_limit_value = limit.get("value", 0)
        
        # Resolve variable reference if present
        resolved_limit_value, _ = _resolve_variable(raw_limit_value, variables)
        limit_value = _safe_float(resolved_limit_value)
        
        actual = 0.0
        if limit_type == "flow":
            actual = max_flow
        elif limit_type == "pressure":
            actual = max_pressure
        elif limit_type == "time":
            actual = duration
        elif limit_type == "weight":
            actual = end_weight
        
        # Check if limit was hit (within small tolerance)
        unit = {"time": "s", "weight": "g", "pressure": "bar", "flow": "ml/s"}.get(limit_type, "")
        if actual >= limit_value - 0.2:
            result["limit_hit"] = {
                "type": limit_type,
                "limit_value": limit_value,
                "actual_value": round(actual, 1),
                "description": f"Hit {limit_type} limit of {limit_value}{unit}"
            }
            break
    
    # Generate assessment
    if result["exit_trigger_result"] and result["exit_trigger_result"]["triggered"]:
        if result["limit_hit"]:
            result["assessment"] = {
                "status": "hit_limit",
                "message": f"Stage exited but hit a limit ({result['limit_hit']['description']})"
            }
        else:
            result["assessment"] = {
                "status": "reached_goal",
                "message": f"Exited via: {result['exit_trigger_result']['triggered']['description']}"
            }
    elif result["exit_trigger_result"] and result["exit_trigger_result"]["not_triggered"]:
        # No trigger was hit - stage ended prematurely, this is a failure
        # Check if the dynamics goal was reached (e.g., target pressure)
        goal_reached = False
        goal_message = ""
        
        dynamics_points = profile_stage.get("dynamics_points", [])
        if dynamics_points and len(dynamics_points) >= 1:
            # Get the target value (last point in dynamics)
            raw_target = dynamics_points[-1][1] if len(dynamics_points[-1]) > 1 else dynamics_points[-1][0]
            
            # Resolve variable reference if present (e.g. "$decline_pressure")
            if isinstance(raw_target, str) and raw_target.startswith('$'):
                resolved, _ = _resolve_variable(raw_target, variables)
                target_value = _safe_float(resolved)
            else:
                target_value = _safe_float(raw_target)
            
            if stage_type == "pressure":
                # Check if we reached target pressure
                if target_value > 0 and max_pressure >= target_value * 0.95:  # Within 5%
                    goal_reached = True
                    goal_message = f"Target pressure of {target_value} bar was reached ({max_pressure:.1f} bar achieved)"
                elif target_value > 0:
                    goal_message = f"Target pressure of {target_value} bar was NOT reached (only {max_pressure:.1f} bar achieved)"
            elif stage_type == "flow":
                # For flow stages, use end_flow (not max_flow) since initial peak is just piston movement
                if target_value > 0 and end_flow >= target_value * 0.95:
                    goal_reached = True
                    goal_message = f"Target flow of {target_value} ml/s was reached ({end_flow:.1f} ml/s at end)"
                elif target_value > 0:
                    goal_message = f"Target flow of {target_value} ml/s was NOT reached ({end_flow:.1f} ml/s at end)"
        
        if goal_reached:
            result["assessment"] = {
                "status": "incomplete",
                "message": f"Stage ended before exit triggers were satisfied, but {goal_message.lower()}"
            }
        else:
            result["assessment"] = {
                "status": "failed",
                "message": f"Stage ended before exit triggers were satisfied. {goal_message}" if goal_message else "Stage ended before exit triggers were satisfied"
            }
    else:
        result["assessment"] = {
            "status": "executed",
            "message": "Stage executed (no exit triggers defined)"
        }
    
    return result


def _extract_shot_stage_data(shot_data: dict) -> dict[str, dict]:
    """Extract per-stage telemetry from shot data.
    
    Returns a dict mapping stage names to their execution data.
    """
    data_entries = shot_data.get("data", [])
    if not data_entries:
        return {}
    
    # Group data by stage
    stage_data = {}
    current_stage = None
    stage_entries = []
    
    for entry in data_entries:
        status = entry.get("status", "")
        
        # Skip retracting - it's machine cleanup
        if status.lower().strip() == STAGE_STATUS_RETRACTING:
            continue
        
        if status and status != current_stage:
            # Save previous stage data
            if current_stage and stage_entries:
                stage_data[current_stage] = _compute_stage_stats(stage_entries)
            
            current_stage = status
            stage_entries = []
        
        if current_stage:
            stage_entries.append(entry)
    
    # Save final stage
    if current_stage and stage_entries:
        stage_data[current_stage] = _compute_stage_stats(stage_entries)
    
    return stage_data


def _compute_stage_stats(entries: list) -> dict:
    """Compute statistics for a stage from its telemetry entries."""
    if not entries:
        return {}
    
    times = []
    pressures = []
    flows = []
    weights = []
    
    for entry in entries:
        t = entry.get("time", 0) / 1000  # Convert to seconds
        times.append(t)
        
        shot = entry.get("shot", {})
        pressures.append(shot.get("pressure", 0))
        flows.append(shot.get("flow", 0) or shot.get("gravimetric_flow", 0))
        weights.append(shot.get("weight", 0))
    
    start_time = min(times) if times else 0
    end_time = max(times) if times else 0
    
    return {
        "start_time": start_time,
        "end_time": end_time,
        "duration": end_time - start_time,
        "start_weight": weights[0] if weights else 0,
        "end_weight": weights[-1] if weights else 0,
        "start_pressure": pressures[0] if pressures else 0,
        "end_pressure": pressures[-1] if pressures else 0,
        "min_pressure": min(pressures) if pressures else 0,
        "max_pressure": max(pressures) if pressures else 0,
        "avg_pressure": sum(pressures) / len(pressures) if pressures else 0,
        "start_flow": flows[0] if flows else 0,
        "end_flow": flows[-1] if flows else 0,
        "min_flow": min(flows) if flows else 0,
        "max_flow": max(flows) if flows else 0,
        "avg_flow": sum(flows) / len(flows) if flows else 0,
        "entry_count": len(entries)
    }


def _interpolate_weight_to_time(target_weight: float, weight_time_pairs: list[tuple[float, float]]) -> Optional[float]:
    """Interpolate time value for a given weight using linear interpolation.
    
    Args:
        target_weight: The weight value to find the corresponding time for
        weight_time_pairs: List of (weight, time) tuples sorted by weight
        
    Returns:
        Interpolated time value, or None if no data available
    """
    if not weight_time_pairs:
        return None
    
    # Find bracketing weight values
    for i in range(len(weight_time_pairs)):
        weight_actual, time_actual = weight_time_pairs[i]
        
        if weight_actual >= target_weight:
            if i == 0:
                # Before first point, use first time
                return time_actual
            else:
                # Interpolate between i-1 and i
                weight_prev, time_prev = weight_time_pairs[i-1]
                if weight_actual > weight_prev:
                    # Linear interpolation
                    weight_fraction = (target_weight - weight_prev) / (weight_actual - weight_prev)
                    return time_prev + weight_fraction * (time_actual - time_prev)
                else:
                    # Same weight, use current time
                    return time_actual
            
    # If not found, use last time (weight exceeds all actual weights)
    return weight_time_pairs[-1][1]


def _generate_profile_target_curves(profile_data: dict, shot_stage_times: dict, shot_data: dict) -> list[dict]:
    """Generate target curves for profile overlay on shot chart.
    
    Creates data points representing what the profile was targeting at each time point.
    Uses actual shot stage times to align the profile curves with the shot execution.
    Supports both time-based and weight-based dynamics.
    
    Args:
        profile_data: The profile configuration
        shot_stage_times: Dict mapping stage names to (start_time, end_time) tuples
        shot_data: The complete shot data including telemetry entries
        
    Returns:
        List of data points: [{time, target_pressure, target_flow, stage_name}, ...]
    """
    stages = profile_data.get("stages", [])
    variables = profile_data.get("variables", [])
    data_points = []
    
    # Build weight-to-time mappings for each stage from shot data
    # This enables weight-based dynamics interpolation
    stage_weight_to_time = {}
    data_entries = shot_data.get("data", [])
    
    for entry in data_entries:
        status = entry.get("status", "")
        if not status or status.lower().strip() == STAGE_STATUS_RETRACTING:
            continue
        
        time_sec = entry.get("time", 0) / 1000  # Convert to seconds
        weight = entry.get("shot", {}).get("weight", 0)
        
        # Normalize stage name for matching
        normalized_status = status.lower().strip()
        
        if normalized_status not in stage_weight_to_time:
            stage_weight_to_time[normalized_status] = []
        
        stage_weight_to_time[normalized_status].append((weight, time_sec))
    
    for stage in stages:
        stage_name = stage.get("name", "")
        stage_type = stage.get("type", "")  # pressure or flow
        
        # Handle both flat format (dynamics_points) and nested format (dynamics.points)
        dynamics_points = stage.get("dynamics_points", [])
        dynamics_over = stage.get("dynamics_over", "time")  # time or weight
        
        # If flat format not found, try nested dynamics object
        if not dynamics_points:
            dynamics_obj = stage.get("dynamics", {})
            if isinstance(dynamics_obj, dict):
                dynamics_points = dynamics_obj.get("points", [])
                dynamics_over = dynamics_obj.get("over", "time")
        
        if not dynamics_points:
            continue
            
        # Get actual stage timing from shot
        # Match using either stage name or stage key (for consistency with main analysis)
        identifiers = set()
        if stage_name:
            identifiers.add(stage_name.lower().strip())
        stage_key_field = stage.get("key", "")
        if stage_key_field:
            identifiers.add(stage_key_field.lower().strip())

        stage_timing = None
        for shot_stage_name, timing in shot_stage_times.items():
            normalized_shot_stage_name = shot_stage_name.lower().strip()
            if normalized_shot_stage_name in identifiers:
                stage_timing = timing
                break
        
        if not stage_timing:
            continue
            
        stage_start, stage_end = stage_timing
        stage_duration = stage_end - stage_start
        
        if stage_duration <= 0:
            continue
        
        # Generate points along the stage duration
        # For time-based dynamics, interpolate directly
        if dynamics_over == "time":
            # Get the dynamics point times (x values) and target values (y values)
            if len(dynamics_points) == 1:
                # Constant value throughout stage
                value = dynamics_points[0][1] if len(dynamics_points[0]) > 1 else dynamics_points[0][0]
                # Resolve variable if needed
                if isinstance(value, str) and value.startswith('$'):
                    resolved, _ = _resolve_variable(value, variables)
                    value = _safe_float(resolved)
                else:
                    value = _safe_float(value)
                    
                # Add start and end points
                point_start = {"time": round(stage_start, 2), "stage_name": stage_name}
                point_end = {"time": round(stage_end, 2), "stage_name": stage_name}
                
                if stage_type == "pressure":
                    point_start["target_pressure"] = round(value, 1)
                    point_end["target_pressure"] = round(value, 1)
                elif stage_type == "flow":
                    point_start["target_flow"] = round(value, 1)
                    point_end["target_flow"] = round(value, 1)
                    
                data_points.append(point_start)
                data_points.append(point_end)
            else:
                # Multiple points - interpolate based on relative time within stage
                # dynamics_points format: [[time1, value1], [time2, value2], ...]
                max_dynamics_time = max(_safe_float(p[0]) for p in dynamics_points)
                
                # Scale factor to map dynamics time to actual stage duration
                scale = stage_duration / max_dynamics_time if max_dynamics_time > 0 else 1
                
                for dp in dynamics_points:
                    dp_time = _safe_float(dp[0])
                    dp_value = dp[1] if len(dp) > 1 else dp[0]
                    
                    # Resolve variable if needed
                    if isinstance(dp_value, str) and dp_value.startswith('$'):
                        resolved, _ = _resolve_variable(dp_value, variables)
                        dp_value = _safe_float(resolved)
                    else:
                        dp_value = _safe_float(dp_value)
                    
                    actual_time = stage_start + (dp_time * scale)
                    
                    point = {"time": round(actual_time, 2), "stage_name": stage_name}
                    if stage_type == "pressure":
                        point["target_pressure"] = round(dp_value, 1)
                    elif stage_type == "flow":
                        point["target_flow"] = round(dp_value, 1)
                        
                    data_points.append(point)
        
        # For weight-based dynamics, map weight values to time using actual shot data
        elif dynamics_over == "weight":
            # Get weight-to-time mapping for this stage
            stage_key_normalized = None
            for identifier in identifiers:
                if identifier in stage_weight_to_time:
                    stage_key_normalized = identifier
                    break
            
            if not stage_key_normalized or not stage_weight_to_time[stage_key_normalized]:
                # No weight data available for this stage
                continue
            
            weight_time_pairs = stage_weight_to_time[stage_key_normalized]
            
            # Sort by weight to enable interpolation
            weight_time_pairs.sort(key=lambda x: x[0])
            
            if len(dynamics_points) == 1:
                # Constant value throughout stage
                value = dynamics_points[0][1] if len(dynamics_points[0]) > 1 else dynamics_points[0][0]
                
                # Resolve variable if needed
                if isinstance(value, str) and value.startswith('$'):
                    resolved, _ = _resolve_variable(value, variables)
                    value = _safe_float(resolved)
                else:
                    value = _safe_float(value)
                
                # Add start and end points
                point_start = {"time": round(stage_start, 2), "stage_name": stage_name}
                point_end = {"time": round(stage_end, 2), "stage_name": stage_name}
                
                if stage_type == "pressure":
                    point_start["target_pressure"] = round(value, 1)
                    point_end["target_pressure"] = round(value, 1)
                elif stage_type == "flow":
                    point_start["target_flow"] = round(value, 1)
                    point_end["target_flow"] = round(value, 1)
                
                data_points.append(point_start)
                data_points.append(point_end)
            else:
                # Multiple points - interpolate weight values to time
                # dynamics_points format: [[weight1, value1], [weight2, value2], ...]
                for dp in dynamics_points:
                    dp_weight = _safe_float(dp[0])
                    dp_value = dp[1] if len(dp) > 1 else dp[0]
                    
                    # Resolve variable if needed
                    if isinstance(dp_value, str) and dp_value.startswith('$'):
                        resolved, _ = _resolve_variable(dp_value, variables)
                        dp_value = _safe_float(resolved)
                    else:
                        dp_value = _safe_float(dp_value)
                    
                    # Find time corresponding to this weight using linear interpolation
                    actual_time = _interpolate_weight_to_time(dp_weight, weight_time_pairs)
                    
                    if actual_time is not None:
                        point = {"time": round(actual_time, 2), "stage_name": stage_name}
                        if stage_type == "pressure":
                            point["target_pressure"] = round(dp_value, 1)
                        elif stage_type == "flow":
                            point["target_flow"] = round(dp_value, 1)
                        
                        data_points.append(point)
    
    # Sort by time
    data_points.sort(key=lambda x: x["time"])
    
    return data_points


def _perform_local_shot_analysis(shot_data: dict, profile_data: dict) -> dict:
    """Perform complete local analysis of shot vs profile.
    
    This is a purely algorithmic analysis - no LLM involved.
    """
    # Extract overall shot metrics
    data_entries = shot_data.get("data", [])
    
    final_weight = 0
    total_time = 0
    max_pressure = 0
    max_flow = 0
    
    for entry in data_entries:
        shot = entry.get("shot", {})
        weight = shot.get("weight", 0)
        pressure = shot.get("pressure", 0)
        flow = shot.get("flow", 0) or shot.get("gravimetric_flow", 0)
        t = entry.get("time", 0) / 1000
        
        final_weight = max(final_weight, weight)
        total_time = max(total_time, t)
        max_pressure = max(max_pressure, pressure)
        max_flow = max(max_flow, flow)
    
    target_weight = profile_data.get("final_weight", 0) or 0
    
    # Weight analysis
    weight_deviation = 0
    weight_status = "on_target"
    if target_weight > 0:
        weight_deviation = ((final_weight - target_weight) / target_weight) * 100
        if final_weight < target_weight * 0.95:  # More than 5% under
            weight_status = "under"
        elif final_weight > target_weight * 1.1:  # More than 10% over
            weight_status = "over"
    
    # Extract shot stage data
    shot_stages = _extract_shot_stage_data(shot_data)
    
    # Build shot stage times for profile curve generation
    shot_stage_times = {}
    for stage_name, stage_data in shot_stages.items():
        start_time = stage_data.get("start_time", 0)
        end_time = stage_data.get("end_time", 0)
        shot_stage_times[stage_name] = (start_time, end_time)
    
    # Generate profile target curves for chart overlay
    profile_target_curves = _generate_profile_target_curves(profile_data, shot_stage_times, shot_data)
    
    # Profile stages
    profile_stages = profile_data.get("stages", [])
    profile_variables = profile_data.get("variables", [])
    
    # Analyze each profile stage
    stage_analyses = []
    executed_stages = set()
    unreached_stages = []
    preinfusion_time = 0
    preinfusion_stages = []
    
    for profile_stage in profile_stages:
        stage_name = profile_stage.get("name", "")
        stage_key = profile_stage.get("key", "").lower()
        
        # Find matching shot stage (by name, case-insensitive)
        shot_stage_data = None
        for shot_stage_name, data in shot_stages.items():
            if shot_stage_name.lower().strip() == stage_name.lower().strip():
                shot_stage_data = data
                executed_stages.add(stage_name)
                break
        
        analysis = _analyze_stage_execution(profile_stage, shot_stage_data, total_time, profile_variables)
        stage_analyses.append(analysis)
        
        # Track unreached
        if not analysis["executed"]:
            unreached_stages.append(stage_name)
        
        # Track preinfusion time
        name_lower = stage_name.lower()
        is_preinfusion = any(kw in name_lower for kw in PREINFUSION_KEYWORDS) or \
                         any(kw in stage_key for kw in ['preinfusion', 'bloom', 'soak', 'fill'])
        
        if is_preinfusion and shot_stage_data:
            preinfusion_time += _safe_float(shot_stage_data.get("duration", 0))
            preinfusion_stages.append({
                "name": stage_name,
                "duration": _safe_float(shot_stage_data.get("duration", 0)),
                "start_weight": _safe_float(shot_stage_data.get("start_weight", 0)),
                "end_weight": _safe_float(shot_stage_data.get("end_weight", 0)),
                "max_flow": _safe_float(shot_stage_data.get("max_flow", 0)),
                "avg_flow": _safe_float(shot_stage_data.get("avg_flow", 0)),
                "exit_triggers": profile_stage.get("exit_triggers", [])
            })
    
    # Preinfusion analysis
    preinfusion_proportion = (preinfusion_time / total_time * 100) if total_time > 0 else 0
    
    # Calculate total weight accumulated during preinfusion
    preinfusion_weight = 0
    for pi_stage in preinfusion_stages:
        # Weight gained in this stage
        stage_weight_gain = pi_stage["end_weight"] - pi_stage["start_weight"]
        preinfusion_weight += max(0, stage_weight_gain)
    
    # Preinfusion weight analysis
    preinfusion_weight_percent = (preinfusion_weight / final_weight * 100) if final_weight > 0 else 0
    preinfusion_issues = []
    preinfusion_recommendations = []
    
    if preinfusion_weight_percent > 10:
        preinfusion_issues.append({
            "type": "excessive_preinfusion_volume",
            "severity": "warning" if preinfusion_weight_percent <= 15 else "concern",
            "message": f"Pre-infusion accounted for {preinfusion_weight_percent:.1f}% of total shot volume (target: ≤10%)",
            "detail": f"{preinfusion_weight:.1f}g of {final_weight:.1f}g total"
        })
        
        # Check for high flow during preinfusion
        max_preinfusion_flow = max((s["max_flow"] for s in preinfusion_stages), default=0)
        avg_preinfusion_flow = sum(s["avg_flow"] for s in preinfusion_stages) / len(preinfusion_stages) if preinfusion_stages else 0
        
        if max_preinfusion_flow > 2.0 or avg_preinfusion_flow > 1.0:
            preinfusion_issues.append({
                "type": "high_preinfusion_flow",
                "severity": "warning",
                "message": f"High flow during pre-infusion (max: {max_preinfusion_flow:.1f} ml/s, avg: {avg_preinfusion_flow:.1f} ml/s)",
                "detail": "May indicate grind is too coarse"
            })
            preinfusion_recommendations.append("Consider using a finer grind to slow early flow")
        
        # Check if exit triggers include weight/flow protection
        has_weight_exit = False
        has_flow_exit = False
        for pi_stage in preinfusion_stages:
            for trigger in pi_stage.get("exit_triggers", []):
                trigger_type = trigger.get("type", "") if isinstance(trigger, dict) else ""
                if "weight" in trigger_type.lower():
                    has_weight_exit = True
                if "flow" in trigger_type.lower():
                    has_flow_exit = True
        
        if not has_weight_exit and not has_flow_exit:
            preinfusion_recommendations.append("Consider adding a weight or flow exit trigger to pre-infusion stages to prevent excessive early volume")
        elif not has_weight_exit:
            preinfusion_recommendations.append("Consider adding a weight-based exit trigger to limit pre-infusion volume")
    
    return {
        "shot_summary": {
            "final_weight": round(final_weight, 1),
            "target_weight": round(target_weight, 1) if target_weight else None,
            "total_time": round(total_time, 1),
            "max_pressure": round(max_pressure, 1),
            "max_flow": round(max_flow, 1)
        },
        "weight_analysis": {
            "status": weight_status,
            "target": round(target_weight, 1) if target_weight else None,
            "actual": round(final_weight, 1),
            "deviation_percent": round(weight_deviation, 1)
        },
        "stage_analyses": stage_analyses,
        "unreached_stages": unreached_stages,
        "preinfusion_summary": {
            "stages": [s["name"] for s in preinfusion_stages],
            "total_time": round(preinfusion_time, 1),
            "proportion_of_shot": round(preinfusion_proportion, 1),
            "weight_accumulated": round(preinfusion_weight, 1),
            "weight_percent_of_total": round(preinfusion_weight_percent, 1),
            "issues": preinfusion_issues,
            "recommendations": preinfusion_recommendations
        },
        "profile_info": {
            "name": profile_data.get("name", "Unknown"),
            "temperature": profile_data.get("temperature"),
            "stage_count": len(profile_stages)
        },
        "profile_target_curves": profile_target_curves
    }


def _prepare_shot_summary_for_llm(shot_data: dict, profile_data: dict, local_analysis: dict) -> dict:
    """Prepare a token-efficient summary of shot data for LLM analysis.
    
    Extracts only key data points to minimize token usage while providing
    enough context for meaningful analysis.
    """
    # Basic shot metrics
    overall = local_analysis.get("overall_metrics", {})
    weight_analysis = local_analysis.get("weight_analysis", {})
    preinfusion = local_analysis.get("preinfusion_summary", {})
    
    # Stage summary (compact format)
    stage_summaries = []
    total_time = overall.get("total_time", 0)
    
    for stage in local_analysis.get("stage_analyses", []):
        exec_data = stage.get("execution_data")
        if exec_data:
            duration = exec_data.get("duration", 0)
            pct_of_shot = round((duration / total_time * 100) if total_time > 0 else 0, 1)
            # Safely extract exit trigger and limit hit descriptions
            exit_trigger_desc = None
            exit_trigger_result = stage.get("exit_trigger_result")
            if exit_trigger_result:
                triggered = exit_trigger_result.get("triggered")
                if triggered and isinstance(triggered, dict):
                    exit_trigger_desc = triggered.get("description")
            
            limit_hit_desc = None
            limit_hit = stage.get("limit_hit")
            if limit_hit and isinstance(limit_hit, dict):
                limit_hit_desc = limit_hit.get("description")
            
            stage_summaries.append({
                "name": stage.get("stage_name"),
                "duration_s": round(duration, 1),
                "percent_of_shot": pct_of_shot,
                "avg_pressure": exec_data.get("avg_pressure"),
                "avg_flow": exec_data.get("avg_flow"),
                "weight_gain": exec_data.get("weight_gain"),
                "cumulative_weight_at_end": exec_data.get("end_weight"),  # Added: cumulative weight when stage ended
                "exit_trigger": exit_trigger_desc,
                "limit_hit": limit_hit_desc
            })
        else:
            stage_summaries.append({
                "name": stage.get("stage_name"),
                "status": "NOT REACHED"
            })
    
    # Profile variables (resolved values)
    variables = []
    for var in profile_data.get("variables", []):
        variables.append({
            "name": var.get("name"),
            "type": var.get("type"),
            "value": var.get("value")
        })
    
    # Simplified graph data - sample key points from the shot
    data_entries = shot_data.get("data", [])
    graph_summary = []
    
    if data_entries:
        # Sample at key points: start, 25%, 50%, 75%, end, and any stage transitions
        sample_indices = [0]
        n = len(data_entries)
        for pct in [0.25, 0.5, 0.75]:
            idx = int(n * pct)
            if idx not in sample_indices:
                sample_indices.append(idx)
        sample_indices.append(n - 1)
        
        for idx in sorted(set(sample_indices)):
            entry = data_entries[idx]
            shot = entry.get("shot", {})
            graph_summary.append({
                "time_s": round(entry.get("time", 0) / 1000, 1),
                "pressure": round(shot.get("pressure", 0), 1),
                "flow": round(shot.get("flow", 0) or shot.get("gravimetric_flow", 0), 1),
                "weight": round(shot.get("weight", 0), 1),
                "stage": entry.get("status", "")
            })
    
    return {
        "shot_summary": {
            "total_time_s": overall.get("total_time"),
            "final_weight_g": weight_analysis.get("actual"),
            "target_weight_g": weight_analysis.get("target"),
            "weight_deviation_pct": weight_analysis.get("deviation_percent"),
            "max_pressure_bar": overall.get("max_pressure"),
            "max_flow_mls": overall.get("max_flow"),
            "temperature_c": profile_data.get("temperature")
        },
        "stages": stage_summaries,
        "unreached_stages": local_analysis.get("unreached_stages", []),
        "preinfusion": {
            "total_time_s": preinfusion.get("total_time"),
            "percent_of_shot": preinfusion.get("proportion_of_shot"),
            "weight_accumulated_g": preinfusion.get("weight_accumulated")
        },
        "variables": variables,
        "graph_samples": graph_summary
    }


# ============================================================================
# Profile Description
# ============================================================================

async def _generate_profile_description(profile_json: dict, request_id: str) -> str:
    """Generate a description for a profile using the LLM with profiling knowledge."""
    
    profile_name = profile_json.get("name", "Unknown Profile")
    
    # Build a prompt with profiling knowledge and profile details
    prompt = f"""You are an expert espresso barista analysing profiles for the Meticulous Espresso Machine.

## Expert Profiling Knowledge
{PROFILING_KNOWLEDGE}

Analyze this Meticulous Espresso profile and generate a description in the standard MeticAI format.

PROFILE JSON:
```json
{json.dumps(profile_json, indent=2)}
```

Generate a response in this exact format:

Profile Created: {profile_name}

Description:
[Describe what makes this profile unique and what flavor characteristics it targets. Be specific about the extraction approach.]

Preparation:
• Dose: [Recommended dose based on profile settings]
• Grind: [Grind recommendation based on flow rates and pressure curves]
• Temperature: [From profile or recommendation]
• Target Yield: [From profile final_weight or recommendation]
• Expected Time: [Based on stage durations]

Why This Works:
[Explain the science behind the profile design - why the pressure curves, flow rates, and staging work together]

Special Notes:
[Any specific requirements or tips for using this profile]

Be concise but informative. Focus on actionable barista guidance."""

    model = get_vision_model()
    response = model.generate_content(prompt)
    
    return response.text.strip()
