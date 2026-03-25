"""Dial-In Guide API routes."""

import json
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
from services.gemini_service import get_vision_model, is_ai_available
from prompt_builder import build_dialin_recommendation_prompt

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


# ── AI Recommendations ─────────────────────────────────────────────────────────

@router.post("/dialin/sessions/{session_id}/recommend")
@router.post("/api/dialin/sessions/{session_id}/recommend")
async def generate_recommendations(session_id: str):
    """Generate AI-powered recommendations for the latest iteration.

    Falls back to rule-based recommendations when Gemini is unavailable.
    """
    session = await dialin_service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.iterations:
        raise HTTPException(status_code=400, detail="No iterations to recommend from")

    latest = session.iterations[-1]
    coffee = session.coffee

    # Try AI-powered recommendations
    if is_ai_available():
        try:
            prompt = build_dialin_recommendation_prompt(
                roast_level=coffee.roast_level.value,
                origin=coffee.origin,
                process=coffee.process.value if coffee.process else None,
                roast_date=coffee.roast_date,
                profile_name=session.profile_name,
                iterations=[
                    it.model_dump(mode="json") for it in session.iterations
                ],
            )
            model = get_vision_model()
            response = await model.async_generate_content(prompt)
            text = response.text.strip()

            # Parse JSON from response (handle markdown fences)
            cleaned = text
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[1:])
            if cleaned.endswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[:-1])

            data = json.loads(cleaned)
            recommendations = data.get("recommendations", [])
            if isinstance(recommendations, list) and recommendations:
                # Store on the iteration
                await dialin_service.update_recommendations(
                    session_id=session_id,
                    iteration_number=latest.iteration_number,
                    recommendations=[str(r) for r in recommendations[:6]],
                )
                return {"recommendations": recommendations[:6], "source": "ai"}
        except Exception as exc:
            logger.warning("Gemini dial-in recommendation failed, falling back to rules: %s", exc)

    # Rule-based fallback
    x = latest.taste.x if latest.taste.x is not None else 0.0
    y = latest.taste.y if latest.taste.y is not None else 0.0
    recs: list[str] = []

    if x < -0.2:
        recs.append("Grind finer (2-3 steps)")
        recs.append("Increase temperature by 1-2°C")
    if x > 0.2:
        recs.append("Grind coarser (2-3 steps)")
        recs.append("Decrease temperature by 1-2°C")
    if y < -0.2:
        recs.append("Increase dose by 0.3-0.5g")
    if y > 0.2:
        recs.append("Decrease dose by 0.3-0.5g")
    if not recs:
        recs.append("Looking good! Small tweaks only — try ±0.5°C or ±0.2g dose")

    await dialin_service.update_recommendations(
        session_id=session_id,
        iteration_number=latest.iteration_number,
        recommendations=recs,
    )
    return {"recommendations": recs, "source": "rules"}


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
