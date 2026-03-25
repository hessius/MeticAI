"""Data models for the Dial-In Guide feature."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class RoastLevel(str, Enum):
    """Coffee roast level."""
    LIGHT = "light"
    MEDIUM_LIGHT = "medium-light"
    MEDIUM = "medium"
    MEDIUM_DARK = "medium-dark"
    DARK = "dark"


class CoffeeProcess(str, Enum):
    """Coffee processing method."""
    WASHED = "washed"
    NATURAL = "natural"
    HONEY = "honey"
    ANAEROBIC = "anaerobic"
    OTHER = "other"


class SessionStatus(str, Enum):
    """Dial-in session lifecycle status."""
    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class CoffeeDetails(BaseModel):
    """Describes the coffee being dialled in."""
    roast_level: RoastLevel
    origin: Optional[str] = None
    process: Optional[CoffeeProcess] = None
    roast_date: Optional[str] = None


class TasteFeedback(BaseModel):
    """User taste feedback from the Espresso Compass widget."""
    x: float = Field(..., ge=-1, le=1, description="Sour (-1) to Bitter (1)")
    y: float = Field(..., ge=-1, le=1, description="Weak (-1) to Strong (1)")
    descriptors: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


class DialInIteration(BaseModel):
    """A single shot-taste-adjust iteration within a session."""
    iteration_number: int
    shot_ref: Optional[str] = None
    taste: TasteFeedback
    recommendations: list[str] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DialInSession(BaseModel):
    """A complete dial-in guide session."""
    id: str
    coffee: CoffeeDetails
    profile_name: Optional[str] = None
    iterations: list[DialInIteration] = Field(default_factory=list)
    status: SessionStatus = SessionStatus.ACTIVE
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
