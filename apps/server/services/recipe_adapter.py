"""Recipe profile adaptation — converts OPOS recipes to Meticulous OEPF profiles.

Reads a recipe from the bundled recipe library and builds a Meticulous machine
profile with one stage per OPOS protocol step:

  - ``bloom`` / ``pour`` steps → weight exit trigger (cumulative water poured)
  - ``wait`` / ``swirl`` / ``stir`` steps → time exit trigger

All stages use ``type: power`` with zero power (passive pour-over flow).
"""

import copy
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List

from config import DATA_DIR
from services.pour_over_adapter import _load_template

logger = logging.getLogger(__name__)

# Recipe search paths (mirroring the pour_over_adapter pattern)
_RECIPES_DATA_PATH = DATA_DIR / "recipes"
_RECIPES_FALLBACK_PATH = Path(__file__).resolve().parent.parent.parent.parent / "data" / "recipes"
_RECIPES_DOCKER_PATH = Path("/app/defaults/recipes")

_SEARCH_DIRS = (_RECIPES_DATA_PATH, _RECIPES_FALLBACK_PATH, _RECIPES_DOCKER_PATH)

_STAGE_TEMPLATE = {
    "type": "power",
    "dynamics": {
        "points": [[0, "$power_Zero"], [10, "$power_Zero"]],
        "over": "time",
        "interpolation": "curve",
    },
    "limits": [],
}


def _get_recipes_dir() -> Path:
    """Return the first recipes directory that exists."""
    for path in _SEARCH_DIRS:
        if path.exists() and path.is_dir():
            return path
    raise FileNotFoundError(
        f"Recipes directory not found at any of: {', '.join(str(p) for p in _SEARCH_DIRS)}"
    )


def list_recipe_slugs() -> List[str]:
    """Return sorted list of available recipe slugs."""
    try:
        recipes_dir = _get_recipes_dir()
    except FileNotFoundError:
        return []
    return sorted(p.stem for p in recipes_dir.glob("*.json"))


def load_recipe(slug: str) -> Dict[str, Any]:
    """Load and return a recipe dict by slug.

    Args:
        slug: Recipe filename stem (e.g. ``"4-6-method"``).

    Returns:
        Parsed recipe dict with a ``slug`` key added.

    Raises:
        FileNotFoundError: If the recipe slug does not exist.
    """
    try:
        recipes_dir = _get_recipes_dir()
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Recipe '{slug}' not found: {exc}") from exc

    path = recipes_dir / f"{slug}.json"
    if not path.exists():
        raise FileNotFoundError(f"Recipe '{slug}' not found")

    with open(path, "r", encoding="utf-8") as f:
        recipe = json.load(f)

    recipe["slug"] = slug
    return recipe


def list_recipes() -> List[Dict[str, Any]]:
    """Return all available recipes, each with a ``slug`` key added."""
    try:
        recipes_dir = _get_recipes_dir()
    except FileNotFoundError:
        return []

    recipes = []
    for path in sorted(recipes_dir.glob("*.json")):
        slug = path.stem
        try:
            with open(path, "r", encoding="utf-8") as f:
                recipe = json.load(f)
            recipe["slug"] = slug
            recipes.append(recipe)
        except Exception as exc:
            logger.warning("Failed to load recipe '%s': %s", slug, exc)
    return recipes


def adapt_recipe_to_profile(recipe: Dict[str, Any]) -> Dict[str, Any]:
    """Convert an OPOS recipe dict to a Meticulous OEPF profile.

    Maps each protocol step to a machine stage:
    - ``bloom``/``pour`` → exit when cumulative weight reached
    - ``wait``/``swirl``/``stir`` → exit after ``duration_s`` seconds

    Args:
        recipe: Parsed OPOS recipe dict (must include ``ingredients`` and ``protocol``).

    Returns:
        A fully adapted profile dict ready for machine upload.
    """
    template = _load_template()
    profile = copy.deepcopy(template)

    # ── Unique identity ──────────────────────────────────────────────────────
    profile["id"] = str(uuid.uuid4())
    profile["author_id"] = str(uuid.uuid4())

    # ── Name ─────────────────────────────────────────────────────────────────
    recipe_name = recipe.get("metadata", {}).get("name", "Recipe")
    profile["name"] = f"MeticAI Recipe: {recipe_name}"

    # ── Top-level weight ──────────────────────────────────────────────────────
    ingredients = recipe.get("ingredients", {})
    total_water = float(ingredients.get("water_g", 0))
    coffee_g = float(ingredients.get("coffee_g", 0)) or None
    profile["final_weight"] = total_water

    # ── Short description ─────────────────────────────────────────────────────
    parts = [f"Target: {total_water:.0f}g"]
    if coffee_g:
        parts.append(f"Dose: {coffee_g:.0f}g")
        ratio = total_water / coffee_g
        parts.append(f"Ratio: 1:{ratio:.1f}")
    display = profile.get("display") or {}
    display["shortDescription"] = " | ".join(parts)[:99]
    profile["display"] = display

    # ── Build stages from OPOS protocol steps ─────────────────────────────────
    stages: list = []
    cumulative_water = 0.0
    pour_count = 0

    for step in recipe.get("protocol", []):
        action = step.get("action", "")
        water_g = float(step.get("water_g") or 0)
        duration_s = float(step.get("duration_s") or 30)
        notes = step.get("notes", "")

        stage = copy.deepcopy(_STAGE_TEMPLATE)
        stage["key"] = f"power_{len(stages) + 1}"

        if action in ("bloom", "pour"):
            cumulative_water += water_g
            if action == "bloom":
                stage["name"] = f"Bloom ({water_g:.0f}g / {duration_s:.0f}s)"
                # Bloom exits on time so the rest period is honoured
                stage["exit_triggers"] = [
                    {
                        "type": "time",
                        "value": duration_s,
                        "relative": True,
                        "comparison": ">=",
                    }
                ]
            else:
                pour_count += 1
                stage["name"] = f"Pour {pour_count} (to {cumulative_water:.0f}g)"
                stage["exit_triggers"] = [
                    {
                        "type": "weight",
                        "value": cumulative_water,
                        "relative": False,
                        "comparison": ">=",
                    }
                ]

        elif action in ("wait", "swirl", "stir"):
            if action == "swirl":
                stage["name"] = "Swirl"
            elif action == "stir":
                stage["name"] = "Stir"
            else:
                stage["name"] = f"Wait ({duration_s:.0f}s)"

            stage["exit_triggers"] = [
                {
                    "type": "time",
                    "value": duration_s,
                    "relative": True,
                    "comparison": ">=",
                }
            ]

        else:
            logger.debug("Skipping unknown OPOS action '%s'", action)
            continue

        if notes:
            stage["notes"] = notes

        stages.append(stage)

    profile["stages"] = stages
    return profile
