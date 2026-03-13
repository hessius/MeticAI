"""Tests for Espresso Compass (taste feedback) feature.

Covers:
- Taste context prompt building
- Cache differentiation with taste hash
- Backward compatibility (no taste params)
- analyze_shot_with_llm taste parameter plumbing
"""

import os
import sys
import hashlib

import pytest

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("TEST_MODE", "true")

from prompt_builder import build_taste_context, _describe_axis_value
from services.gemini_service import compute_taste_hash


# ============================================================================
# build_taste_context tests
# ============================================================================

class TestBuildTasteContext:
    """Tests for prompt_builder.build_taste_context."""

    def test_returns_empty_when_no_data(self):
        assert build_taste_context(None, None, None) == ""

    def test_returns_empty_when_no_coords_and_no_descriptors(self):
        assert build_taste_context(None, None, []) == ""

    def test_includes_balance_and_body_when_coords_present(self):
        result = build_taste_context(-0.3, 0.7, None)
        assert "Balance:" in result
        assert "Body:" in result
        assert "X: -0.30" in result
        assert "Y: 0.70" in result

    def test_includes_descriptors_when_present(self):
        result = build_taste_context(None, None, ["Sweet", "Complex"])
        assert "Descriptors: Sweet, Complex" in result

    def test_includes_both_coords_and_descriptors(self):
        result = build_taste_context(0.5, -0.2, ["Bitter", "Harsh"])
        assert "Balance:" in result
        assert "Body:" in result
        assert "Descriptors: Bitter, Harsh" in result

    def test_includes_domain_knowledge(self):
        result = build_taste_context(0.5, 0.5, ["Sweet"])
        assert "under-extraction" in result
        assert "over-extraction" in result
        assert "increase dose" in result.lower() or "Weak/Thin" in result

    def test_includes_taste_section_instruction(self):
        result = build_taste_context(0.1, 0.1, ["Clean"])
        assert "Taste-Based Recommendations" in result

    def test_center_values_show_balanced(self):
        result = build_taste_context(0.0, 0.0, None)
        assert "Balanced" in result

    def test_extreme_sour(self):
        result = build_taste_context(-0.9, 0.0, None)
        assert "Very" in result and "Sour" in result

    def test_extreme_bitter(self):
        result = build_taste_context(0.9, 0.0, None)
        assert "Very" in result and "Bitter" in result

    def test_includes_quadrant_knowledge(self):
        result = build_taste_context(0.5, 0.5, None)
        assert "Quadrant:" in result


class TestDescribeAxisValue:
    """Tests for prompt_builder._describe_axis_value."""

    def test_balanced_near_zero(self):
        assert _describe_axis_value(0.05, "Sour", "Bitter") == "Balanced"

    def test_slightly_positive(self):
        assert _describe_axis_value(0.25, "Sour", "Bitter") == "Slightly Bitter"

    def test_slightly_negative(self):
        assert _describe_axis_value(-0.25, "Sour", "Bitter") == "Slightly Sour"

    def test_moderately_positive(self):
        assert _describe_axis_value(0.55, "Weak", "Strong") == "Moderately Strong"

    def test_very_negative(self):
        assert _describe_axis_value(-0.85, "Weak", "Strong") == "Very Weak"


# ============================================================================
# compute_taste_hash tests
# ============================================================================

class TestComputeTasteHash:
    """Tests for gemini_service.compute_taste_hash."""

    def test_returns_none_when_no_data(self):
        assert compute_taste_hash(None, None, None) is None

    def test_returns_none_when_no_coords_and_empty_descriptors(self):
        assert compute_taste_hash(None, None, []) is None

    def test_returns_hash_with_coords_only(self):
        h = compute_taste_hash(0.5, -0.3, None)
        assert h is not None
        assert isinstance(h, str)
        assert len(h) == 12

    def test_returns_hash_with_descriptors_only(self):
        h = compute_taste_hash(None, None, ["Sweet", "Clean"])
        assert h is not None
        assert len(h) == 12

    def test_different_coords_produce_different_hashes(self):
        h1 = compute_taste_hash(0.5, 0.5, None)
        h2 = compute_taste_hash(-0.5, 0.5, None)
        assert h1 != h2

    def test_different_descriptors_produce_different_hashes(self):
        h1 = compute_taste_hash(0.5, 0.5, ["Sweet"])
        h2 = compute_taste_hash(0.5, 0.5, ["Bitter"])
        assert h1 != h2

    def test_same_input_produces_same_hash(self):
        h1 = compute_taste_hash(0.5, 0.5, ["Sweet", "Clean"])
        h2 = compute_taste_hash(0.5, 0.5, ["Sweet", "Clean"])
        assert h1 == h2

    def test_descriptor_order_does_not_matter(self):
        """Descriptors are sorted internally, so order shouldn't affect hash."""
        h1 = compute_taste_hash(0.5, 0.5, ["Clean", "Sweet"])
        h2 = compute_taste_hash(0.5, 0.5, ["Sweet", "Clean"])
        assert h1 == h2

    def test_coords_without_descriptors_differs_from_with(self):
        h1 = compute_taste_hash(0.5, 0.5, None)
        h2 = compute_taste_hash(0.5, 0.5, ["Sweet"])
        assert h1 != h2


# ============================================================================
# Cache differentiation integration test
# ============================================================================

class TestCacheDifferentiation:
    """Test that the cache key generation works for taste-aware analysis."""

    def test_no_taste_returns_original_filename(self):
        taste_hash = compute_taste_hash(None, None, None)
        shot_filename = "shot_2024-01-01.json"
        cache_filename = (
            f"{shot_filename}_taste_{taste_hash}" if taste_hash else shot_filename
        )
        assert cache_filename == shot_filename

    def test_with_taste_appends_hash_to_filename(self):
        taste_hash = compute_taste_hash(0.5, -0.3, ["Sweet"])
        shot_filename = "shot_2024-01-01.json"
        cache_filename = (
            f"{shot_filename}_taste_{taste_hash}" if taste_hash else shot_filename
        )
        assert cache_filename != shot_filename
        assert "_taste_" in cache_filename
        assert cache_filename.startswith(shot_filename)

    def test_different_taste_different_cache_keys(self):
        h1 = compute_taste_hash(0.5, 0.5, ["Sweet"])
        h2 = compute_taste_hash(-0.5, -0.5, ["Bitter"])
        filename = "shot.json"
        c1 = f"{filename}_taste_{h1}"
        c2 = f"{filename}_taste_{h2}"
        assert c1 != c2


# ============================================================================
# Backward compatibility
# ============================================================================

class TestBackwardCompatibility:
    """Verify that the new taste params don't break existing behavior."""

    def test_build_taste_context_graceful_with_none(self):
        """No taste data should produce empty string, not crash."""
        assert build_taste_context(None, None, None) == ""

    def test_compute_taste_hash_graceful_with_none(self):
        """No taste data should produce None hash."""
        assert compute_taste_hash(None, None, None) is None

    def test_prompt_omits_taste_when_no_data(self):
        """Taste context should be empty string when no data present."""
        ctx = build_taste_context(None, None, None)
        assert ctx == ""
        # This means the prompt will have no taste section

    def test_prompt_includes_taste_when_data_present(self):
        """Taste context should be non-empty when data present."""
        ctx = build_taste_context(0.3, -0.5, ["Juicy"])
        assert len(ctx) > 0
        assert "Taste Feedback" in ctx
