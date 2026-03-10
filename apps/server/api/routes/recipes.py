"""Recipe library endpoints.

Serves the bundled OPOS recipe library. Each recipe is a static JSON file
under ``data/recipes/`` (development) or ``/app/defaults/recipes/`` (Docker).

All recipes include a ``slug`` field derived from the filename stem.
"""

import logging

from fastapi import APIRouter, HTTPException

from services.recipe_adapter import list_recipes, load_recipe

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/recipes")
async def get_recipes():
    """Return the full list of bundled recipes."""
    return list_recipes()


@router.get("/api/recipes/{slug}")
async def get_recipe(slug: str):
    """Return a single recipe by slug.

    Args:
        slug: Recipe filename stem (e.g. ``"4-6-method"``).
    """
    try:
        return load_recipe(slug)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to load recipe '%s': %s", slug, exc)
        raise HTTPException(status_code=500, detail=f"Failed to load recipe: {exc}") from exc
