"""Tests for profile recommendation service and endpoints."""

import pytest
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from types import SimpleNamespace

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

os.environ.setdefault("METICULOUS_IP", "127.0.0.1")
os.environ.setdefault("TEST_MODE", "true")


from services.profile_recommendation_service import (
    _jaccard,
    _roast_distance,
    _normalise_roast,
    _extract_profile_tags,
    _local_score,
    _LRUCache,
    ProfileRecommendationService,
)


# ---------------------------------------------------------------------------
# Unit tests for helper functions
# ---------------------------------------------------------------------------

class TestJaccard:
    def test_both_empty(self):
        assert _jaccard(set(), set()) == 0.0

    def test_identical_sets(self):
        assert _jaccard({"a", "b"}, {"a", "b"}) == 1.0

    def test_no_overlap(self):
        assert _jaccard({"a"}, {"b"}) == 0.0

    def test_partial_overlap(self):
        assert _jaccard({"a", "b", "c"}, {"b", "c", "d"}) == pytest.approx(0.5)


class TestRoastDistance:
    def test_identical(self):
        assert _roast_distance("light", "light") == 0.0

    def test_none_inputs(self):
        assert _roast_distance(None, "light") == 0.5
        assert _roast_distance("light", None) == 0.5

    def test_max_distance(self):
        assert _roast_distance("light", "dark") == 1.0

    def test_adjacent(self):
        assert _roast_distance("light", "medium-light") == 0.25


class TestNormaliseRoast:
    def test_alias(self):
        assert _normalise_roast("light roast") == "light"
        assert _normalise_roast("Dark Roast") == "dark"

    def test_passthrough(self):
        assert _normalise_roast("medium") == "medium"

    def test_none(self):
        assert _normalise_roast(None) is None


class TestExtractProfileTags:
    def test_keywords_in_name(self):
        profile = SimpleNamespace(name="Fruity Bloom Light")
        tags = _extract_profile_tags(profile)
        assert "fruity" in tags
        assert "bloom" in tags
        assert "light" in tags

    def test_no_match(self):
        profile = SimpleNamespace(name="Standard")
        tags = _extract_profile_tags(profile)
        assert len(tags) == 0

    def test_empty_name(self):
        profile = SimpleNamespace(name="")
        tags = _extract_profile_tags(profile)
        assert len(tags) == 0


class TestLocalScore:
    def test_matching_tags_earn_points(self):
        profile = SimpleNamespace(name="Fruity Chocolate Bloom")
        score, reasons = _local_score({"fruity", "chocolate"}, None, None, profile)
        assert score > 0
        assert any("tag" in r.lower() for r in reasons)

    def test_roast_match_earns_points(self):
        profile = SimpleNamespace(name="Light Roast Special")
        score, reasons = _local_score(set(), "light", None, profile)
        assert score > 0
        assert any("roast" in r.lower() for r in reasons)

    def test_beverage_type_match(self):
        profile = SimpleNamespace(name="Espresso Classic")
        score, reasons = _local_score(set(), None, "espresso", profile)
        assert score > 0
        assert any("beverage" in r.lower() for r in reasons)

    def test_no_match_gives_neutral_score(self):
        profile = SimpleNamespace(name="Standard")
        score, reasons = _local_score(set(), None, None, profile)
        # roast_distance with both None gives 0.5, so roast_score = (1-0.5)*25 = 12.5
        assert score >= 0
        assert len(reasons) == 0

    def test_max_score_capped(self):
        profile = SimpleNamespace(name="Fruity Chocolate Berry Espresso Light Roast")
        score, _ = _local_score(
            {"fruity", "chocolate", "berry"}, "light", "espresso", profile
        )
        assert score <= 100


# ---------------------------------------------------------------------------
# LRU cache tests
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

def _make_profiles(*names):
    return [SimpleNamespace(name=n, id=f"id-{i}", temperature=93, final_weight=36, author=None)
            for i, n in enumerate(names)]


class TestRecommendationService:
    @pytest.fixture
    def service(self):
        return ProfileRecommendationService()

    @pytest.mark.asyncio
    async def test_recommendations_return_format(self, service):
        profiles = _make_profiles("Fruity Bloom", "Chocolate Italian", "Sweet Caramel")
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=False,
        ):
            results = await service.get_recommendations(tags=["fruity", "bloom"], limit=5)

        assert isinstance(results, list)
        for r in results:
            assert "profile_name" in r
            assert "score" in r
            assert "match_reasons" in r
            assert "explanation" in r

    @pytest.mark.asyncio
    async def test_recommendations_filters_zero_score(self, service):
        profiles = _make_profiles("Totally Unrelated")
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=False,
        ):
            results = await service.get_recommendations(tags=["fruity"], limit=5)

        # "Totally Unrelated" has no matching tags/roast/beverage
        for r in results:
            assert r["score"] > 0

    @pytest.mark.asyncio
    async def test_recommendations_empty_catalogue(self, service):
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=[],
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=False,
        ):
            results = await service.get_recommendations(tags=["fruity"], limit=5)

        assert results == []

    @pytest.mark.asyncio
    async def test_find_similar_excludes_source(self, service):
        profiles = _make_profiles("Fruity Bloom", "Fruity Italian", "Chocolate Dark")
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=False,
        ):
            results = await service.find_similar("Fruity Bloom", limit=5)

        assert all(r["profile_name"] != "Fruity Bloom" for r in results)

    @pytest.mark.asyncio
    async def test_find_similar_unknown_profile(self, service):
        profiles = _make_profiles("A", "B")
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=False,
        ):
            results = await service.find_similar("DoesNotExist", limit=5)

        assert results == []

    @pytest.mark.asyncio
    async def test_cache_invalidation(self, service):
        profiles = _make_profiles("Fruity Bloom")
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=False,
        ):
            r1 = await service.get_recommendations(tags=["fruity"], limit=5)

        service.invalidate_cache()

        profiles2 = _make_profiles("Chocolate Dark")
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=profiles2,
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=False,
        ):
            r2 = await service.get_recommendations(tags=["fruity"], limit=5)

        # After invalidation, results should reflect new catalogue
        names1 = {r["profile_name"] for r in r1}
        names2 = {r["profile_name"] for r in r2}
        assert names1 != names2 or (not r1 and not r2)

    @pytest.mark.asyncio
    async def test_llm_ranking_fallback(self, service):
        """When LLM is available but fails, local results should be returned."""
        profiles = _make_profiles("Fruity Bloom", "Chocolate Italian")
        with patch(
            "services.profile_recommendation_service.async_list_profiles",
            new_callable=AsyncMock,
            return_value=profiles,
        ), patch(
            "services.profile_recommendation_service.is_ai_available",
            return_value=True,
        ), patch(
            "services.profile_recommendation_service._llm_rank",
            new_callable=AsyncMock,
            return_value=None,
        ):
            results = await service.get_recommendations(
                tags=["fruity"],
                description="something fruity",
                limit=5,
            )

        assert isinstance(results, list)
        # Should still have results from local scoring
        assert len(results) > 0
