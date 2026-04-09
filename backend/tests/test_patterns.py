"""Tests for the contextual pattern memory engine."""

import pytest
from datetime import date


def test_build_state():
    from app.engines.patterns import build_state

    metrics = {
        "total_cost": 1200.0,
        "brand_cost": 400.0,
        "total_clicks": 800,
    }
    context = {
        "day_of_week": 2,
        "month": 7,
        "season": "summer",
        "temperature_c": 26.0,
        "is_promo": False,
    }
    state = build_state(date(2025, 7, 15), metrics, context)

    assert state["day_of_week"] == 1  # date(2025,7,15) is Tuesday=1
    assert state["month"] == 7
    assert state["season"] == "summer"
    assert state["temperature_band"] == "warm"
    assert state["is_promo"] is False
    assert 0 <= state["brand_spend_pct"] <= 100


def test_calculate_similarity_identical():
    from app.engines.patterns import calculate_similarity

    state = {
        "day_of_week": 2,
        "month": 7,
        "season": "summer",
        "temperature_band": "warm",
        "spend_band": "medium",
        "is_promo": False,
        "brand_spend_pct": 33.0,
        "traffic_band": "medium",
    }
    assert calculate_similarity(state, state) == pytest.approx(1.0, abs=0.01)


def test_calculate_similarity_different():
    from app.engines.patterns import calculate_similarity

    state_a = {
        "day_of_week": 0,
        "month": 1,
        "season": "winter",
        "temperature_band": "cold",
        "spend_band": "low",
        "is_promo": False,
        "brand_spend_pct": 20.0,
        "traffic_band": "low",
    }
    state_b = {
        "day_of_week": 5,
        "month": 7,
        "season": "summer",
        "temperature_band": "hot",
        "spend_band": "high",
        "is_promo": True,
        "brand_spend_pct": 80.0,
        "traffic_band": "high",
    }
    similarity = calculate_similarity(state_a, state_b)
    assert 0 <= similarity <= 1
    assert similarity < 0.3  # Very different states


def test_calculate_similarity_partial_match():
    from app.engines.patterns import calculate_similarity

    state_a = {
        "day_of_week": 2,
        "month": 7,
        "season": "summer",
        "temperature_band": "warm",
        "spend_band": "medium",
        "is_promo": False,
        "brand_spend_pct": 35.0,
        "traffic_band": "medium",
    }
    state_b = {
        "day_of_week": 2,
        "month": 7,
        "season": "summer",
        "temperature_band": "hot",
        "spend_band": "high",
        "is_promo": False,
        "brand_spend_pct": 40.0,
        "traffic_band": "high",
    }
    similarity = calculate_similarity(state_a, state_b)
    assert similarity > 0.4  # Partially similar
    assert similarity < 0.9  # Not identical


def test_custom_weights():
    from app.engines.patterns import calculate_similarity

    state_a = {
        "day_of_week": 2,
        "month": 7,
        "season": "summer",
        "temperature_band": "warm",
        "spend_band": "medium",
        "is_promo": False,
        "brand_spend_pct": 30.0,
        "traffic_band": "medium",
    }
    state_b = {
        "day_of_week": 2,
        "month": 1,
        "season": "winter",
        "temperature_band": "cold",
        "spend_band": "medium",
        "is_promo": False,
        "brand_spend_pct": 30.0,
        "traffic_band": "medium",
    }
    # With high weight on month/season, these should be more different
    weights_season = {"month": 0.5, "season": 0.3}
    weights_day = {"day_of_week": 0.8}

    sim_season = calculate_similarity(state_a, state_b, weights_season)
    sim_day = calculate_similarity(state_a, state_b, weights_day)

    # When weighting day_of_week heavily (which matches), should be more similar
    assert sim_day > sim_season


def test_summarize_outcomes():
    from app.engines.patterns import summarize_similar_outcomes

    states = [
        {
            "similarity": 0.9,
            "outcomes": {
                "revenue": 5000,
                "cvr": 0.04,
                "new_customers": 25,
                "marginal_return": 2.5,
            },
        },
        {
            "similarity": 0.85,
            "outcomes": {
                "revenue": 5500,
                "cvr": 0.045,
                "new_customers": 28,
                "marginal_return": 2.3,
            },
        },
        {
            "similarity": 0.8,
            "outcomes": {
                "revenue": 4800,
                "cvr": 0.038,
                "new_customers": 22,
                "marginal_return": 2.7,
            },
        },
    ]
    summary = summarize_similar_outcomes(states)

    assert "avg_revenue" in summary
    assert "avg_cvr" in summary
    assert "avg_new_customers" in summary
    assert "consistency_score" in summary
    assert "pattern_strength" in summary
    assert summary["avg_revenue"] > 0
    assert 0 <= summary["consistency_score"] <= 1
