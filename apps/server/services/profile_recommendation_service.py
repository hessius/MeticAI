"""Profile recommendation service — fully local, token-free scoring.

Compares profiles by structural features (stage types, dynamics,
pressure/flow control), target weight, peak pressure, temperature,
and keyword tags.  No AI/LLM calls — everything is deterministic.
"""

import asyncio
import hashlib
import json
import threading
from collections import OrderedDict
from typing import Optional

from logging_config import get_logger
from services.meticulous_service import async_fetch_all_profiles

logger = get_logger()

_MAX_CACHE_SIZE = 50


# ---------------------------------------------------------------------------
# LRU cache (unchanged)
# ---------------------------------------------------------------------------

class _LRUCache:
    """Thread-safe LRU cache with a fixed max size."""

    def __init__(self, maxsize: int = _MAX_CACHE_SIZE):
        self._maxsize = maxsize
        self._cache: OrderedDict[str, list[dict]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[list[dict]]:
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
            return None

    def put(self, key: str, value: list[dict]) -> None:
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = value
            while len(self._cache) > self._maxsize:
                self._cache.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


def _cache_key(tags: list[str], limit: int) -> str:
    raw = json.dumps({"tags": sorted(tags), "limit": limit}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Structural fingerprint extraction
# ---------------------------------------------------------------------------

def _extract_fingerprint(profile: object) -> dict:
    """Extract a structural fingerprint from a full profile.

    Returns a dict with:
      stage_types: list[str]         — e.g. ["pressure", "pressure", "flow"]
      control_mode: str              — "pressure" | "flow" | "mixed"
      has_preinfusion: bool
      has_bloom: bool
      has_pulse: bool
      is_flat: bool                  — single constant pressure/flow
      peak_pressure: float           — max bar across all stages
      stage_count: int
      technique_tags: set[str]       — derived structural tags
      temperature: float | None
      final_weight: float | None
    """
    stages = getattr(profile, "stages", None) or []
    temperature = getattr(profile, "temperature", None)
    final_weight = getattr(profile, "final_weight", None)

    stage_types: list[str] = []
    peak_pressure = 0.0
    has_preinfusion = False
    has_bloom = False
    has_pulse = False
    is_flat = True
    technique_tags: set[str] = set()

    for stage in stages:
        stype = (getattr(stage, "type", "") or "").lower()
        stage_types.append(stype)
        sname = (getattr(stage, "name", "") or "").lower()

        # Preinfusion detection
        if "preinfusion" in sname or "pre-infusion" in sname or "pre infusion" in sname:
            has_preinfusion = True
            technique_tags.add("preinfusion")

        # Bloom detection
        if "bloom" in sname or "soak" in sname:
            has_bloom = True
            technique_tags.add("bloom")

        # Pulse detection (stage name or many short stages)
        if "pulse" in sname:
            has_pulse = True
            technique_tags.add("pulse")

        # Extract peak pressure from dynamics points
        dynamics = getattr(stage, "dynamics", None)
        if dynamics:
            points = getattr(dynamics, "points", []) or []
            for point in points:
                if len(point) >= 2:
                    try:
                        y_val = float(point[1])
                    except (TypeError, ValueError):
                        continue
                    if stype == "pressure" and y_val > peak_pressure:
                        peak_pressure = y_val

            # Check for flatness (all y-values the same in dynamics)
            if len(points) >= 2:
                y_values = []
                for p in points:
                    if len(p) >= 2:
                        try:
                            y_values.append(float(p[1]))
                        except (TypeError, ValueError):
                            pass
                if y_values and len(set(round(y, 1) for y in y_values)) > 1:
                    is_flat = False

        # Extract pressure limits
        limits = getattr(stage, "limits", None) or []
        for limit_obj in limits:
            ltype = (getattr(limit_obj, "type", "") or "").lower()
            lval = getattr(limit_obj, "value", None)
            if ltype == "pressure" and lval is not None:
                try:
                    pval = float(lval)
                    if pval > peak_pressure:
                        peak_pressure = pval
                except (TypeError, ValueError):
                    pass

        # Stage name technique keywords
        for kw in ["lever", "turbo", "ramp", "decline", "taper"]:
            if kw in sname:
                technique_tags.add(kw)

    # Determine control mode
    pressure_count = sum(1 for t in stage_types if t == "pressure")
    flow_count = sum(1 for t in stage_types if t == "flow")
    total = pressure_count + flow_count
    if total == 0:
        control_mode = "unknown"
    elif pressure_count > 0 and flow_count == 0:
        control_mode = "pressure"
        technique_tags.add("pressure-profile")
    elif flow_count > 0 and pressure_count == 0:
        control_mode = "flow"
        technique_tags.add("flow-profile")
    else:
        control_mode = "mixed"
        technique_tags.add("mixed-profile")

    # Pulse heuristic: many short stages (>4 stages often indicates pulse-like)
    if len(stages) >= 5 and not has_pulse:
        has_pulse = True
        technique_tags.add("pulse")

    if has_preinfusion:
        technique_tags.add("preinfusion")
    if has_bloom:
        technique_tags.add("bloom")
    if is_flat and len(stages) <= 2:
        technique_tags.add("flat")

    return {
        "stage_types": stage_types,
        "control_mode": control_mode,
        "has_preinfusion": has_preinfusion,
        "has_bloom": has_bloom,
        "has_pulse": has_pulse,
        "is_flat": is_flat and len(stages) <= 2,
        "peak_pressure": round(peak_pressure, 1),
        "stage_count": len(stages),
        "technique_tags": technique_tags,
        "temperature": temperature,
        "final_weight": final_weight,
    }


# ---------------------------------------------------------------------------
# Keyword tag extraction (from profile name + stage names)
# ---------------------------------------------------------------------------

_NAME_KEYWORDS = frozenset([
    "fruity", "chocolate", "nutty", "floral", "caramel", "berry", "citrus",
    "sweet", "balanced", "creamy", "syrupy", "light", "medium", "dark",
    "modern", "italian", "lever", "turbo", "bloom", "long", "short",
    "pre-infusion", "pulse", "acidity", "funky", "thin", "mouthfeel",
    "ristretto", "lungo", "allonge", "espresso", "filter",
])

_STAGE_KEYWORDS = frozenset([
    "preinfusion", "pre-infusion", "bloom", "ramp", "soak", "infusion",
    "extraction", "decline", "taper", "hold", "pulse", "turbo", "lever",
    "flat", "pressure", "flow",
])


def _extract_name_tags(profile: object) -> set[str]:
    """Extract keyword tags from profile name and stage names."""
    tags: set[str] = set()
    name = (getattr(profile, "name", "") or "").lower()
    for kw in _NAME_KEYWORDS:
        if kw in name:
            tags.add(kw)

    stages = getattr(profile, "stages", None) or []
    for stage in stages:
        sname = (getattr(stage, "name", "") or "").lower()
        for kw in _STAGE_KEYWORDS:
            if kw in sname:
                tags.add(kw)

    return tags


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


# ---------------------------------------------------------------------------
# Proximity helpers
# ---------------------------------------------------------------------------

def _proximity_score(a: float | None, b: float | None,
                     full_range: float, partial_range: float,
                     max_points: float) -> tuple[float, str | None]:
    """Score how close two numeric values are. Returns (score, reason_or_None)."""
    if a is None or b is None:
        return 0.0, None
    diff = abs(a - b)
    if diff <= full_range:
        return max_points, None
    if diff <= partial_range:
        frac = 1 - (diff - full_range) / (partial_range - full_range)
        return round(max_points * frac, 1), None
    return 0.0, None


# ---------------------------------------------------------------------------
# Main scoring function
# ---------------------------------------------------------------------------

def _score_profile(
    user_tags: set[str],
    user_fingerprint: dict | None,
    candidate: object,
) -> tuple[float, list[str], str]:
    """Score a candidate profile. Returns (score, match_reasons, explanation).

    Point allocation (100 max):
      - Stage structure fingerprint: 35
      - Tag/keyword matching:        25
      - Target weight similarity:    15
      - Peak pressure similarity:    15
      - Temperature similarity:      10
    """
    reasons: list[str] = []
    score = 0.0

    cand_fp = _extract_fingerprint(candidate)
    cand_tags = _extract_name_tags(candidate)

    # --- Stage structure (35 points) ---
    if user_fingerprint:
        struct_score = 0.0

        # Control mode match (pressure/flow/mixed) — 12 pts
        if user_fingerprint["control_mode"] == cand_fp["control_mode"]:
            struct_score += 12
            reasons.append(f"{cand_fp['control_mode'].capitalize()}-controlled")
        elif (user_fingerprint["control_mode"] != "unknown"
              and cand_fp["control_mode"] != "unknown"):
            # Partial credit for mixed vs pressure/flow
            if "mixed" in (user_fingerprint["control_mode"], cand_fp["control_mode"]):
                struct_score += 4

        # Technique feature overlap — 15 pts
        user_techniques = user_fingerprint.get("technique_tags", set())
        cand_techniques = cand_fp.get("technique_tags", set())
        if user_techniques or cand_techniques:
            tech_sim = _jaccard(user_techniques, cand_techniques)
            struct_score += tech_sim * 15
            overlap = user_techniques & cand_techniques
            if overlap:
                reasons.append(f"Techniques: {', '.join(sorted(overlap))}")

        # Stage count similarity — 4 pts
        count_diff = abs(user_fingerprint["stage_count"] - cand_fp["stage_count"])
        if count_diff == 0:
            struct_score += 4
        elif count_diff <= 1:
            struct_score += 2
        elif count_diff <= 2:
            struct_score += 1

        # Flat profile match — 4 pts
        if user_fingerprint["is_flat"] == cand_fp["is_flat"]:
            struct_score += 4
            if cand_fp["is_flat"]:
                reasons.append("Flat profile")

        score += min(struct_score, 35)

    # --- Tag matching (25 points) ---
    user_lower = {t.lower() for t in user_tags}
    # Merge structural technique tags into candidate tags for broader matching
    all_cand_tags = cand_tags | cand_fp.get("technique_tags", set())
    if user_lower:
        tag_sim = _jaccard(user_lower, all_cand_tags)
        tag_pts = tag_sim * 25
        score += tag_pts
        overlap = user_lower & all_cand_tags
        if overlap:
            # Filter out already-reported technique tags
            tag_only = overlap - (user_fingerprint or {}).get("technique_tags", set())
            if tag_only:
                reasons.append(f"Matching: {', '.join(sorted(tag_only))}")

    # --- Target weight (15 points) ---
    user_weight = (user_fingerprint or {}).get("final_weight")
    cand_weight = cand_fp.get("final_weight")
    w_pts, _ = _proximity_score(user_weight, cand_weight, 2.0, 10.0, 15)
    score += w_pts
    if w_pts >= 10 and cand_weight is not None:
        reasons.append(f"Target weight: {cand_weight:.0f}g")

    # --- Peak pressure (15 points) ---
    user_peak = (user_fingerprint or {}).get("peak_pressure", 0)
    cand_peak = cand_fp.get("peak_pressure", 0)
    if user_peak > 0 and cand_peak > 0:
        p_pts, _ = _proximity_score(user_peak, cand_peak, 0.5, 3.0, 15)
        score += p_pts
        if p_pts >= 10:
            reasons.append(f"Peak pressure: {cand_peak:.1f} bar")

    # --- Temperature (10 points) ---
    user_temp = (user_fingerprint or {}).get("temperature")
    cand_temp = cand_fp.get("temperature")
    t_pts, _ = _proximity_score(user_temp, cand_temp, 2.0, 5.0, 10)
    score += t_pts
    if t_pts >= 7 and cand_temp is not None:
        reasons.append(f"Temperature: {cand_temp:.1f}°C")

    # Build explanation from reasons
    explanation = "; ".join(reasons) if reasons else ""

    return min(round(score, 1), 100), reasons, explanation


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------

class ProfileRecommendationService:
    """Local-only profile recommendation engine — zero AI tokens."""

    def __init__(self) -> None:
        self._cache = _LRUCache(_MAX_CACHE_SIZE)
        self._async_lock: asyncio.Lock | None = None

    def _get_async_lock(self) -> asyncio.Lock:
        if self._async_lock is None:
            self._async_lock = asyncio.Lock()
        return self._async_lock

    async def get_recommendations(
        self,
        tags: list[str],
        limit: int = 5,
    ) -> list[dict]:
        """Return recommendations as list of {profile_name, score, explanation, match_reasons}."""
        key = _cache_key(tags, limit)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        async with self._get_async_lock():
            cached = self._cache.get(key)
            if cached is not None:
                return cached
            results = await self._compute(tags, limit)
            self._cache.put(key, results)
            return results

    async def _compute(
        self,
        tags: list[str],
        limit: int,
    ) -> list[dict]:
        """Score all profiles and return top results."""
        profiles = await self._fetch_profiles()
        if not profiles:
            return []

        user_tags = set(tags) if tags else set()

        # Build a synthetic "user fingerprint" by averaging the top tag-matching
        # profiles, or just use tags as structural hints
        user_fingerprint = self._build_user_fingerprint(user_tags, profiles)

        scored: list[dict] = []
        for p in profiles:
            s, reasons, explanation = _score_profile(user_tags, user_fingerprint, p)
            scored.append({
                "profile_name": getattr(p, "name", "Unknown"),
                "score": s,
                "explanation": explanation,
                "match_reasons": reasons,
            })

        scored.sort(key=lambda x: x["score"], reverse=True)
        return [s for s in scored if s["score"] > 0][:limit]

    async def find_similar(
        self,
        source_profile_name: str,
        limit: int = 10,
    ) -> list[dict]:
        """Find profiles structurally similar to a given profile."""
        profiles = await self._fetch_profiles()
        if not profiles:
            return []

        # Find source
        source = None
        for p in profiles:
            if getattr(p, "name", "") == source_profile_name:
                source = p
                break
        if source is None:
            return []

        source_fp = _extract_fingerprint(source)
        source_tags = _extract_name_tags(source)

        scored: list[dict] = []
        for p in profiles:
            if getattr(p, "name", "") == source_profile_name:
                continue
            s, reasons, explanation = _score_profile(source_tags, source_fp, p)
            scored.append({
                "profile_name": getattr(p, "name", "Unknown"),
                "score": s,
                "explanation": explanation,
                "match_reasons": reasons,
            })

        scored.sort(key=lambda x: x["score"], reverse=True)
        return [s for s in scored if s["score"] > 0][:limit]

    def invalidate_cache(self) -> None:
        """Called when profiles are created/edited/deleted."""
        self._cache.clear()
        logger.debug("Profile recommendation cache invalidated")

    @staticmethod
    async def _fetch_profiles() -> list:
        """Fetch full profiles (with stages) from the machine."""
        try:
            result = await async_fetch_all_profiles()
            if hasattr(result, "error") and result.error:
                logger.warning(f"Failed to fetch profiles: {result.error}")
                return []
            return list(result)
        except Exception as e:
            logger.warning(f"Failed to fetch profiles for recommendations: {e}")
            return []

    @staticmethod
    def _build_user_fingerprint(user_tags: set[str], profiles: list) -> dict:
        """Build a synthetic fingerprint from user tags.

        Uses structural hints in the tags (e.g. "preinfusion", "bloom", "pulse",
        "pressure", "flow") to create a target fingerprint for comparison.
        """
        technique_tags: set[str] = set()

        # Map user tags to structural features
        tag_to_technique = {
            "preinfusion": "preinfusion", "pre-infusion": "preinfusion",
            "bloom": "bloom", "soak": "bloom",
            "pulse": "pulse",
            "lever": "lever", "turbo": "turbo",
            "ramp": "ramp", "decline": "decline", "taper": "taper",
            "flat": "flat",
            "pressure": "pressure-profile",
            "flow": "flow-profile",
        }

        for tag in user_tags:
            t_lower = tag.lower()
            if t_lower in tag_to_technique:
                technique_tags.add(tag_to_technique[t_lower])

        # Determine control mode from tags
        control_mode = "unknown"
        if "pressure-profile" in technique_tags:
            control_mode = "pressure"
        elif "flow-profile" in technique_tags:
            control_mode = "flow"

        # Estimate stage count based on technique complexity
        stage_count = 2  # baseline
        if "preinfusion" in technique_tags:
            stage_count += 1
        if "bloom" in technique_tags:
            stage_count += 1
        if "pulse" in technique_tags:
            stage_count = max(stage_count, 5)

        return {
            "stage_types": [],
            "control_mode": control_mode,
            "has_preinfusion": "preinfusion" in technique_tags,
            "has_bloom": "bloom" in technique_tags,
            "has_pulse": "pulse" in technique_tags,
            "is_flat": "flat" in technique_tags,
            "peak_pressure": 0,  # unknown from tags
            "stage_count": stage_count,
            "technique_tags": technique_tags,
            "temperature": None,
            "final_weight": None,
        }


# Module-level singleton
recommendation_service = ProfileRecommendationService()
