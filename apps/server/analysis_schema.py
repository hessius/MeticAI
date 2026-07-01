"""Single source of truth for the shot-analysis section structure (L2).

Mirror of apps/web/src/lib/analysisSchema.ts — keep section titles identical.
"""

from __future__ import annotations

REQUIRED_ANALYSIS_SECTIONS = [
    "Shot Performance",
    "Root Cause Analysis",
    "Setup Recommendations",
    "Profile Recommendations",
    "Profile Design Observations",
]

OPTIONAL_TASTE_SECTION = "Taste-Based Recommendations"
