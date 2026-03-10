"""Profile validation service for server-side OEPF pre-validation.

Provides lightweight profile validation before uploading to the Meticulous machine.
Uses the ProfileValidator from the MCP server when the JSON schema is available,
and falls back to basic structural validation otherwise.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from logging_config import get_logger

logger = get_logger()

# Try to import the full ProfileValidator from MCP server
_FULL_VALIDATOR_AVAILABLE = False
_ProfileValidator = None

try:
    # Add MCP server paths - try Docker layout first, then local dev
    _mcp_paths = [
        "/app/mcp-server/meticulous-mcp/src",  # Docker container layout
        os.path.join(
            os.path.dirname(__file__), "..", "..", "mcp-server", "meticulous-mcp", "src"
        ),  # Local dev: apps/server/services -> apps/mcp-server
    ]
    for _mcp_src in _mcp_paths:
        if os.path.isdir(_mcp_src) and _mcp_src not in sys.path:
            sys.path.insert(0, _mcp_src)
            break

    from meticulous_mcp.profile_validator import (  # type: ignore[import-untyped]
        ProfileValidator as _PV,
        ProfileValidationError,
    )
    _ProfileValidator = _PV
    _FULL_VALIDATOR_AVAILABLE = True
    logger.debug("Full OEPF ProfileValidator loaded from MCP server")
except Exception as e:
    logger.debug(f"Full ProfileValidator not available ({e}), using basic validation")


# Schema search paths (Docker and local dev)
_SCHEMA_PATHS = [
    "/app/espresso-profile-schema/schema.json",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "schema.json"),
    os.path.join(
        os.path.dirname(__file__), "..", "..", "mcp-server",
        "meticulous-mcp", "espresso-profile-schema", "schema.json"
    ),
]


class ValidationResult:
    """Result of profile validation."""

    def __init__(self, is_valid: bool, errors: Optional[List[str]] = None):
        self.is_valid = is_valid
        self.errors = errors or []

    def error_summary(self) -> str:
        """Return a concise summary of validation errors for LLM retry prompts."""
        if not self.errors:
            return ""
        lines = [f"{i}. {e}" for i, e in enumerate(self.errors, 1)]
        return "\n".join(lines)


def _find_schema_path() -> Optional[str]:
    """Find the OEPF JSON schema file."""
    for p in _SCHEMA_PATHS:
        if os.path.isfile(p):
            return p
    return None


# Singleton validator instance
_validator_instance: Optional[Any] = None
_basic_mode = False


def _get_validator():
    """Get or create the validator singleton."""
    global _validator_instance, _basic_mode

    if _validator_instance is not None:
        return _validator_instance

    schema_path = _find_schema_path()

    if _FULL_VALIDATOR_AVAILABLE and schema_path:
        try:
            _validator_instance = _ProfileValidator(schema_path=schema_path)
            logger.info("OEPF ProfileValidator initialized with schema at %s", schema_path)
            return _validator_instance
        except Exception as e:
            logger.warning("Failed to initialize full ProfileValidator: %s", e)

    # Fall back to basic mode
    _basic_mode = True
    _validator_instance = "basic"
    logger.info("Using basic profile validation (no JSON schema available)")
    return _validator_instance


def _basic_validate(profile: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Basic structural validation when full schema isn't available.

    Checks the most critical rules that the prompt's validation section covers.
    """
    errors: List[str] = []

    if not isinstance(profile, dict):
        return False, ["Profile must be a JSON object"]

    # Required top-level fields
    if "name" not in profile:
        errors.append("Missing required field: 'name'")
    if "stages" not in profile or not isinstance(profile.get("stages"), list):
        errors.append("Missing or invalid 'stages' array")
    if not profile.get("stages"):
        errors.append("Profile must have at least one stage")

    for i, stage in enumerate(profile.get("stages", [])):
        if not isinstance(stage, dict):
            errors.append(f"Stage {i+1}: must be a JSON object")
            continue

        sname = stage.get("name", f"Stage {i+1}")
        stype = stage.get("type")

        # Stage type validation
        if stype not in ("power", "flow", "pressure"):
            errors.append(f"Stage '{sname}': type must be 'power', 'flow', or 'pressure', got '{stype}'")

        # Exit triggers required
        triggers = stage.get("exit_triggers", [])
        if not triggers:
            errors.append(f"Stage '{sname}': missing exit_triggers")
        else:
            trigger_types = {t.get("type") for t in triggers if isinstance(t, dict)}

            # Paradox check
            if stype in trigger_types and stype in ("flow", "pressure"):
                errors.append(
                    f"Stage '{sname}': {stype} stage cannot have a {stype} exit trigger (paradox)"
                )

            # Backup trigger check
            if len(triggers) == 1 and "time" not in trigger_types:
                errors.append(
                    f"Stage '{sname}': single non-time exit trigger needs a time backup"
                )

        # Cross-type limits check
        limits = stage.get("limits", [])
        if stype == "flow":
            has_pressure_limit = any(
                isinstance(lim, dict) and lim.get("type") == "pressure"
                for lim in limits
            )
            if not has_pressure_limit:
                errors.append(f"Stage '{sname}': flow stage must have a pressure limit")
        elif stype == "pressure":
            has_flow_limit = any(
                isinstance(lim, dict) and lim.get("type") == "flow"
                for lim in limits
            )
            if not has_flow_limit:
                errors.append(f"Stage '{sname}': pressure stage must have a flow limit")

        # Dynamics validation
        dynamics = stage.get("dynamics", {})
        if isinstance(dynamics, dict):
            over = dynamics.get("over")
            if over and over not in ("time", "weight", "piston_position"):
                errors.append(f"Stage '{sname}': dynamics.over must be 'time', 'weight', or 'piston_position'")

            interp = dynamics.get("interpolation")
            if interp and interp not in ("linear", "curve"):
                errors.append(f"Stage '{sname}': interpolation must be 'linear' or 'curve'")

    # Unused adjustable variables check
    variables = profile.get("variables", [])
    if variables and isinstance(variables, list):
        # Build a set of all $key references across all stages (recursive)
        used_keys: set = set()

        def _collect_refs(obj: Any) -> None:
            if isinstance(obj, str):
                if obj.startswith("$"):
                    used_keys.add(obj[1:])
            elif isinstance(obj, list):
                for item in obj:
                    _collect_refs(item)
            elif isinstance(obj, dict):
                for val in obj.values():
                    _collect_refs(val)

        for stage in profile.get("stages", []):
            if isinstance(stage, dict):
                _collect_refs(stage)

        for var in variables:
            if not isinstance(var, dict):
                continue
            key = var.get("key")
            name = var.get("name", "")
            is_info = not var.get("adjustable", True)
            if key and not is_info and key not in used_keys:
                errors.append(
                    f"Adjustable variable '{key}' ({name}) is defined but never used "
                    f"in any stage. Use ${key} in a dynamics point, mark it as info-only "
                    f"(adjustable: false), or remove it."
                )

    return len(errors) == 0, errors


def validate_profile(profile: Dict[str, Any]) -> ValidationResult:
    """Validate a profile against the OEPF schema.

    Uses the full MCP ProfileValidator when available, falls back to basic
    structural validation otherwise.

    Args:
        profile: Profile JSON dictionary to validate.

    Returns:
        ValidationResult with is_valid flag and list of error strings.
    """
    validator = _get_validator()

    if _basic_mode or validator == "basic":
        is_valid, errors = _basic_validate(profile)
    else:
        try:
            from meticulous_mcp.profile_validator import ValidationLevel  # type: ignore[import-untyped]
            is_valid, errors = validator.validate(profile, level=ValidationLevel.STRICT)
        except Exception as e:
            logger.warning("Full validation failed, falling back to basic: %s", e)
            is_valid, errors = _basic_validate(profile)

    if not is_valid:
        logger.debug(
            "Profile validation failed with %d error(s)",
            len(errors),
            extra={"errors": errors[:5]},
        )

    return ValidationResult(is_valid=is_valid, errors=errors)


def is_schema_available() -> bool:
    """Check if the full OEPF schema is available for validation."""
    return _FULL_VALIDATOR_AVAILABLE and _find_schema_path() is not None
