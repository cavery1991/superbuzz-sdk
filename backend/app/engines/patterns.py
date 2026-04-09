"""
Contextual pattern memory and state-based decision engine.

Defines "states" as multi-dimensional snapshots of a given day (day of week,
season, temperature band, spend band, etc.), then uses weighted similarity
matching to find historical analogues and derive actionable insights.
"""

import logging
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.campaign import (
    Campaign,
    DailyMetrics,
    ContextualData,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_WEIGHTS = {
    "day_of_week": 0.15,
    "month": 0.20,
    "season": 0.15,
    "temperature_band": 0.10,
    "spend_band": 0.15,
    "is_promo": 0.10,
    "brand_spend_pct": 0.10,
    "traffic_band": 0.05,
}

SEASONS = {"winter", "spring", "summer", "autumn"}
TEMPERATURE_BANDS = {"cold", "mild", "warm", "hot"}
SPEND_BANDS = {"low", "medium", "high", "very_high"}
TRAFFIC_BANDS = {"low", "medium", "high"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_season(month: int) -> str:
    """Determine season from month number (Northern Hemisphere)."""
    if month in (12, 1, 2):
        return "winter"
    elif month in (3, 4, 5):
        return "spring"
    elif month in (6, 7, 8):
        return "summer"
    else:
        return "autumn"


def _get_temperature_band(temp_c: Optional[float]) -> str:
    """Categorize temperature into bands."""
    if temp_c is None:
        return "mild"  # Neutral default
    if temp_c < 10:
        return "cold"
    elif temp_c < 20:
        return "mild"
    elif temp_c <= 28:
        return "warm"
    else:
        return "hot"


def _get_spend_band(spend: float, quartiles: dict) -> str:
    """
    Assign a spend band based on precomputed quartiles.

    quartiles: {"q25": float, "q50": float, "q75": float}
    """
    if spend <= quartiles.get("q25", 0):
        return "low"
    elif spend <= quartiles.get("q50", 0):
        return "medium"
    elif spend <= quartiles.get("q75", 0):
        return "high"
    else:
        return "very_high"


def _get_traffic_band(clicks: int, tertiles: dict) -> str:
    """
    Assign a traffic band based on precomputed tertiles.

    tertiles: {"t33": float, "t66": float}
    """
    if clicks <= tertiles.get("t33", 0):
        return "low"
    elif clicks <= tertiles.get("t66", 0):
        return "medium"
    else:
        return "high"


def _compute_distribution_breakpoints(db: Session) -> dict:
    """
    Compute spend quartiles and traffic tertiles from all historical data.
    """
    daily_agg = (
        db.query(
            DailyMetrics.date,
            func.sum(DailyMetrics.cost).label("total_cost"),
            func.sum(DailyMetrics.clicks).label("total_clicks"),
        )
        .group_by(DailyMetrics.date)
        .all()
    )

    if not daily_agg:
        return {
            "spend_quartiles": {"q25": 0, "q50": 0, "q75": 0},
            "traffic_tertiles": {"t33": 0, "t66": 0},
        }

    costs = np.array([float(r.total_cost or 0) for r in daily_agg])
    clicks = np.array([float(r.total_clicks or 0) for r in daily_agg])

    return {
        "spend_quartiles": {
            "q25": float(np.percentile(costs, 25)) if len(costs) > 0 else 0,
            "q50": float(np.percentile(costs, 50)) if len(costs) > 0 else 0,
            "q75": float(np.percentile(costs, 75)) if len(costs) > 0 else 0,
        },
        "traffic_tertiles": {
            "t33": float(np.percentile(clicks, 33)) if len(clicks) > 0 else 0,
            "t66": float(np.percentile(clicks, 66)) if len(clicks) > 0 else 0,
        },
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_state(
    target_date: date,
    metrics: dict,
    context: dict,
    breakpoints: Optional[dict] = None,
) -> dict:
    """
    Build a state dict from a date's metrics and contextual data.

    Args:
        target_date: The date for this state.
        metrics: Dictionary containing at minimum:
            - total_cost (float): Total daily spend.
            - total_clicks (int): Total daily clicks.
            - brand_cost (float): Brand campaign spend.
        context: Dictionary containing at minimum:
            - temperature_c (float or None): Temperature in Celsius.
            - is_promo (bool): Whether a promo was active.
        breakpoints: Optional precomputed distribution breakpoints
            containing spend_quartiles and traffic_tertiles.

    Returns:
        State dictionary with keys: day_of_week, month, season,
        temperature_band, spend_band, is_promo, brand_spend_pct,
        traffic_band, date.
    """
    month = target_date.month
    total_cost = float(metrics.get("total_cost", 0) or 0)
    total_clicks = int(metrics.get("total_clicks", 0) or 0)
    brand_cost = float(metrics.get("brand_cost", 0) or 0)
    temperature = context.get("temperature_c")
    is_promo = bool(context.get("is_promo", False))

    # Default breakpoints if not provided
    if breakpoints is None:
        breakpoints = {
            "spend_quartiles": {"q25": 100, "q50": 500, "q75": 1500},
            "traffic_tertiles": {"t33": 100, "t66": 500},
        }

    brand_spend_pct = (brand_cost / total_cost * 100) if total_cost > 0 else 0.0

    return {
        "day_of_week": target_date.weekday(),  # 0=Monday, 6=Sunday
        "month": month,
        "season": _get_season(month),
        "temperature_band": _get_temperature_band(temperature),
        "spend_band": _get_spend_band(total_cost, breakpoints["spend_quartiles"]),
        "is_promo": is_promo,
        "brand_spend_pct": round(brand_spend_pct, 2),
        "traffic_band": _get_traffic_band(total_clicks, breakpoints["traffic_tertiles"]),
        "date": target_date.isoformat(),
    }


def calculate_similarity(
    state_a: dict,
    state_b: dict,
    weights: Optional[dict] = None,
) -> float:
    """
    Compute a weighted similarity score (0-1) between two states.

    Uses appropriate distance metrics for each dimension:
    - Categorical (exact match): day_of_week, season, temperature_band,
      spend_band, traffic_band, is_promo
    - Cyclic (day_of_week, month): circular distance
    - Numeric (brand_spend_pct): normalized absolute distance

    Args:
        state_a: First state dict.
        state_b: Second state dict.
        weights: Optional weight overrides per dimension.

    Returns:
        Similarity score between 0.0 (completely different) and 1.0 (identical).
    """
    w = weights if weights is not None else DEFAULT_WEIGHTS.copy()

    total_weight = sum(w.values())
    if total_weight == 0:
        return 0.0

    score = 0.0

    # Day of week: cyclic distance (0-6, wrap around)
    dow_a = state_a.get("day_of_week", 0)
    dow_b = state_b.get("day_of_week", 0)
    dow_dist = min(abs(dow_a - dow_b), 7 - abs(dow_a - dow_b))
    dow_sim = 1.0 - (dow_dist / 3.5)  # max distance = 3.5
    score += max(0.0, dow_sim) * w.get("day_of_week", 0)

    # Month: cyclic distance (1-12, wrap around)
    m_a = state_a.get("month", 1)
    m_b = state_b.get("month", 1)
    month_dist = min(abs(m_a - m_b), 12 - abs(m_a - m_b))
    month_sim = 1.0 - (month_dist / 6.0)  # max distance = 6
    score += max(0.0, month_sim) * w.get("month", 0)

    # Season: exact match
    season_sim = 1.0 if state_a.get("season") == state_b.get("season") else 0.0
    score += season_sim * w.get("season", 0)

    # Temperature band: ordinal distance
    temp_order = {"cold": 0, "mild": 1, "warm": 2, "hot": 3}
    t_a = temp_order.get(state_a.get("temperature_band", "mild"), 1)
    t_b = temp_order.get(state_b.get("temperature_band", "mild"), 1)
    temp_sim = 1.0 - (abs(t_a - t_b) / 3.0)
    score += temp_sim * w.get("temperature_band", 0)

    # Spend band: ordinal distance
    spend_order = {"low": 0, "medium": 1, "high": 2, "very_high": 3}
    s_a = spend_order.get(state_a.get("spend_band", "medium"), 1)
    s_b = spend_order.get(state_b.get("spend_band", "medium"), 1)
    spend_sim = 1.0 - (abs(s_a - s_b) / 3.0)
    score += spend_sim * w.get("spend_band", 0)

    # Is promo: exact match
    promo_sim = 1.0 if state_a.get("is_promo") == state_b.get("is_promo") else 0.0
    score += promo_sim * w.get("is_promo", 0)

    # Brand spend pct: normalized distance (0-100 range)
    bsp_a = float(state_a.get("brand_spend_pct", 0))
    bsp_b = float(state_b.get("brand_spend_pct", 0))
    bsp_sim = 1.0 - (abs(bsp_a - bsp_b) / 100.0)
    score += max(0.0, bsp_sim) * w.get("brand_spend_pct", 0)

    # Traffic band: ordinal distance
    traffic_order = {"low": 0, "medium": 1, "high": 2}
    tr_a = traffic_order.get(state_a.get("traffic_band", "medium"), 1)
    tr_b = traffic_order.get(state_b.get("traffic_band", "medium"), 1)
    traffic_sim = 1.0 - (abs(tr_a - tr_b) / 2.0)
    score += traffic_sim * w.get("traffic_band", 0)

    # Normalize by total weight
    normalized = score / total_weight
    return round(max(0.0, min(1.0, normalized)), 4)


def find_similar_states(
    db: Session,
    current_state: dict,
    top_n: int = 10,
    min_similarity: float = 0.5,
) -> list[dict]:
    """
    Search all historical days, return the most similar states with their
    observed outcomes.

    Args:
        db: SQLAlchemy session.
        current_state: The current state to find analogues for.
        top_n: Maximum number of results.
        min_similarity: Minimum similarity threshold.

    Returns:
        List of dicts, each containing: state, similarity, outcomes
        (revenue, cvr, new_customers, marginal_return).
    """
    breakpoints = _compute_distribution_breakpoints(db)

    # Fetch all historical daily data aggregated
    daily_rows = (
        db.query(
            DailyMetrics.date,
            Campaign.campaign_type,
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.clicks).label("clicks"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
            func.sum(DailyMetrics.orders).label("orders"),
        )
        .join(Campaign, DailyMetrics.campaign_id == Campaign.id)
        .group_by(DailyMetrics.date, Campaign.campaign_type)
        .all()
    )

    if not daily_rows:
        return []

    # Pivot into per-date records
    date_data: dict[date, dict] = {}
    for row in daily_rows:
        d = row.date
        if d not in date_data:
            date_data[d] = {
                "total_cost": 0.0,
                "total_clicks": 0,
                "total_revenue": 0.0,
                "total_conversions": 0.0,
                "total_new_customers": 0,
                "total_orders": 0,
                "brand_cost": 0.0,
            }
        rec = date_data[d]
        cost_val = float(row.cost or 0)
        rec["total_cost"] += cost_val
        rec["total_clicks"] += int(row.clicks or 0)
        rec["total_revenue"] += float(row.revenue or 0)
        rec["total_conversions"] += float(row.conversions or 0)
        rec["total_new_customers"] += int(row.new_customers or 0)
        rec["total_orders"] += int(row.orders or 0)
        if row.campaign_type == "brand":
            rec["brand_cost"] += cost_val

    # Fetch contextual data
    ctx_rows = db.query(ContextualData).all()
    ctx_by_date = {}
    for c in ctx_rows:
        ctx_by_date[c.date] = {
            "temperature_c": c.temperature_c,
            "is_promo": c.is_promo,
        }

    # Exclude the current state's date from candidates
    current_date_str = current_state.get("date")
    results = []

    for d, metrics in date_data.items():
        if current_date_str and d.isoformat() == current_date_str:
            continue

        context = ctx_by_date.get(d, {"temperature_c": None, "is_promo": False})

        historical_state = build_state(d, metrics, context, breakpoints)
        sim = calculate_similarity(current_state, historical_state)

        if sim >= min_similarity:
            # Compute outcomes
            total_clicks = metrics["total_clicks"]
            total_conversions = metrics["total_conversions"]
            total_cost = metrics["total_cost"]
            total_revenue = metrics["total_revenue"]

            cvr = total_conversions / total_clicks if total_clicks > 0 else 0.0
            marginal_return = (total_revenue / total_cost) if total_cost > 0 else 0.0

            results.append({
                "state": historical_state,
                "similarity": sim,
                "outcomes": {
                    "date": d.isoformat(),
                    "revenue": round(total_revenue, 2),
                    "cvr": round(cvr, 4),
                    "new_customers": metrics["total_new_customers"],
                    "marginal_return": round(marginal_return, 4),
                    "total_cost": round(total_cost, 2),
                    "total_orders": metrics["total_orders"],
                },
            })

    # Sort by similarity descending
    results.sort(key=lambda x: x["similarity"], reverse=True)

    return results[:top_n]


def summarize_similar_outcomes(similar_states: list[dict]) -> dict:
    """
    Summarize the outcomes of similar historical states.

    Args:
        similar_states: List of results from find_similar_states().

    Returns:
        Dictionary with avg_revenue, avg_cvr, avg_new_customers,
        avg_marginal_return, variance, consistency_score, pattern_strength,
        decision_summary.
    """
    if not similar_states:
        return {
            "avg_revenue": 0.0,
            "avg_cvr": 0.0,
            "avg_new_customers": 0.0,
            "avg_marginal_return": 0.0,
            "variance": 0.0,
            "consistency_score": 0.0,
            "pattern_strength": "none",
            "decision_summary": "No similar historical states found. Insufficient data for pattern-based recommendations.",
        }

    revenues = np.array([s["outcomes"]["revenue"] for s in similar_states])
    cvrs = np.array([s["outcomes"]["cvr"] for s in similar_states])
    new_custs = np.array([s["outcomes"]["new_customers"] for s in similar_states])
    marginal_returns = np.array([s["outcomes"]["marginal_return"] for s in similar_states])
    similarities = np.array([s["similarity"] for s in similar_states])

    # Weighted averages (weight by similarity)
    total_sim = similarities.sum()
    if total_sim > 0:
        avg_revenue = float(np.average(revenues, weights=similarities))
        avg_cvr = float(np.average(cvrs, weights=similarities))
        avg_new_customers = float(np.average(new_custs, weights=similarities))
        avg_marginal_return = float(np.average(marginal_returns, weights=similarities))
    else:
        avg_revenue = float(np.mean(revenues))
        avg_cvr = float(np.mean(cvrs))
        avg_new_customers = float(np.mean(new_custs))
        avg_marginal_return = float(np.mean(marginal_returns))

    # Variance in revenue outcomes (coefficient of variation)
    revenue_std = float(np.std(revenues)) if len(revenues) > 1 else 0.0
    revenue_mean = float(np.mean(revenues))
    cv = revenue_std / revenue_mean if revenue_mean > 0 else 0.0

    # Consistency score: how consistent are the outcomes across similar states?
    # Low CV = high consistency
    if cv < 0.1:
        consistency_score = 1.0
    elif cv < 0.25:
        consistency_score = 0.8
    elif cv < 0.5:
        consistency_score = 0.5
    elif cv < 1.0:
        consistency_score = 0.3
    else:
        consistency_score = 0.1

    # Pattern strength based on number of matches and their similarity
    n = len(similar_states)
    avg_similarity = float(np.mean(similarities))

    if n >= 10 and avg_similarity >= 0.7:
        pattern_strength = "strong"
    elif n >= 5 and avg_similarity >= 0.6:
        pattern_strength = "moderate"
    elif n >= 3 and avg_similarity >= 0.5:
        pattern_strength = "weak"
    else:
        pattern_strength = "very_weak"

    # Decision summary
    summaries = []
    summaries.append(
        f"Based on {n} similar historical days (avg similarity: {avg_similarity:.0%})"
    )
    summaries.append(
        f"expected revenue is ${avg_revenue:,.0f} "
        f"(std: ${revenue_std:,.0f}, CV: {cv:.1%})"
    )

    if avg_marginal_return > 2.0:
        summaries.append(
            "Marginal returns are strong -- there may be room to increase spend."
        )
    elif avg_marginal_return > 1.0:
        summaries.append(
            "Marginal returns are positive but moderate -- maintain current spend levels."
        )
    else:
        summaries.append(
            "Marginal returns are low or negative -- consider reducing spend or reallocating."
        )

    decision_summary = ". ".join(summaries) + "."

    return {
        "avg_revenue": round(avg_revenue, 2),
        "avg_cvr": round(avg_cvr, 4),
        "avg_new_customers": round(avg_new_customers, 2),
        "avg_marginal_return": round(avg_marginal_return, 4),
        "variance": round(float(revenue_std ** 2), 2),
        "consistency_score": round(consistency_score, 4),
        "pattern_strength": pattern_strength,
        "decision_summary": decision_summary,
        "n_matches": n,
        "avg_similarity": round(avg_similarity, 4),
        "coefficient_of_variation": round(cv, 4),
    }


def generate_pattern_insights(
    db: Session,
    current_state: dict,
) -> list[str]:
    """
    Generate 3-5 human-readable insights from historical pattern matching.

    Args:
        db: SQLAlchemy session.
        current_state: The current state to find analogues for.

    Returns:
        List of 3-5 insight strings.
    """
    similar = find_similar_states(db, current_state, top_n=20, min_similarity=0.4)

    if not similar:
        return [
            "No similar historical states found. This may be a novel combination of conditions.",
            "Consider collecting more data before relying on pattern-based recommendations.",
            "Monitor performance closely as historical benchmarks are unavailable.",
        ]

    summary = summarize_similar_outcomes(similar)
    insights = []

    # 1. Revenue expectation
    insights.append(
        f"In {summary['n_matches']} similar historical conditions, "
        f"average daily revenue was ${summary['avg_revenue']:,.0f} "
        f"with {summary['consistency_score']:.0%} consistency."
    )

    # 2. Marginal return insight
    if summary["avg_marginal_return"] > 2.0:
        insights.append(
            f"Historical marginal return in similar conditions was "
            f"{summary['avg_marginal_return']:.1f}x, suggesting room to increase spend profitably."
        )
    elif summary["avg_marginal_return"] > 1.0:
        insights.append(
            f"Historical marginal return was {summary['avg_marginal_return']:.1f}x. "
            f"Current spend level appears near-optimal for these conditions."
        )
    else:
        threshold_states = [
            s for s in similar if s["outcomes"]["marginal_return"] > 1.0
        ]
        if threshold_states:
            safe_spend = np.mean([
                s["outcomes"]["total_cost"] for s in threshold_states
            ])
            insights.append(
                f"In similar conditions, increasing spend beyond ~${safe_spend:,.0f}/day "
                f"historically reduced marginal returns below break-even."
            )
        else:
            insights.append(
                "Historical marginal returns in similar conditions were below break-even. "
                "Consider reducing spend or reallocating budget."
            )

    # 3. Conversion rate pattern
    high_cvr_states = [s for s in similar if s["outcomes"]["cvr"] > summary["avg_cvr"]]
    if high_cvr_states:
        high_cvr_avg_cost = np.mean([
            s["outcomes"]["total_cost"] for s in high_cvr_states
        ])
        insights.append(
            f"Days with above-average conversion rates ({len(high_cvr_states)} of "
            f"{len(similar)}) had average spend of ${high_cvr_avg_cost:,.0f}."
        )

    # 4. Promo effect (if applicable)
    promo_states = [s for s in similar if s["state"].get("is_promo")]
    non_promo_states = [s for s in similar if not s["state"].get("is_promo")]
    if promo_states and non_promo_states:
        promo_rev = np.mean([s["outcomes"]["revenue"] for s in promo_states])
        non_promo_rev = np.mean([s["outcomes"]["revenue"] for s in non_promo_states])
        if promo_rev > non_promo_rev:
            lift = (promo_rev - non_promo_rev) / non_promo_rev * 100 if non_promo_rev > 0 else 0
            insights.append(
                f"Promotions in similar conditions lifted revenue by ~{lift:.0f}% "
                f"(${promo_rev:,.0f} vs ${non_promo_rev:,.0f})."
            )
        else:
            insights.append(
                "Promotions in similar conditions did not significantly lift revenue. "
                "Consider whether promo spend is justified."
            )

    # 5. Day-of-week or seasonal pattern
    if current_state.get("season"):
        same_season = [
            s for s in similar if s["state"].get("season") == current_state["season"]
        ]
        if same_season and len(same_season) >= 3:
            season_rev = np.mean([s["outcomes"]["revenue"] for s in same_season])
            insights.append(
                f"In the same season ({current_state['season']}), "
                f"similar states averaged ${season_rev:,.0f} in revenue "
                f"across {len(same_season)} historical days."
            )

    # Ensure we have at least 3 insights
    while len(insights) < 3:
        insights.append(
            f"Pattern strength: {summary['pattern_strength']}. "
            f"{'Recommendations have high confidence.' if summary['pattern_strength'] in ('strong', 'moderate') else 'Collect more data for higher confidence.'}"
        )

    return insights[:5]
