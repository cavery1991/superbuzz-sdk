"""
Scenario simulator engine.

Enables what-if analysis by combining spend-response curves from the
incrementality engine with historical pattern matching to project the
impact of spend changes, promotions, and other contextual overrides.
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
from app.engines.incrementality import proxy_incrementality
from app.engines.patterns import (
    build_state,
    find_similar_states,
    summarize_similar_outcomes,
    calculate_similarity,
    _compute_distribution_breakpoints,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_baseline_metrics(db: Session, days: int = 7) -> dict:
    """
    Get baseline metrics averaged over the most recent N days.

    Returns a dict with per-day averages for key metrics.
    """
    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=days - 1)

    # Total metrics
    total_row = (
        db.query(
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.clicks).label("clicks"),
            func.sum(DailyMetrics.impressions).label("impressions"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
            func.sum(DailyMetrics.returning_customers).label("returning_customers"),
            func.sum(DailyMetrics.orders).label("orders"),
            func.sum(DailyMetrics.gross_margin).label("gross_margin"),
        )
        .join(Campaign, DailyMetrics.campaign_id == Campaign.id)
        .filter(DailyMetrics.date >= start_date, DailyMetrics.date <= end_date)
        .first()
    )

    # Brand metrics
    brand_row = (
        db.query(
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
        )
        .join(Campaign, DailyMetrics.campaign_id == Campaign.id)
        .filter(
            DailyMetrics.date >= start_date,
            DailyMetrics.date <= end_date,
            Campaign.campaign_type == "brand",
        )
        .first()
    )

    # Nonbrand metrics
    nonbrand_row = (
        db.query(
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
        )
        .join(Campaign, DailyMetrics.campaign_id == Campaign.id)
        .filter(
            DailyMetrics.date >= start_date,
            DailyMetrics.date <= end_date,
            Campaign.campaign_type == "nonbrand",
        )
        .first()
    )

    def _safe_float(val):
        return float(val) if val is not None else 0.0

    def _safe_int(val):
        return int(val) if val is not None else 0

    total_cost = _safe_float(total_row.cost) if total_row else 0.0
    total_revenue = _safe_float(total_row.revenue) if total_row else 0.0
    total_conversions = _safe_float(total_row.conversions) if total_row else 0.0
    total_clicks = _safe_int(total_row.clicks) if total_row else 0
    total_new = _safe_int(total_row.new_customers) if total_row else 0
    total_returning = _safe_int(total_row.returning_customers) if total_row else 0
    total_orders = _safe_int(total_row.orders) if total_row else 0
    total_margin = _safe_float(total_row.gross_margin) if total_row else 0.0

    brand_cost = _safe_float(brand_row.cost) if brand_row else 0.0
    brand_revenue = _safe_float(brand_row.revenue) if brand_row else 0.0
    nonbrand_cost = _safe_float(nonbrand_row.cost) if nonbrand_row else 0.0
    nonbrand_revenue = _safe_float(nonbrand_row.revenue) if nonbrand_row else 0.0

    # Per-day averages
    d = max(days, 1)
    return {
        "period_days": days,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "avg_daily_total_spend": round(total_cost / d, 2),
        "avg_daily_total_revenue": round(total_revenue / d, 2),
        "avg_daily_brand_spend": round(brand_cost / d, 2),
        "avg_daily_brand_revenue": round(brand_revenue / d, 2),
        "avg_daily_nonbrand_spend": round(nonbrand_cost / d, 2),
        "avg_daily_nonbrand_revenue": round(nonbrand_revenue / d, 2),
        "avg_daily_new_customers": round(total_new / d, 2),
        "avg_daily_conversions": round(total_conversions / d, 2),
        "avg_daily_clicks": round(total_clicks / d, 2),
        "avg_daily_orders": round(total_orders / d, 2),
        "avg_daily_gross_margin": round(total_margin / d, 2),
        "total_spend": round(total_cost, 2),
        "total_revenue": round(total_revenue, 2),
        "roas": round(total_revenue / total_cost, 4) if total_cost > 0 else 0.0,
        "mer": round(total_revenue / total_cost, 4) if total_cost > 0 else 0.0,
        "brand_spend_pct": round(brand_cost / total_cost * 100, 2) if total_cost > 0 else 0.0,
    }


def _apply_log_response(
    current_spend: float,
    new_spend: float,
    curve_params: dict,
) -> float:
    """
    Use log response curve to estimate revenue at a new spend level.

    Model: revenue = a * ln(spend) + b
    """
    a = curve_params.get("a", 0)
    b = curve_params.get("b", 0)

    if a == 0 and b == 0:
        # No curve available; use linear scaling as fallback
        return 0.0

    current_revenue = a * np.log(max(current_spend, 1e-10)) + b
    new_revenue = a * np.log(max(new_spend, 1e-10)) + b

    return float(new_revenue - current_revenue)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def simulate_scenario(
    db: Session,
    brand_spend_change_pct: float,
    nonbrand_spend_change_pct: float,
    is_promo: bool = False,
    context_overrides: Optional[dict] = None,
) -> dict:
    """
    Simulate a what-if scenario by adjusting spend levels and context.

    Combines three approaches:
    1. Spend-response curves from the incrementality engine
    2. Historical pattern matching for similar states
    3. Baseline extrapolation with adjustments

    Args:
        db: SQLAlchemy session.
        brand_spend_change_pct: Percentage change to brand spend (e.g., -20 for 20% reduction).
        nonbrand_spend_change_pct: Percentage change to nonbrand spend.
        is_promo: Whether to simulate a promo period.
        context_overrides: Optional dict to override state parameters
            (e.g., {"temperature_band": "hot", "season": "summer"}).

    Returns:
        Dictionary with baseline, projected, confidence, historical_analogues,
        warnings, and assumptions.
    """
    warnings = []
    assumptions = []

    # --- Step 1: Get current baseline metrics ---
    baseline = _get_baseline_metrics(db)

    if baseline["avg_daily_total_spend"] == 0:
        return {
            "baseline": baseline,
            "projected": {
                "revenue_change_pct": 0.0,
                "revenue_range": {"low": 0.0, "mid": 0.0, "high": 0.0},
                "new_customers_change_pct": 0.0,
                "projected_roas": 0.0,
                "projected_mer": 0.0,
            },
            "confidence": "low",
            "historical_analogues": [],
            "warnings": ["No baseline spend data available. Cannot simulate."],
            "assumptions": [],
        }

    # Calculate new spend levels
    new_brand_spend = baseline["avg_daily_brand_spend"] * (1 + brand_spend_change_pct / 100)
    new_nonbrand_spend = baseline["avg_daily_nonbrand_spend"] * (1 + nonbrand_spend_change_pct / 100)
    new_total_spend = new_brand_spend + new_nonbrand_spend

    # Ensure non-negative
    new_brand_spend = max(0, new_brand_spend)
    new_nonbrand_spend = max(0, new_nonbrand_spend)
    new_total_spend = new_brand_spend + new_nonbrand_spend

    if new_total_spend == 0:
        warnings.append("Simulated total spend is $0. Revenue projection is zero.")
        return {
            "baseline": baseline,
            "projected": {
                "revenue_change_pct": -100.0,
                "revenue_range": {"low": 0.0, "mid": 0.0, "high": 0.0},
                "new_customers_change_pct": -100.0,
                "projected_roas": 0.0,
                "projected_mer": 0.0,
            },
            "confidence": "low",
            "historical_analogues": [],
            "warnings": warnings,
            "assumptions": ["Zero spend produces zero paid revenue."],
        }

    assumptions.append(
        f"Brand spend: ${baseline['avg_daily_brand_spend']:,.0f}/day -> "
        f"${new_brand_spend:,.0f}/day ({brand_spend_change_pct:+.1f}%)"
    )
    assumptions.append(
        f"Nonbrand spend: ${baseline['avg_daily_nonbrand_spend']:,.0f}/day -> "
        f"${new_nonbrand_spend:,.0f}/day ({nonbrand_spend_change_pct:+.1f}%)"
    )

    # --- Step 2: Apply spend-response curves ---
    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=59)  # 60-day window for curve fitting

    try:
        proxy = proxy_incrementality(db, start_date, end_date)
        curve_params = proxy.get("spend_response_curve_params", {"a": 0, "b": 0})
    except Exception as e:
        logger.warning("Proxy incrementality failed in simulator: %s", str(e))
        curve_params = {"a": 0, "b": 0}
        proxy = {"marginal_roas": 0, "diminishing_returns_threshold": 0}
        warnings.append("Spend-response curve not available; using simplified model.")

    # Revenue change from curve
    curve_revenue_delta = _apply_log_response(
        baseline["avg_daily_total_spend"],
        new_total_spend,
        curve_params,
    )

    curve_available = curve_params.get("a", 0) != 0

    if curve_available:
        assumptions.append(
            f"Spend-response curve: revenue = {curve_params['a']:.2f} * ln(spend) + {curve_params['b']:.2f}"
        )
    else:
        assumptions.append(
            "No spend-response curve available; projections rely on historical analogues and linear estimates."
        )

    # --- Step 3: Find similar historical states ---
    breakpoints = _compute_distribution_breakpoints(db)

    # Build a hypothetical state for the scenario
    ctx = (
        db.query(ContextualData)
        .filter(ContextualData.date <= end_date)
        .order_by(ContextualData.date.desc())
        .first()
    )

    scenario_metrics = {
        "total_cost": new_total_spend,
        "total_clicks": int(baseline["avg_daily_clicks"]),  # Assume clicks scale with spend later
        "brand_cost": new_brand_spend,
    }

    scenario_context = {
        "temperature_c": ctx.temperature_c if ctx else None,
        "is_promo": is_promo,
    }

    # Apply context overrides
    if context_overrides:
        for key, value in context_overrides.items():
            if key in scenario_context:
                scenario_context[key] = value

    scenario_state = build_state(
        end_date, scenario_metrics, scenario_context, breakpoints
    )

    # Override state with any explicit context overrides
    if context_overrides:
        for key in ["season", "temperature_band", "spend_band", "traffic_band"]:
            if key in context_overrides:
                scenario_state[key] = context_overrides[key]

    similar_states = find_similar_states(db, scenario_state, top_n=20, min_similarity=0.4)
    summary = summarize_similar_outcomes(similar_states)

    historical_analogues = [
        {
            "date": s["outcomes"]["date"],
            "similarity": s["similarity"],
            "revenue": s["outcomes"]["revenue"],
            "cvr": s["outcomes"]["cvr"],
            "new_customers": s["outcomes"]["new_customers"],
            "total_cost": s["outcomes"]["total_cost"],
        }
        for s in similar_states[:5]
    ]

    # --- Step 4: Estimate projected outcomes ---
    baseline_daily_revenue = baseline["avg_daily_total_revenue"]
    baseline_daily_new_customers = baseline["avg_daily_new_customers"]

    # Method 1: Curve-based projection
    if curve_available:
        curve_projected_revenue = baseline_daily_revenue + curve_revenue_delta
    else:
        # Linear fallback: scale revenue proportionally to spend change
        spend_change_pct = (
            (new_total_spend - baseline["avg_daily_total_spend"])
            / baseline["avg_daily_total_spend"]
            * 100
            if baseline["avg_daily_total_spend"] > 0
            else 0
        )
        # Apply a diminishing factor (sqrt) for large changes
        if spend_change_pct > 0:
            adj_factor = np.sqrt(spend_change_pct) / np.sqrt(100) if spend_change_pct > 0 else 0
            curve_projected_revenue = baseline_daily_revenue * (1 + adj_factor * spend_change_pct / 100)
        elif spend_change_pct < 0:
            # Revenue drops are less severe due to organic baseline
            curve_projected_revenue = baseline_daily_revenue * (1 + spend_change_pct / 100 * 0.7)
        else:
            curve_projected_revenue = baseline_daily_revenue
        warnings.append(
            "Revenue projection uses simplified linear model with diminishing returns approximation."
        )

    # Method 2: Historical analogue-based projection
    if similar_states:
        analogue_projected_revenue = summary["avg_revenue"]
    else:
        analogue_projected_revenue = baseline_daily_revenue
        warnings.append("No sufficiently similar historical states found.")

    # Blend the two methods
    if curve_available and similar_states:
        # Weight: 60% curve, 40% historical
        blended_revenue = curve_projected_revenue * 0.6 + analogue_projected_revenue * 0.4
        assumptions.append("Revenue projection: 60% spend-response curve, 40% historical analogues.")
    elif curve_available:
        blended_revenue = curve_projected_revenue
        assumptions.append("Revenue projection based entirely on spend-response curve.")
    elif similar_states:
        blended_revenue = analogue_projected_revenue
        assumptions.append("Revenue projection based entirely on historical analogues.")
    else:
        blended_revenue = baseline_daily_revenue
        warnings.append("No reliable projection method available; returning baseline.")

    # Apply promo adjustment
    if is_promo and not any(s["state"].get("is_promo") for s in similar_states[:5]):
        # If we're simulating a promo but few historical analogues had promos,
        # apply a conservative lift estimate
        promo_lift = 1.10  # Assume 10% lift from promo
        blended_revenue *= promo_lift
        assumptions.append(
            "Promo lift of 10% applied (default estimate; insufficient historical promo data for this state)."
        )

    # Revenue change percentage
    if baseline_daily_revenue > 0:
        revenue_change_pct = (blended_revenue - baseline_daily_revenue) / baseline_daily_revenue * 100
    else:
        revenue_change_pct = 0.0

    # New customers projection (scale proportionally to nonbrand spend change)
    # Non-brand is the primary driver of new customers
    if baseline_daily_new_customers > 0 and baseline["avg_daily_nonbrand_spend"] > 0:
        nonbrand_scale = new_nonbrand_spend / baseline["avg_daily_nonbrand_spend"]
        # Diminishing returns on customer acquisition
        nc_scale = np.sqrt(nonbrand_scale) if nonbrand_scale > 1 else nonbrand_scale
        projected_new_customers = baseline_daily_new_customers * nc_scale
        nc_change_pct = (projected_new_customers - baseline_daily_new_customers) / baseline_daily_new_customers * 100
    else:
        projected_new_customers = baseline_daily_new_customers
        nc_change_pct = 0.0
        if nonbrand_spend_change_pct != 0:
            warnings.append("Cannot project new customer changes without baseline nonbrand data.")

    # ROAS and MER
    projected_roas = blended_revenue / new_total_spend if new_total_spend > 0 else 0.0
    projected_mer = blended_revenue / new_total_spend if new_total_spend > 0 else 0.0

    # --- Step 5: Calculate confidence range from historical analogues ---
    if similar_states and len(similar_states) >= 3:
        revenues = np.array([s["outcomes"]["revenue"] for s in similar_states])
        p25 = float(np.percentile(revenues, 25))
        p50 = float(np.percentile(revenues, 50))
        p75 = float(np.percentile(revenues, 75))

        # Adjust historical range by the spend change ratio
        if summary["avg_revenue"] > 0:
            adjustment_ratio = blended_revenue / summary["avg_revenue"]
        else:
            adjustment_ratio = 1.0

        revenue_range = {
            "low": round(p25 * adjustment_ratio, 2),
            "mid": round(p50 * adjustment_ratio, 2),
            "high": round(p75 * adjustment_ratio, 2),
        }
    else:
        # Wide confidence interval without historical data
        revenue_range = {
            "low": round(blended_revenue * 0.7, 2),
            "mid": round(blended_revenue, 2),
            "high": round(blended_revenue * 1.3, 2),
        }
        warnings.append("Confidence range is estimated (insufficient historical analogues).")

    # --- Step 6: Determine overall confidence ---
    confidence_factors = []

    if curve_available:
        r_sq = proxy.get("analysis_details", {}).get("curve_r_squared", 0)
        confidence_factors.append(min(1.0, r_sq))
    else:
        confidence_factors.append(0.2)

    if similar_states:
        avg_sim = np.mean([s["similarity"] for s in similar_states[:10]])
        confidence_factors.append(float(avg_sim))
    else:
        confidence_factors.append(0.1)

    # Penalize large changes (more uncertainty)
    max_change = max(abs(brand_spend_change_pct), abs(nonbrand_spend_change_pct))
    change_penalty = max(0.3, 1.0 - max_change / 100)
    confidence_factors.append(change_penalty)

    avg_confidence = np.mean(confidence_factors)
    if avg_confidence >= 0.6:
        confidence = "high"
    elif avg_confidence >= 0.4:
        confidence = "medium"
    else:
        confidence = "low"

    # --- Step 7: Generate warnings ---
    marginal_roas = proxy.get("marginal_roas", 0)
    threshold = proxy.get("diminishing_returns_threshold", 0)

    if threshold > 0 and new_total_spend > threshold:
        warnings.append(
            f"Projected total spend (${new_total_spend:,.0f}/day) exceeds the "
            f"diminishing returns threshold (${threshold:,.0f}/day)."
        )

    if marginal_roas > 0 and marginal_roas < 1.0:
        warnings.append(
            f"Current marginal ROAS is {marginal_roas:.2f} (below break-even). "
            f"Increasing spend is unlikely to be profitable."
        )

    if max_change > 50:
        warnings.append(
            f"Large spend changes ({max_change:.0f}%) are difficult to project "
            f"accurately. Consider testing with smaller increments."
        )

    return {
        "baseline": baseline,
        "projected": {
            "revenue_change_pct": round(float(revenue_change_pct), 2),
            "revenue_range": revenue_range,
            "new_customers_change_pct": round(float(nc_change_pct), 2),
            "projected_roas": round(float(projected_roas), 4),
            "projected_mer": round(float(projected_mer), 4),
            "projected_daily_revenue": round(float(blended_revenue), 2),
            "projected_daily_new_customers": round(float(projected_new_customers), 2),
            "projected_daily_total_spend": round(float(new_total_spend), 2),
            "projected_daily_brand_spend": round(float(new_brand_spend), 2),
            "projected_daily_nonbrand_spend": round(float(new_nonbrand_spend), 2),
        },
        "confidence": confidence,
        "historical_analogues": historical_analogues,
        "warnings": warnings,
        "assumptions": assumptions,
        "scenario_state": scenario_state,
    }
