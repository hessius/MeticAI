"""Pour-over machine integration endpoints.

Provides the lifecycle for temporary pour-over profiles:
  - Prepare: adapt template → create on machine → load
  - Cleanup: purge + delete after shot finishes
  - Force-cleanup: delete without purge (aborted shots)
  - Active: query the current temp profile
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.pour_over_adapter import adapt_pour_over_profile
from services import temp_profile_service

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class PrepareRequest(BaseModel):
    target_weight: float = Field(..., gt=0, description="Target brew weight in grams")
    bloom_enabled: bool = Field(True, description="Include bloom stage")
    bloom_seconds: float = Field(30.0, gt=0, le=300, description="Bloom duration in seconds")
    dose_grams: Optional[float] = Field(None, gt=0, description="Dose in grams (informational)")
    brew_ratio: Optional[float] = Field(None, gt=0, description="Brew ratio (informational)")


class PrepareResponse(BaseModel):
    profile_id: str
    profile_name: str


class CleanupResponse(BaseModel):
    status: str
    deleted_profile: Optional[str] = None
    error: Optional[str] = None


class ActiveResponse(BaseModel):
    active: bool
    profile_id: Optional[str] = None
    profile_name: Optional[str] = None
    original_params: Optional[dict] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/api/pour-over/prepare", response_model=PrepareResponse)
async def prepare_pour_over(body: PrepareRequest):
    """Adapt the pour-over template and load it on the machine.

    Creates a temporary profile with the given parameters, uploads it to the
    machine, and selects it so the user can press Start.
    """
    try:
        profile_json = adapt_pour_over_profile(
            target_weight=body.target_weight,
            bloom_enabled=body.bloom_enabled,
            bloom_seconds=body.bloom_seconds,
            dose_grams=body.dose_grams,
            brew_ratio=body.brew_ratio,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    result = await temp_profile_service.create_and_load(
        profile_json,
        params={
            "target_weight": body.target_weight,
            "bloom_enabled": body.bloom_enabled,
            "bloom_seconds": body.bloom_seconds,
            "dose_grams": body.dose_grams,
            "brew_ratio": body.brew_ratio,
        },
    )

    return PrepareResponse(
        profile_id=result["profile_id"],
        profile_name=result["profile_name"],
    )


@router.post("/api/pour-over/cleanup", response_model=CleanupResponse)
async def cleanup_pour_over():
    """Purge the group head and delete the temporary profile."""
    result = await temp_profile_service.cleanup()
    return CleanupResponse(**result)


@router.post("/api/pour-over/force-cleanup", response_model=CleanupResponse)
async def force_cleanup_pour_over():
    """Delete the temporary profile without purging (for aborted shots)."""
    result = await temp_profile_service.force_cleanup()
    return CleanupResponse(**result)


@router.get("/api/pour-over/active", response_model=ActiveResponse)
async def get_active_pour_over():
    """Return the currently active temporary profile, if any."""
    active = temp_profile_service.get_active()
    if active is None:
        return ActiveResponse(active=False)
    return ActiveResponse(
        active=True,
        profile_id=active["profile_id"],
        profile_name=active["profile_name"],
        original_params=active["original_params"],
    )
