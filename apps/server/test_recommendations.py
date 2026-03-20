"""Tests for profile recommendation service — structural scoring."""

import pytest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

os.environ.setdefault("METICULOUS_IP", "127.0.0.1")
os.environ.setdefault("TEST_MODE", "true")


from services.profile_recommendation_service import (
    _jaccard,
    _extract_fingerprint,
    _extract_name_tags,
    _score_profile,
    _proximity_score,
    _LRUCache,
    ProfileRecommendationService,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_stage(name: str, stype: str, points: list, over: str = "time",
                interpolation: str = "linear", exit_triggers: list | None = None,
                limits: list | None = None):
    """Create a mock Stage object."""
    dynamics = SimpleNamespace(points=points, over=over, interpolation=interpolation)
    return SimpleNamespace(
        name=name,
        key=f"{stype}_0",
        type=stype,
        dynamics=dynamics,
        exit_triggers=exit_triggers or [],
        limits=limits or [],
    )


def _make_profile(name: str, stages: list | None = None,
                  temperature: float = 93.0, final_weight: float = 36.0,
                  variables: list | None = None):
    """Create a mock Profile object."""
    return SimpleNamespace(
        name=name,
        id=f"id-{name}",
        author="test",
        author_id="test-id",
        temperature=temperature,
        final_weight=final_weight,
        stages=stages or [],
        variables=variables or [],
    )


# A realistic pressure-controlled espresso profile
PRESSURE_PROFILE = _make_profile(
    "Classic Italian Espresso",
    stages=[
        _make_stage("Preinfusion", "pressure", [[0, 2.0], [5, 4.0]]),
        _make_stage("Ramp", "pressure", [[0, 4.0], [3, 9.0]]),
        _make_stage("Extraction", "pressure", [[0, 9.0], [25, 8.5]]),
    ],
    temperature=93.0,
    final_weight=36.0,
)

# A flow-controlled profile with bloom
FLOW_PROFILE = _make_profile(
    "Modern Flow Bloom",
    stages=[
        _make_stage("Preinfusion", "flow", [[0, 2.0], [5, 2.0]]),
        _make_stage("Bloom", "flow", [[0, 0.5], [10, 0.5]]),
        _make_stage("Main Extraction", "flow", [[0, 2.5], [20, 2.0]]),
    ],
    temperature=90.0,
    final_weight=40.0,
)

# A simple flat pressure profile
FLAT_PROFILE = _make_profile(
    "Simple 6 Bar",
    stages=[
        _make_stage("Flat Pressure", "pressure", [[0, 6.0], [30, 6.0]]),
    ],
    temperature=93.0,
    final_weight=36.0,
)

# A turbo shot (high flow, low weight)
TURBO_PROFILE = _make_profile(
    "Turbo Shot",
    stages=[
        _make_stage("Turbo", "flow", [[0, 5.0], [8, 5.0]]),
    ],
    temperature=96.0,
    final_weight=20.0,
)

# A lever-style with declining pressure
LEVER_PROFILE = _make_profile(
    "Lever Decline",
    stages=[
        _make_stage("Preinfusion", "pressure", [[0, 2.0], [5, 4.0]]),
        _make_stage("Peak", "pressure", [[0, 9.0], [2, 9.0]]),
        _make_stage("Decline", "pressure", [[0, 9.0], [20, 3.0]]),
    ],
    temperature=92.0,
    final_weight=38.0,
)


# ---------------------------------------------------------------------------
# Jaccard tests
# ---------------------------------------------------------------------------

class TestJaccard:
    def test_both_empty(self):
        assert _jaccard(set(), set()) == 0.0

    def test_identical(self):
        assert _jaccard({"a", "b"}, {"a", "b"}) == 1.0

    def test_no_overlap(self):
        assert _jaccard({"a"}, {"b"}) == 0.0

    def test_partial_overlap(self):
        assert _jaccard({"a", "b", "c"}, {"b", "c", "d"}) == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# Proximity score tests
# ---------------------------------------------------------------------------

class TestProximityScore:
    def test_identical_values(self):
        score, _ = _proximity_score(36.0, 36.0, 2.0, 10.0, 15)
        assert score == 15

    def test_within_full_range(self):
        score, _ = _proximity_score(36.0, 37.5, 2.0, 10.0, 15)
        assert score == 15

    def test_partial_range(self):
        score, _ = _proximity_score(36.0, 42.0, 2.0, 10.0, 15)
        assert 0 < score < 15

    def test_out_of_range(self):
        score, _ = _proximity_score(36.0, 50.0, 2.0, 10.0, 15)
        assert score == 0.0

    def test_none_values(self):
        score, _ = _proximity_score(None, 36.0, 2.0, 10.0, 15)
        assert score == 0.0


# ---------------------------------------------------------------------------
# Fingerprint extraction tests
# ---------------------------------------------------------------------------

class TestExtractFingerprint:
    def test_pressure_profile(self):
        fp = _extract_fingerprint(PRESSURE_PROFILE)
        assert fp["control_mode"] == "pressure"
        assert fp["has_preinfusion"] is True
        assert fp["stage_count"] == 3
        assert fp["peak_pressure"] > 0
        assert "pressure-profile" in fp["technique_tags"]
        assert "preinfusion" in fp["technique_tags"]

    def test_flow_profile_with_bloom(self):
        fp = _extract_fingerprint(FLOW_PROFILE)
        assert fp["control_mode"] == "flow"
        assert fp["has_bloom"] is True
        assert fp["has_preinfusion"] is True
        assert "flow-profile" in fp["technique_tags"]
        assert "bloom" in fp["technique_tags"]

    def test_flat_profile(self):
        fp = _extract_fingerprint(FLAT_PROFILE)
        assert fp["is_flat"] is True
        assert fp["stage_count"] == 1
        assert "flat" in fp["technique_tags"]

    def test_turbo_profile(self):
        fp = _extract_fingerprint(TURBO_PROFILE)
        assert fp["control_mode"] == "flow"
        assert fp["temperature"] == 96.0
        assert fp["final_weight"] == 20.0

    def test_lever_with_decline(self):
        fp = _extract_fingerprint(LEVER_PROFILE)
        assert fp["has_preinfusion"] is True
        assert "decline" in fp["technique_tags"]
        assert fp["peak_pressure"] >= 9.0

    def test_empty_stages(self):
        profile = _make_profile("Empty", stages=[])
        fp = _extract_fingerprint(profile)
        assert fp["stage_count"] == 0
        assert fp["control_mode"] == "unknown"
        assert fp["peak_pressure"] == 0

    def test_pulse_detection_many_stages(self):
        stages = [_make_stage(f"Step {i}", "pressure", [[0, 3], [1, 6]]) for i in range(6)]
        profile = _make_profile("Pulse Profile", stages=stages)
        fp = _extract_fingerprint(profile)
        assert fp["has_pulse"] is True
        assert "pulse" in fp["technique_tags"]


# ---------------------------------------------------------------------------
# Tag extraction tests
# ---------------------------------------------------------------------------

class TestExtractNameTags:
    def test_keywords_in_name(self):
        profile = _make_profile("Fruity Bloom Light", stages=[])
        tags = _extract_name_tags(profile)
        assert "fruity" in tags
        assert "bloom" in tags
        assert "light" in tags

    def test_stage_keywords(self):
        stages = [_make_stage("Preinfusion", "pressure", [[0, 3], [5, 6]])]
        profile = _make_profile("Test", stages=stages)
        tags = _extract_name_tags(profile)
        assert "preinfusion" in tags

    def test_no_match(self):
        profile = _make_profile("Standard", stages=[])
        tags = _extract_name_tags(profile)
        assert len(tags) == 0


# ---------------------------------------------------------------------------
# Scoring tests
# ---------------------------------------------------------------------------

class TestScoreProfile:
    def test_similar_pressure_profiles_score_high(self):
        source_fp = _extract_fingerprint(PRESSURE_PROFILE)
        source_tags = _extract_name_tags(PRESSURE_PROFILE)
        score, reasons, explanation = _score_profile(source_tags, source_fp, LEVER_PROFILE)
        # Both pressure-controlled with preinfusion
        assert score > 30

    def test_different_control_modes_score_lower(self):
        source_fp = _extract_fingerprint(PRESSURE_PROFILE)
        source_tags = _extract_name_tags(PRESSURE_PROFILE)
        score_pressure, _, _ = _score_profile(source_tags, source_fp, LEVER_PROFILE)
        score_flow, _, _ = _score_profile(source_tags, source_fp, TURBO_PROFILE)
        assert score_pressure > score_flow

    def test_weight_similarity_matters(self):
        # Two profiles with similar weight should score higher
        p_close = _make_profile("Test A", stages=[], temperature=93, final_weight=37)
        p_far = _make_profile("Test B", stages=[], temperature=93, final_weight=60)
        source_fp = {"final_weight": 36, "peak_pressure": 0, "temperature": 93,
                     "control_mode": "unknown", "stage_count": 0, "is_flat": False,
                     "technique_tags": set(), "has_preinfusion": False,
                     "has_bloom": False, "has_pulse": False}
        score_close, _, _ = _score_profile(set(), source_fp, p_close)
        score_far, _, _ = _score_profile(set(), source_fp, p_far)
        assert score_close > score_far

    def test_temperature_similarity(self):
        p_close = _make_profile("Test A", stages=[], temperature=93, final_weight=36)
        p_far = _make_profile("Test B", stages=[], temperature=80, final_weight=36)
        source_fp = {"final_weight": 36, "peak_pressure": 0, "temperature": 93,
                     "control_mode": "unknown", "stage_count": 0, "is_flat": False,
                     "technique_tags": set(), "has_preinfusion": False,
                     "has_bloom": False, "has_pulse": False}
        score_close, _, _ = _score_profile(set(), source_fp, p_close)
        score_far, _, _ = _score_profile(set(), source_fp, p_far)
        assert score_close > score_far

    def test_score_capped_at_100(self):
        # Even with maximum overlap, score should not exceed 100
        source_fp = _extract_fingerprint(PRESSURE_PROFILE)
        source_tags = _extract_name_tags(PRESSURE_PROFILE)
        score, _, _ = _score_profile(source_tags, source_fp, PRESSURE_PROFILE)
        assert score <= 100

    def test_explanation_is_string(self):
        source_fp = _extract_fingerprint(PRESSURE_PROFILE)
        source_tags = _extract_name_tags(PRESSURE_PROFILE)
        _, _, explanation = _score_profile(source_tags, source_fp, LEVER_PROFILE)
        assert isinstance(explanation, str)


# ---------------------------------------------------------------------------
# LRU Cache tests
# ---------------------------------------------------------------------------

class TestLRUCache:
    def test_get_set(self):
        cache = _LRUCache(3)
        cache.put("a", [{"x": 1}])
        assert cache.get("a") == [{"x": 1}]

    def test_eviction(self):
        cache = _LRUCache(2)
        cache.put("a", [])
        cache.put("b", [])
        cache.put("c", [])
        assert cache.get("a") is None
        assert cache.get("b") is not None

    def test_clear(self):
        cache = _LRUCache(5)
        cache.put("a", [])
        cache.clear()
        assert cache.get("a") is None


# ---------------------------------------------------------------------------
# Service integration tests
# ---------------------------------------------------------------------------

class TestRecommendationService:
    @pytest.fixture
    def service(self):
        return ProfileRecommendationService()

    @pytest.mark.asyncio
    async def test_recommendations_return_format(self, service):
        profiles = [PRESSURE_PROFILE, FLOW_PROFILE, FLAT_PROFILE]
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ):
            results = await service.get_recommendations(tags=["preinfusion", "bloom"], limit=5)

        assert isinstance(results, list)
        for r in results:
            assert "profile_name" in r
            assert "score" in r
            assert "match_reasons" in r
            assert "explanation" in r

    @pytest.mark.asyncio
    async def test_recommendations_filters_zero_score(self, service):
        profiles = [_make_profile("Totally Unrelated", stages=[])]
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ):
            results = await service.get_recommendations(tags=["fruity"], limit=5)

        for r in results:
            assert r["score"] > 0

    @pytest.mark.asyncio
    async def test_recommendations_empty_catalogue(self, service):
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=[],
        ):
            results = await service.get_recommendations(tags=["fruity"], limit=5)

        assert results == []

    @pytest.mark.asyncio
    async def test_find_similar_excludes_source(self, service):
        profiles = [PRESSURE_PROFILE, FLOW_PROFILE, LEVER_PROFILE]
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ):
            results = await service.find_similar("Classic Italian Espresso", limit=5)

        assert all(r["profile_name"] != "Classic Italian Espresso" for r in results)

    @pytest.mark.asyncio
    async def test_find_similar_unknown_profile(self, service):
        profiles = [PRESSURE_PROFILE, FLOW_PROFILE]
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ):
            results = await service.find_similar("DoesNotExist", limit=5)

        assert results == []

    @pytest.mark.asyncio
    async def test_cache_invalidation(self, service):
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=[PRESSURE_PROFILE],
        ):
            r1 = await service.get_recommendations(tags=["preinfusion"], limit=5)

        service.invalidate_cache()

        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=[FLOW_PROFILE],
        ):
            r2 = await service.get_recommendations(tags=["preinfusion"], limit=5)

        names1 = {r["profile_name"] for r in r1}
        names2 = {r["profile_name"] for r in r2}
        assert names1 != names2 or (not r1 and not r2)

    @pytest.mark.asyncio
    async def test_structural_ranking_pressure(self, service):
        """Pressure-controlled profiles should rank higher when searching for pressure-like tags."""
        profiles = [PRESSURE_PROFILE, FLOW_PROFILE, FLAT_PROFILE, TURBO_PROFILE, LEVER_PROFILE]
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ):
            results = await service.get_recommendations(tags=["preinfusion", "pressure"], limit=5)

        if results:
            # First result should be a pressure-controlled profile
            top_names = [r["profile_name"] for r in results[:2]]
            assert any("Italian" in n or "Lever" in n or "Simple" in n for n in top_names)

    @pytest.mark.asyncio
    async def test_find_similar_structural(self, service):
        """Find similar to a pressure profile should rank other pressure profiles higher."""
        profiles = [PRESSURE_PROFILE, FLOW_PROFILE, LEVER_PROFILE, TURBO_PROFILE]
        with patch(
            "services.profile_recommendation_service.async_fetch_all_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ):
            results = await service.find_similar("Classic Italian Espresso", limit=5)

        if results:
            # Lever should rank higher than flow/turbo for a pressure profile
            lever_score = next((r["score"] for r in results if "Lever" in r["profile_name"]), 0)
            turbo_score = next((r["score"] for r in results if "Turbo" in r["profile_name"]), 0)
            assert lever_score > turbo_score
