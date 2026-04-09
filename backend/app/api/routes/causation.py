"""Causation routes for correlation analysis, causal inference, and confounders."""

from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.campaign import Campaign, DailyMetrics, OrganicMetrics, ContextualData

router = APIRouter(prefix="/causation", tags=["causation"])


def _safe_pearsonr(x: list, y: list) -> tuple:
    """Compute Pearson correlation, returning (0, 1) if data is insufficient."""
    if len(x) < 3 or len(y) < 3:
        return 0.0, 1.0
    try:
        import numpy as np
        from scipy import stats as scipy_stats

        x_arr = np.array(x, dtype=float)
        y_arr = np.array(y, dtype=float)

        if np.std(x_arr) == 0 or np.std(y_arr) == 0:
            return 0.0, 1.0

        corr, p_val = scipy_stats.pearsonr(x_arr, y_arr)
        return float(corr), float(p_val)
    except Exception:
        return 0.0, 1.0


def _build_daily_series(db: Session, start_date: Optional[date], end_date: Optional[date]) -> dict:
    """
    Build aligned daily time series for key variables.
    Returns dict keyed by date with sub-dicts for each variable.
    """
    # Paid metrics aggregated by date and type
    paid_q = (
        db.query(
            DailyMetrics.date,
            Campaign.campaign_type,
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.clicks).label("clicks"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
    )
    if start_date:
        paid_q = paid_q.filter(DailyMetrics.date >= start_date)
    if end_date:
        paid_q = paid_q.filter(DailyMetrics.date <= end_date)
    paid_q = paid_q.group_by(DailyMetrics.date, Campaign.campaign_type)

    series: dict = {}
    for row in paid_q.all():
        d = row.date
        if d not in series:
            series[d] = {
                "brand_cost": 0.0, "brand_revenue": 0.0, "brand_conversions": 0.0,
                "nonbrand_cost": 0.0, "nonbrand_revenue": 0.0, "nonbrand_conversions": 0.0,
                "total_cost": 0.0, "total_revenue": 0.0,
                "organic_sessions": 0, "brand_organic_sessions": 0,
                "is_promo": False, "temperature_c": None,
            }
        prefix = "brand" if row.campaign_type == "brand" else "nonbrand"
        series[d][f"{prefix}_cost"] = float(row.cost)
        series[d][f"{prefix}_revenue"] = float(row.revenue)
        series[d][f"{prefix}_conversions"] = float(row.conversions)
        series[d]["total_cost"] += float(row.cost)
        series[d]["total_revenue"] += float(row.revenue)

    # Organic
    organic_q = db.query(OrganicMetrics)
    if start_date:
        organic_q = organic_q.filter(OrganicMetrics.date >= start_date)
    if end_date:
        organic_q = organic_q.filter(OrganicMetrics.date <= end_date)

    for om in organic_q.all():
        if om.date not in series:
            continue
        series[om.date]["organic_sessions"] = om.organic_sessions
        series[om.date]["brand_organic_sessions"] = om.brand_organic_sessions

    # Contextual
    ctx_q = db.query(ContextualData)
    if start_date:
        ctx_q = ctx_q.filter(ContextualData.date >= start_date)
    if end_date:
        ctx_q = ctx_q.filter(ContextualData.date <= end_date)

    for cd in ctx_q.all():
        if cd.date not in series:
            continue
        series[cd.date]["is_promo"] = cd.is_promo
        series[cd.date]["temperature_c"] = cd.temperature_c

    return series


@router.get("/correlations")
def get_correlations(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    List detected correlations with causality assessment scores.

    Computes pairwise correlations between key PPC variables and
    provides a heuristic causality score.
    """
    series = _build_daily_series(db, start_date, end_date)
    if len(series) < 7:
        return {
            "correlations": [],
            "message": "Insufficient data. Need at least 7 days of data for correlation analysis.",
            "days_available": len(series),
        }

    sorted_dates = sorted(series.keys())
    variables = {
        "brand_cost": [series[d]["brand_cost"] for d in sorted_dates],
        "brand_revenue": [series[d]["brand_revenue"] for d in sorted_dates],
        "nonbrand_cost": [series[d]["nonbrand_cost"] for d in sorted_dates],
        "nonbrand_revenue": [series[d]["nonbrand_revenue"] for d in sorted_dates],
        "total_revenue": [series[d]["total_revenue"] for d in sorted_dates],
        "organic_sessions": [series[d]["organic_sessions"] for d in sorted_dates],
        "brand_organic_sessions": [series[d]["brand_organic_sessions"] for d in sorted_dates],
    }

    # Define pairs of interest
    pairs = [
        ("brand_cost", "brand_revenue"),
        ("nonbrand_cost", "nonbrand_revenue"),
        ("brand_cost", "organic_sessions"),
        ("brand_cost", "brand_organic_sessions"),
        ("nonbrand_cost", "total_revenue"),
        ("brand_cost", "nonbrand_revenue"),
        ("nonbrand_cost", "brand_revenue"),
    ]

    correlations = []
    for var_a, var_b in pairs:
        data_a = variables[var_a]
        data_b = variables[var_b]

        corr, p_val = _safe_pearsonr(data_a, data_b)

        # Heuristic causality score:
        # - Spend -> Revenue is more likely causal than the reverse
        # - Strong correlation + low p-value = higher score
        # - Adjust for known causal directions
        known_causal = {
            ("brand_cost", "brand_revenue"): 0.7,
            ("nonbrand_cost", "nonbrand_revenue"): 0.8,
            ("brand_cost", "organic_sessions"): 0.3,
            ("brand_cost", "brand_organic_sessions"): 0.3,
            ("nonbrand_cost", "total_revenue"): 0.6,
            ("brand_cost", "nonbrand_revenue"): 0.2,
            ("nonbrand_cost", "brand_revenue"): 0.2,
        }

        base_causal = known_causal.get((var_a, var_b), 0.5)
        strength = abs(corr)
        significance = 1.0 - min(p_val, 1.0)
        causality_score = round(base_causal * strength * significance, 4)

        if abs(corr) < 0.1:
            direction = "none"
        elif corr > 0:
            direction = "positive"
        else:
            direction = "negative"

        correlations.append({
            "variable_a": var_a,
            "variable_b": var_b,
            "correlation": round(corr, 4),
            "p_value": round(p_val, 6),
            "direction": direction,
            "causality_score": causality_score,
            "n_observations": len(sorted_dates),
            "interpretation": _interpret_correlation(var_a, var_b, corr, p_val),
        })

    correlations.sort(key=lambda x: abs(x["correlation"]), reverse=True)

    return {
        "correlations": correlations,
        "days_analyzed": len(sorted_dates),
        "date_range": {
            "start": str(sorted_dates[0]) if sorted_dates else None,
            "end": str(sorted_dates[-1]) if sorted_dates else None,
        },
    }


def _interpret_correlation(var_a: str, var_b: str, corr: float, p_val: float) -> str:
    """Generate a human-readable interpretation of a correlation."""
    strength = abs(corr)
    if strength < 0.1:
        strength_word = "negligible"
    elif strength < 0.3:
        strength_word = "weak"
    elif strength < 0.6:
        strength_word = "moderate"
    elif strength < 0.8:
        strength_word = "strong"
    else:
        strength_word = "very strong"

    direction_word = "positive" if corr > 0 else "negative"
    sig_word = "statistically significant" if p_val < 0.05 else "not statistically significant"

    return (
        f"There is a {strength_word} {direction_word} correlation ({corr:.3f}) between "
        f"{var_a.replace('_', ' ')} and {var_b.replace('_', ' ')}. "
        f"This relationship is {sig_word} (p={p_val:.4f})."
    )


@router.get("/analysis")
def get_causal_analysis(
    variable_a: str = Query(..., description="First variable (e.g., brand_cost)"),
    variable_b: str = Query(..., description="Second variable (e.g., organic_sessions)"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Detailed causal analysis for a specific variable pair.

    Performs lagged correlation analysis to assess temporal precedence
    and provides a causal assessment.
    """
    series = _build_daily_series(db, start_date, end_date)
    sorted_dates = sorted(series.keys())

    allowed_vars = [
        "brand_cost", "brand_revenue", "nonbrand_cost", "nonbrand_revenue",
        "total_cost", "total_revenue", "organic_sessions", "brand_organic_sessions",
    ]

    if variable_a not in allowed_vars or variable_b not in allowed_vars:
        return {
            "error": f"Invalid variable(s). Allowed: {allowed_vars}",
        }

    if len(sorted_dates) < 10:
        return {
            "error": "Insufficient data for causal analysis. Need at least 10 days.",
            "days_available": len(sorted_dates),
        }

    data_a = [series[d].get(variable_a, 0) or 0 for d in sorted_dates]
    data_b = [series[d].get(variable_b, 0) or 0 for d in sorted_dates]

    # Contemporaneous correlation
    corr_0, p_0 = _safe_pearsonr(data_a, data_b)

    # Lagged correlations (A leads B by 1-3 days)
    lag_results = []
    for lag in range(1, min(4, len(sorted_dates) // 3)):
        lagged_a = data_a[:-lag]
        shifted_b = data_b[lag:]
        corr_lag, p_lag = _safe_pearsonr(lagged_a, shifted_b)
        lag_results.append({
            "lag_days": lag,
            "correlation": round(corr_lag, 4),
            "p_value": round(p_lag, 6),
            "direction": f"{variable_a}(t) -> {variable_b}(t+{lag})",
        })

    # Reverse lag (B leads A)
    reverse_lag_results = []
    for lag in range(1, min(4, len(sorted_dates) // 3)):
        lagged_b = data_b[:-lag]
        shifted_a = data_a[lag:]
        corr_lag, p_lag = _safe_pearsonr(lagged_b, shifted_a)
        reverse_lag_results.append({
            "lag_days": lag,
            "correlation": round(corr_lag, 4),
            "p_value": round(p_lag, 6),
            "direction": f"{variable_b}(t) -> {variable_a}(t+{lag})",
        })

    # Determine temporal precedence
    max_forward = max((abs(lr["correlation"]) for lr in lag_results), default=0)
    max_reverse = max((abs(lr["correlation"]) for lr in reverse_lag_results), default=0)

    if max_forward > max_reverse and max_forward > abs(corr_0) * 0.5:
        temporal_assessment = f"{variable_a} appears to temporally precede {variable_b}"
        causal_direction = f"{variable_a} -> {variable_b}"
    elif max_reverse > max_forward and max_reverse > abs(corr_0) * 0.5:
        temporal_assessment = f"{variable_b} appears to temporally precede {variable_a}"
        causal_direction = f"{variable_b} -> {variable_a}"
    else:
        temporal_assessment = "No clear temporal precedence detected"
        causal_direction = "unclear"

    return {
        "variable_a": variable_a,
        "variable_b": variable_b,
        "contemporaneous": {
            "correlation": round(corr_0, 4),
            "p_value": round(p_0, 6),
        },
        "forward_lags": lag_results,
        "reverse_lags": reverse_lag_results,
        "temporal_assessment": temporal_assessment,
        "causal_direction": causal_direction,
        "n_observations": len(sorted_dates),
        "caveat": (
            "Lagged correlation analysis can suggest temporal precedence but cannot "
            "definitively prove causation. Consider running a controlled experiment "
            "for conclusive evidence."
        ),
    }


@router.get("/confounders")
def check_confounders(
    variable_a: str = Query(..., description="First variable"),
    variable_b: str = Query(..., description="Second variable"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Check for confounding variables that might explain the relationship
    between two variables.
    """
    series = _build_daily_series(db, start_date, end_date)
    sorted_dates = sorted(series.keys())

    allowed_vars = [
        "brand_cost", "brand_revenue", "nonbrand_cost", "nonbrand_revenue",
        "total_cost", "total_revenue", "organic_sessions", "brand_organic_sessions",
    ]

    if variable_a not in allowed_vars or variable_b not in allowed_vars:
        return {"error": f"Invalid variable(s). Allowed: {allowed_vars}"}

    if len(sorted_dates) < 7:
        return {
            "error": "Insufficient data. Need at least 7 days.",
            "days_available": len(sorted_dates),
        }

    data_a = [series[d].get(variable_a, 0) or 0 for d in sorted_dates]
    data_b = [series[d].get(variable_b, 0) or 0 for d in sorted_dates]

    # Primary correlation
    corr_ab, p_ab = _safe_pearsonr(data_a, data_b)

    # Check potential confounders
    confounders = []

    # Day of week (encoded as 0-6)
    dow_values = [d.weekday() for d in sorted_dates]
    corr_a_dow, _ = _safe_pearsonr(data_a, dow_values)
    corr_b_dow, _ = _safe_pearsonr(data_b, dow_values)
    if abs(corr_a_dow) > 0.2 and abs(corr_b_dow) > 0.2:
        confounders.append({
            "name": "day_of_week",
            "correlation_with_a": round(corr_a_dow, 4),
            "correlation_with_b": round(corr_b_dow, 4),
            "risk": "moderate" if abs(corr_a_dow) > 0.4 or abs(corr_b_dow) > 0.4 else "low",
            "explanation": "Both variables show day-of-week patterns, which may inflate their apparent correlation.",
        })

    # Promo days
    promo_values = [1.0 if series[d].get("is_promo", False) else 0.0 for d in sorted_dates]
    if any(v > 0 for v in promo_values):
        corr_a_promo, _ = _safe_pearsonr(data_a, promo_values)
        corr_b_promo, _ = _safe_pearsonr(data_b, promo_values)
        if abs(corr_a_promo) > 0.2 and abs(corr_b_promo) > 0.2:
            confounders.append({
                "name": "promotional_period",
                "correlation_with_a": round(corr_a_promo, 4),
                "correlation_with_b": round(corr_b_promo, 4),
                "risk": "high" if abs(corr_a_promo) > 0.4 or abs(corr_b_promo) > 0.4 else "moderate",
                "explanation": "Promotional periods affect both variables and may create a spurious correlation.",
            })

    # Trend (time index)
    time_index = list(range(len(sorted_dates)))
    corr_a_time, _ = _safe_pearsonr(data_a, time_index)
    corr_b_time, _ = _safe_pearsonr(data_b, time_index)
    if abs(corr_a_time) > 0.3 and abs(corr_b_time) > 0.3:
        confounders.append({
            "name": "time_trend",
            "correlation_with_a": round(corr_a_time, 4),
            "correlation_with_b": round(corr_b_time, 4),
            "risk": "high" if abs(corr_a_time) > 0.5 or abs(corr_b_time) > 0.5 else "moderate",
            "explanation": (
                "Both variables share a common time trend. This is a classic source of spurious "
                "correlation in time-series data."
            ),
        })

    # Temperature (if available)
    temp_values = [series[d].get("temperature_c") for d in sorted_dates]
    if all(t is not None for t in temp_values):
        temp_floats = [float(t) for t in temp_values]
        corr_a_temp, _ = _safe_pearsonr(data_a, temp_floats)
        corr_b_temp, _ = _safe_pearsonr(data_b, temp_floats)
        if abs(corr_a_temp) > 0.2 and abs(corr_b_temp) > 0.2:
            confounders.append({
                "name": "temperature",
                "correlation_with_a": round(corr_a_temp, 4),
                "correlation_with_b": round(corr_b_temp, 4),
                "risk": "moderate",
                "explanation": "Weather/temperature affects both variables and may confound the relationship.",
            })

    overall_risk = "low"
    if any(c["risk"] == "high" for c in confounders):
        overall_risk = "high"
    elif any(c["risk"] == "moderate" for c in confounders):
        overall_risk = "moderate"

    return {
        "variable_a": variable_a,
        "variable_b": variable_b,
        "primary_correlation": round(corr_ab, 4),
        "primary_p_value": round(p_ab, 6),
        "confounders": confounders,
        "overall_confounding_risk": overall_risk,
        "recommendation": (
            "Consider running a controlled experiment (e.g., geo-holdout) to isolate the causal effect "
            "and control for the identified confounders."
            if confounders
            else "No significant confounders detected, but observational analysis alone cannot prove causation."
        ),
        "n_observations": len(sorted_dates),
    }
