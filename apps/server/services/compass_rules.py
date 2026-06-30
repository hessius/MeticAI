"""Deterministic Espresso-Compass taste -> dial-in adjustment rules (D6).

X axis: -1 sour ... +1 bitter.   Y axis: -1 weak/thin ... +1 strong/heavy.
Mirrors apps/web/src/lib/compassRules.ts and the domain knowledge in
prompt_builder.build_taste_context. Pure function — no I/O.
"""

from __future__ import annotations

DEADBAND = 0.25  # within this radius of center, taste is considered balanced


def compass_adjustments(taste_x: float, taste_y: float) -> list[dict]:
    """Return ordered, concrete adjustment suggestions for the given taste vector."""
    adjustments: list[dict] = []

    # X axis — acidity/bitterness balance, primarily extraction yield.
    if taste_x <= -DEADBAND:  # too sour -> under-extracted -> extract more
        adjustments.append({"kind": "grind_finer", "axis": "x",
                            "reason": "Sour/acidic indicates under-extraction; grind finer to raise yield."})
        adjustments.append({"kind": "temp_up", "axis": "x",
                            "reason": "A few degrees hotter increases extraction of sweet/bitter compounds."})
    elif taste_x >= DEADBAND:  # too bitter -> over-extracted -> extract less
        adjustments.append({"kind": "grind_coarser", "axis": "x",
                            "reason": "Bitter/harsh indicates over-extraction; grind coarser to lower yield."})
        adjustments.append({"kind": "temp_down", "axis": "x",
                            "reason": "A few degrees cooler reduces harsh bitter extraction."})

    # Y axis — strength/body, primarily ratio/dose.
    if taste_y <= -DEADBAND:  # too weak/thin -> increase concentration
        adjustments.append({"kind": "ratio_up", "axis": "y",
                            "reason": "Weak/thin body; lower the brew ratio (less water per dose) for more concentration."})
        adjustments.append({"kind": "dose_up", "axis": "y",
                            "reason": "A larger dose increases strength and body."})
    elif taste_y >= DEADBAND:  # too strong/heavy -> dilute
        adjustments.append({"kind": "ratio_down", "axis": "y",
                            "reason": "Strong/heavy; raise the brew ratio (more water per dose) to lighten."})

    return adjustments
