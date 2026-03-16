"""Profile recommendation service with two-tier scoring.

Provides local tag-matching scoring (always available) and optional
LLM-based semantic ranking when Gemini is configured.
"""

import asyncio
import hashlib
import json
import threading
from collections import OrderedDict
from typing import Optional

from logging_config import get_logger
from services.gemini_service import is_ai_available, get_gemini_client, get_model_name
from services.meticulous_service import async_list_profiles, async_get_profile

logger = get_logger()

# 50-entry LRU cap (project convention)
_MAX_CACHE_SIZE = 50


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


def _cache_key(
    tags: list[str],
    roast_level: str | None,
    beverage_type: str | None,
    description: str | None,
    limit: int,
) -> str:
    raw = json.dumps(
        {"tags": sorted(tags), "roast": roast_level, "bev": beverage_type, "desc": description, "limit": limit},
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Local scoring helpers
# ---------------------------------------------------------------------------

_ROAST_LEVELS = ["light", "medium-light", "medium", "medium-dark", "dark"]

_ROAST_ALIASES: dict[str, str] = {
    "light roast": "light",
    "medium roast": "medium",
    "dark roast": "dark",
    "medium-light": "medium-light",
    "medium-dark": "medium-dark",
}


def _normalise_roast(raw: str | None) -> str | None:
    if not raw:
        return None
    return _ROAST_ALIASES.get(raw.strip().lower(), raw.strip().lower())


def _roast_distance(a: str | None, b: str | None) -> float:
    """Return 0.0 (identical) to 1.0 (maximally different) for two roast levels."""
    if a is None or b is None:
        return 0.5  # unknown — neutral
    a_norm, b_norm = _normalise_roast(a), _normalise_roast(b)
    if a_norm == b_norm:
        return 0.0
    if a_norm in _ROAST_LEVELS and b_norm in _ROAST_LEVELS:
        return abs(_ROAST_LEVELS.index(a_norm) - _ROAST_LEVELS.index(b_norm)) / (len(_ROAST_LEVELS) - 1)
    return 0.5


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def _extract_profile_tags(profile: object) -> set[str]:
    """Extract tag-like labels from a profile's name and stage names."""
    tags: set[str] = set()
    name = getattr(profile, "name", "") or ""
    # Some profiles embed tag keywords in the name
    for keyword in [
        "fruity", "chocolate", "nutty", "floral", "caramel", "berry", "citrus",
        "sweet", "balanced", "creamy", "syrupy", "light", "medium", "dark",
        "modern", "italian", "lever", "turbo", "bloom", "long", "short",
        "pre-infusion", "pulse", "acidity", "funky", "thin", "mouthfeel",
    ]:
        if keyword in name.lower():
            tags.add(keyword)

    # Extract keywords from stage names (e.g. "preinfusion", "bloom", "ramp")
    stages = getattr(profile, "stages", None) or []
    stage_keywords = [
        "preinfusion", "pre-infusion", "bloom", "ramp", "soak", "infusion",
        "extraction", "decline", "taper", "hold", "pulse", "turbo", "lever",
        "flat", "pressure", "flow",
    ]
    for stage in stages:
        stage_name = (getattr(stage, "name", "") or "").lower()
        for kw in stage_keywords:
            if kw in stage_name:
                tags.add(kw)

    return tags


def _local_score(
    user_tags: set[str],
    roast_level: str | None,
    beverage_type: str | None,
    profile: object,
) -> tuple[float, list[str]]:
    """Compute a 0-100 local score and list of match reasons."""
    reasons: list[str] = []
    score = 0.0

    # --- tag matching (60 points max) ---
    profile_tags = _extract_profile_tags(profile)
    user_lower = {t.lower() for t in user_tags}
    if user_lower:
        tag_sim = _jaccard(user_lower, profile_tags)
        tag_score = tag_sim * 60
        score += tag_score
        overlap = user_lower & profile_tags
        if overlap:
            reasons.append(f"Matching tags: {', '.join(sorted(overlap))}")

    # --- roast compatibility (25 points max) ---
    profile_name_lower = (getattr(profile, "name", "") or "").lower()
    profile_roast: str | None = None
    for alias, normalised in _ROAST_ALIASES.items():
        if alias in profile_name_lower:
            profile_roast = normalised
            break
    dist = _roast_distance(roast_level, profile_roast)
    roast_score = (1 - dist) * 25
    score += roast_score
    if dist == 0.0 and roast_level:
        reasons.append(f"Roast level match: {roast_level}")
    elif dist < 0.4 and roast_level:
        reasons.append("Similar roast level")

    # --- beverage type (15 points max) ---
    if beverage_type:
        if beverage_type.lower() in profile_name_lower:
            score += 15
            reasons.append(f"Beverage type match: {beverage_type}")

    return min(round(score, 1), 100), reasons


# ---------------------------------------------------------------------------
# LLM scoring
# ---------------------------------------------------------------------------

_LLM_RANKING_PROMPT = """You are a coffee expert. Given a user's espresso preferences and a list of candidate profiles, rank them by relevance.

User preferences:
- Tags: {tags}
- Roast level: {roast_level}
- Beverage type: {beverage_type}
- Description: {description}

Candidate profiles (name → local_score):
{candidates}

Return a JSON array of objects, each with:
- "profile_name": exact name from the candidates
- "score": your relevance score 0-100 (may differ from local_score)
- "explanation": one sentence explaining why this profile matches (or doesn't)

Return ONLY the JSON array, no markdown fences or extra text. Order by score descending."""


async def _llm_rank(
    tags: list[str],
    roast_level: str | None,
    beverage_type: str | None,
    description: str | None,
    candidates: list[dict],
) -> list[dict] | None:
    """Use Gemini to re-rank candidates. Returns None on failure."""
    if not is_ai_available():
        return None

    candidate_text = "\n".join(
        f"- {c['profile_name']} (local_score={c['score']})" for c in candidates
    )

    prompt = _LLM_RANKING_PROMPT.format(
        tags=", ".join(tags) if tags else "none",
        roast_level=roast_level or "unspecified",
        beverage_type=beverage_type or "unspecified",
        description=description or "none",
        candidates=candidate_text,
    )

    try:
        client = get_gemini_client()
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.models.generate_content(model=get_model_name(), contents=prompt),
        )

        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[: text.rfind("```")]
        text = text.strip()

        ranked = json.loads(text)
        if isinstance(ranked, list):
            return ranked
    except Exception as e:
        logger.warning(f"LLM ranking failed, falling back to local scores: {e}")

    return None


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------


class ProfileRecommendationService:
    """Two-tier profile recommendation: local scoring + optional LLM re-ranking."""

    def __init__(self) -> None:
        self._cache = _LRUCache(_MAX_CACHE_SIZE)
        self._async_lock: asyncio.Lock | None = None

    def _get_async_lock(self) -> asyncio.Lock:
        """Lazy-create asyncio.Lock (must be called from running loop)."""
        if self._async_lock is None:
            self._async_lock = asyncio.Lock()
        return self._async_lock

    async def get_recommendations(
        self,
        tags: list[str],
        roast_level: str | None = None,
        beverage_type: str | None = None,
        description: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        """Return recommendations as list of {profile_name, score, explanation, match_reasons}."""

        key = _cache_key(tags, roast_level, beverage_type, description, limit)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        async with self._get_async_lock():
            # Double-check after acquiring lock
            cached = self._cache.get(key)
            if cached is not None:
                return cached

            results = await self._compute(tags, roast_level, beverage_type, description, limit)
            self._cache.put(key, results)
            return results

    async def _compute(
        self,
        tags: list[str],
        roast_level: str | None,
        beverage_type: str | None,
        description: str | None,
        limit: int,
    ) -> list[dict]:
        """Run local scoring, optionally LLM re-ranking, and return top results."""

        # Fetch all profiles from machine
        try:
            profiles_result = await async_list_profiles()
            if hasattr(profiles_result, "error") and profiles_result.error:
                logger.warning(f"Failed to list profiles: {profiles_result.error}")
                return []
            profiles = list(profiles_result)
        except Exception as e:
            logger.warning(f"Failed to fetch profiles for recommendations: {e}")
            return []

        if not profiles:
            return []

        user_tags = set(tags) if tags else set()

        # Local scoring
        scored: list[dict] = []
        for p in profiles:
            score, reasons = _local_score(user_tags, roast_level, beverage_type, p)
            scored.append({
                "profile_name": getattr(p, "name", "Unknown"),
                "score": score,
                "explanation": "",
                "match_reasons": reasons,
            })

        scored.sort(key=lambda x: x["score"], reverse=True)

        # Take top N for LLM re-ranking (send more than limit for better ranking)
        top_n = scored[: max(limit * 2, 10)]

        # Attempt LLM re-ranking
        if description or (tags and is_ai_available()):
            llm_results = await _llm_rank(tags, roast_level, beverage_type, description, top_n)
            if llm_results:
                # Merge LLM results with local match_reasons
                reasons_map = {s["profile_name"]: s["match_reasons"] for s in scored}
                merged: list[dict] = []
                for lr in llm_results:
                    name = lr.get("profile_name", "")
                    merged.append({
                        "profile_name": name,
                        "score": lr.get("score", 0),
                        "explanation": lr.get("explanation", ""),
                        "match_reasons": reasons_map.get(name, []),
                    })
                return merged[:limit]

        # Local-only fallback — filter out zero-score entries
        return [s for s in scored if s["score"] > 0][:limit]

    def invalidate_cache(self) -> None:
        """Called when profiles are created/edited/deleted."""
        self._cache.clear()
        logger.debug("Profile recommendation cache invalidated")

    async def find_similar(
        self,
        source_profile_name: str,
        limit: int = 10,
    ) -> list[dict]:
        """Find profiles similar to a given profile by name.

        Looks up the source profile, extracts its tags/attributes, and returns
        recommendations excluding the source itself.
        """
        try:
            profiles_result = await async_list_profiles()
            if hasattr(profiles_result, "error") and profiles_result.error:
                return []
            profiles = list(profiles_result)
        except Exception:
            return []

        # Find the source profile
        source = None
        for p in profiles:
            if getattr(p, "name", "") == source_profile_name:
                source = p
                break

        if source is None:
            return []

        # Extract tags from the source profile
        source_tags = _extract_profile_tags(source)
        # Infer roast level from the profile name
        source_name = (getattr(source, "name", "") or "").lower()
        source_roast: str | None = None
        for alias, normalised in _ROAST_ALIASES.items():
            if alias in source_name:
                source_roast = normalised
                break

        # Score all other profiles against the source
        scored: list[dict] = []
        for p in profiles:
            if getattr(p, "name", "") == source_profile_name:
                continue
            score, reasons = _local_score(source_tags, source_roast, None, p)
            scored.append({
                "profile_name": getattr(p, "name", "Unknown"),
                "score": score,
                "explanation": "",
                "match_reasons": reasons,
            })

        scored.sort(key=lambda x: x["score"], reverse=True)

        # LLM re-ranking if available
        if is_ai_available() and scored:
            top_n = scored[: max(limit * 2, 10)]
            llm_results = await _llm_rank(
                list(source_tags),
                source_roast,
                None,
                f"Find profiles similar to '{source_profile_name}'",
                top_n,
            )
            if llm_results:
                reasons_map = {s["profile_name"]: s["match_reasons"] for s in scored}
                merged: list[dict] = []
                for lr in llm_results:
                    name = lr.get("profile_name", "")
                    if name == source_profile_name:
                        continue
                    merged.append({
                        "profile_name": name,
                        "score": lr.get("score", 0),
                        "explanation": lr.get("explanation", ""),
                        "match_reasons": reasons_map.get(name, []),
                    })
                return merged[:limit]

        return [s for s in scored if s["score"] > 0][:limit]


# Module-level singleton
recommendation_service = ProfileRecommendationService()
