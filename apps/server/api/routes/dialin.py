"""Dial-In Guide API routes."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from models.dialin import (
    CoffeeDetails,
    DialInSession,
    SessionStatus,
    TasteFeedback,
)
from services import dialin_service

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Request body models ────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    coffee: CoffeeDetails
    profile_name: Optional[str] = None


class AddIterationRequest(BaseModel):
    taste: TasteFeedback
    shot_ref: Optional[str] = None


class UpdateRecommendationsRequest(BaseModel):
    recommendations: list[str]


# ── Sessions ───────────────────────────────────────────────────────────────────

@router.post("/dialin/sessions", status_code=201)
@router.post("/api/dialin/sessions", status_code=201)
async def create_session(req: CreateSessionRequest):
    """Create a new dial-in session."""
    try:
        session = await dialin_service.create_session(
            coffee=req.coffee,
            profile_name=req.profile_name,
        )
        return session
    except ValueError as e:
        logger.warning("Failed to create dial-in session: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/dialin/sessions")
@router.get("/api/dialin/sessions")
async def list_sessions(
    status: Optional[SessionStatus] = Query(None),
):
    """List dial-in sessions, optionally filtered by status."""
    sessions = await dialin_service.list_sessions(status=status)
    return {"sessions": sessions}


@router.get("/dialin/sessions/{session_id}")
@router.get("/api/dialin/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a specific dial-in session."""
    session = await dialin_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


# ── Iterations ─────────────────────────────────────────────────────────────────

@router.post("/dialin/sessions/{session_id}/iterations", status_code=201)
@router.post("/api/dialin/sessions/{session_id}/iterations", status_code=201)
async def add_iteration(session_id: str, req: AddIterationRequest):
    """Add a taste-feedback iteration to a session."""
    try:
        iteration = await dialin_service.add_iteration(
            session_id=session_id,
            taste=req.taste,
            shot_ref=req.shot_ref,
        )
        return iteration
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put(
    "/dialin/sessions/{session_id}/iterations/{iteration_number}/recommendations"
)
@router.put(
    "/api/dialin/sessions/{session_id}/iterations/{iteration_number}/recommendations"
)
async def update_recommendations(
    session_id: str,
    iteration_number: int,
    req: UpdateRecommendationsRequest,
):
    """Update AI recommendations for a specific iteration."""
    try:
        iteration = await dialin_service.update_recommendations(
            session_id=session_id,
            iteration_number=iteration_number,
            recommendations=req.recommendations,
        )
        return iteration
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Session lifecycle ──────────────────────────────────────────────────────────

@router.post("/dialin/sessions/{session_id}/complete")
@router.post("/api/dialin/sessions/{session_id}/complete")
async def complete_session(session_id: str):
    """Mark a dial-in session as complete."""
    try:
        session = await dialin_service.complete_session(session_id)
        return session
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/dialin/sessions/{session_id}")
@router.delete("/api/dialin/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a dial-in session."""
    deleted = await dialin_service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}
