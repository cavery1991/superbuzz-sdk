"""Tests for the correlation vs causation engine."""

import pytest
import numpy as np


def test_analyze_correlation_positive():
    from app.engines.causation import analyze_correlation

    np.random.seed(42)
    x = np.arange(100, dtype=float)
    y = x * 2 + np.random.normal(0, 5, 100)

    result = analyze_correlation(x, y, "spend", "revenue")
    assert result["pearson_r"] > 0.9
    assert result["spearman_r"] > 0.9
    assert result["direction"] == "positive"


def test_analyze_correlation_negative():
    from app.engines.causation import analyze_correlation

    np.random.seed(42)
    x = np.arange(100, dtype=float)
    y = -x * 1.5 + np.random.normal(0, 5, 100)

    result = analyze_correlation(x, y, "brand_spend", "organic_traffic")
    assert result["pearson_r"] < -0.9
    assert result["direction"] == "negative"


def test_analyze_correlation_no_relationship():
    from app.engines.causation import analyze_correlation

    np.random.seed(42)
    x = np.random.normal(100, 20, 100)
    y = np.random.normal(50, 10, 100)

    result = analyze_correlation(x, y, "weather", "spend")
    assert abs(result["pearson_r"]) < 0.3


def test_check_saturation():
    from app.engines.causation import check_saturation

    # Create data with clear diminishing returns (log curve)
    np.random.seed(42)
    x = np.linspace(10, 1000, 100)
    y = 200 * np.log(x) + np.random.normal(0, 20, 100)

    result = check_saturation(x, y)
    assert "saturation_point" in result
    assert "r_squared" in result
    assert result["r_squared"] > 0.9  # Good log fit = diminishing returns


def test_check_saturation_linear():
    from app.engines.causation import check_saturation

    np.random.seed(42)
    x = np.linspace(10, 100, 50)
    y = 3 * x + np.random.normal(0, 2, 50)

    result = check_saturation(x, y)
    assert "saturation_point" in result
    # Linear data may still produce a log fit, but r_squared may be lower
    # or the saturation score will differ


def test_causality_confidence_levels():
    """Verify causality confidence scoring produces valid levels."""
    valid_levels = {"high", "medium", "low"}

    from app.engines.causation import _compute_causality_confidence

    # Strong evidence
    assert _compute_causality_confidence(0.9, 0.8, 0.9, 0.7, 0.2) in valid_levels

    # Weak evidence
    assert _compute_causality_confidence(0.3, 0.2, 0.3, 0.5, 0.8) in valid_levels

    # Mixed evidence
    assert _compute_causality_confidence(0.8, 0.3, 0.7, 0.5, 0.4) in valid_levels

    # High confidence scenario
    assert _compute_causality_confidence(0.9, 0.8, 0.9, 0.7, 0.2) == "high"

    # Low confidence scenario
    assert _compute_causality_confidence(0.1, 0.1, 0.1, 0.1, 0.9) == "low"
