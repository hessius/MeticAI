"""Pour-over profile adaptation — pure parameter substitution, no LLM.

Reads the ``PourOverBase.json`` template and adapts it for a specific brew:
  - Sets ``final_weight`` and the Infusion exit-trigger weight
  - Updates stage names (e.g. "Bloom (45s)", "Infusion (250g)")
  - Removes the Bloom stage if bloom is disabled
  - Sets the profile name to ``MeticAI Ratio Pour-Over``
"""

import copy
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from config import DATA_DIR

logger = logging.getLogger(__name__)

# Path to the base template (lives in the mounted data volume)
_TEMPLATE_PATH = DATA_DIR / "PourOverBase.json"

# Fallback if DATA_DIR doesn't have it (e.g. dev environment)
_FALLBACK_TEMPLATE_PATH = Path(__file__).resolve().parent.parent.parent.parent / "data" / "PourOverBase.json"

# Docker image ships the template here via COPY in Dockerfile
_DOCKER_TEMPLATE_PATH = Path("/app/defaults/PourOverBase.json")

_SEARCH_PATHS = (_TEMPLATE_PATH, _FALLBACK_TEMPLATE_PATH, _DOCKER_TEMPLATE_PATH)


def _load_template() -> Dict[str, Any]:
    """Load the PourOverBase.json template, trying DATA_DIR first."""
    for path in _SEARCH_PATHS:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError(
        f"PourOverBase.json not found at any of: {', '.join(str(p) for p in _SEARCH_PATHS)}"
    )


def adapt_pour_over_profile(
    *,
    target_weight: float,
    bloom_enabled: bool = True,
    bloom_seconds: float = 30.0,
    dose_grams: Optional[float] = None,
    brew_ratio: Optional[float] = None,
) -> Dict[str, Any]:
    """Adapt the pour-over template for the given parameters.

    Args:
        target_weight: Target brew weight in grams (final_weight).
        bloom_enabled: Whether to include the bloom stage.
        bloom_seconds: Duration of the bloom stage in seconds.
        dose_grams: Dose in grams (informational, stored in display).
        brew_ratio: Brew ratio (informational, stored in display).

    Returns:
        A fully adapted profile dict ready for machine upload.
    """
    template = _load_template()
    profile = copy.deepcopy(template)

    # ── Unique identity ──────────────────────────────────────────────────
    profile["id"] = str(uuid.uuid4())
    profile["author_id"] = str(uuid.uuid4())

    # ── Name ─────────────────────────────────────────────────────────────
    weight_label = f"{target_weight:.0f}g"
    profile["name"] = "MeticAI Ratio Pour-Over"

    # ── Top-level weight ─────────────────────────────────────────────────
    profile["final_weight"] = target_weight

    # ── Short description ────────────────────────────────────────────────
    parts = [f"Target: {weight_label}"]
    if dose_grams is not None:
        parts.append(f"Dose: {dose_grams:.1f}g")
    if brew_ratio is not None:
        parts.append(f"Ratio: 1:{brew_ratio:.1f}")
    display = profile.get("display") or {}
    display["shortDescription"] = " | ".join(parts)[:99]
    profile["display"] = display

    # ── Stages ───────────────────────────────────────────────────────────
    stages = profile.get("stages", [])

    if bloom_enabled and len(stages) >= 2:
        # Stage 0: Bloom — update time trigger
        bloom_stage = stages[0]
        bloom_stage["name"] = f"Bloom ({bloom_seconds:.0f}s)"
        for trigger in bloom_stage.get("exit_triggers", []):
            if trigger.get("type") == "time":
                trigger["value"] = bloom_seconds

        # Stage 1: Infusion — update weight trigger
        infusion_stage = stages[1]
        infusion_stage["name"] = f"Infusion ({weight_label})"
        for trigger in infusion_stage.get("exit_triggers", []):
            if trigger.get("type") == "weight":
                trigger["value"] = target_weight

    elif not bloom_enabled and len(stages) >= 2:
        # Remove bloom stage, keep only infusion
        infusion_stage = stages[1]
        infusion_stage["name"] = f"Infusion ({weight_label})"
        infusion_stage["key"] = "power_1"  # Re-key since it's now first
        for trigger in infusion_stage.get("exit_triggers", []):
            if trigger.get("type") == "weight":
                trigger["value"] = target_weight
        profile["stages"] = [infusion_stage]

    elif len(stages) == 1:
        # Only one stage — treat as infusion
        infusion_stage = stages[0]
        infusion_stage["name"] = f"Infusion ({weight_label})"
        for trigger in infusion_stage.get("exit_triggers", []):
            if trigger.get("type") == "weight":
                trigger["value"] = target_weight

    return profile
