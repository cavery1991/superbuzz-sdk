"""
Correlation vs causation analysis engine.

Provides a multi-faceted framework for distinguishing genuine causal
relationships from spurious correlations in PPC data. Implements temporal
precedence checks, isolation analysis, saturation detection, and demand
dependency assessment.
"""

import logging
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats
from scipy.optimize import curve_fit
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.campaign import (
    Campaign,
    DailyMetrics,
    OrganicMetrics,
    ContextualData,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Supported variable pairs
# ---------------------------------------------------------------------------

SUPPORTED_VARIABLES = {
    "brand_spend",
    "nonbrand_spend",
    "total_spend",
    "total_revenue",
    "new_customers",
    "temperature",
    "conversion_rate",
    "is_promo",
    "revenue",
}

VARIABLE_DESCRIPTIONS = {
    "brand_spend": "Daily brand campaign spend",
    "nonbrand_spend": "Daily non-brand campaign spend",
    "total_spend": "Total daily ad spend",
    "total_revenue": "Total daily revenue",
    "new_customers": "Daily new customer acquisitions",
    "temperature": "Daily temperature (Celsius)",
    "conversion_rate": "Daily conversion rate",
    "is_promo": "Whether a promotion was active",
    "revenue": "Total daily revenue (alias)",
}


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def _fetch_analysis_dataframe(
    db: Session,
    start_date: date,
    end_date: date,
) -> pd.DataFrame:
    """
    Build a comprehensive daily DataFrame with all variables needed for
    causal analysis.
    """
    # Aggregate daily metrics by campaign type
    rows = (
        db.query(
            DailyMetrics.date,
            Campaign.campaign_type,
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.clicks).label("clicks"),
            func.sum(DailyMetrics.impressions).label("impressions"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
            func.sum(DailyMetrics.orders).label("orders"),
        )
        .join(Campaign, DailyMetrics.campaign_id == Campaign.id)
        .filter(DailyMetrics.date >= start_date, DailyMetrics.date <= end_date)
        .group_by(DailyMetrics.date, Campaign.campaign_type)
        .order_by(DailyMetrics.date)
        .all()
    )

    if not rows:
        return pd.DataFrame()

    # Pivot into daily records
    records = {}
    for row in rows:
        d = row.date
        if d not in records:
            records[d] = {
                "date": d,
                "brand_spend": 0.0,
                "nonbrand_spend": 0.0,
                "total_spend": 0.0,
                "total_revenue": 0.0,
                "total_conversions": 0.0,
                "total_clicks": 0.0,
                "total_impressions": 0.0,
                "new_customers": 0,
                "total_orders": 0,
            }
        rec = records[d]
        cost_val = float(row.cost or 0)
        rev_val = float(row.revenue or 0)
        conv_val = float(row.conversions or 0)
        clicks_val = int(row.clicks or 0)
        imp_val = int(row.impressions or 0)
        nc_val = int(row.new_customers or 0)
        orders_val = int(row.orders or 0)

        if row.campaign_type == "brand":
            rec["brand_spend"] += cost_val
        elif row.campaign_type == "nonbrand":
            rec["nonbrand_spend"] += cost_val

        rec["total_spend"] += cost_val
        rec["total_revenue"] += rev_val
        rec["total_conversions"] += conv_val
        rec["total_clicks"] += clicks_val
        rec["total_impressions"] += imp_val
        rec["new_customers"] += nc_val
        rec["total_orders"] += orders_val

    df = pd.DataFrame(list(records.values()))
    df["date"] = pd.to_datetime(df["date"])
    df.sort_values("date", inplace=True)
    df.reset_index(drop=True, inplace=True)

    # Conversion rate
    df["conversion_rate"] = np.where(
        df["total_clicks"] > 0,
        df["total_conversions"] / df["total_clicks"],
        0.0,
    )

    # Revenue alias
    df["revenue"] = df["total_revenue"]

    # Join contextual data
    ctx_rows = (
        db.query(ContextualData)
        .filter(ContextualData.date >= start_date, ContextualData.date <= end_date)
        .all()
    )
    if ctx_rows:
        ctx_df = pd.DataFrame(
            [
                {
                    "date": pd.Timestamp(c.date),
                    "temperature": float(c.temperature_c) if c.temperature_c is not None else np.nan,
                    "is_promo": 1.0 if c.is_promo else 0.0,
                }
                for c in ctx_rows
            ]
        )
        df = pd.merge(df, ctx_df, on="date", how="left")
    else:
        df["temperature"] = np.nan
        df["is_promo"] = 0.0

    df["is_promo"] = df["is_promo"].fillna(0.0)

    # Join organic data
    org_rows = (
        db.query(OrganicMetrics)
        .filter(OrganicMetrics.date >= start_date, OrganicMetrics.date <= end_date)
        .all()
    )
    if org_rows:
        org_df = pd.DataFrame(
            [
                {
                    "date": pd.Timestamp(o.date),
                    "organic_sessions": int(o.organic_sessions or 0),
                    "organic_revenue": float(o.organic_revenue or 0),
                    "brand_organic_sessions": int(o.brand_organic_sessions or 0),
                }
                for o in org_rows
            ]
        )
        df = pd.merge(df, org_df, on="date", how="left")
    else:
        df["organic_sessions"] = 0
        df["organic_revenue"] = 0.0
        df["brand_organic_sessions"] = 0

    return df


def _get_variable_series(df: pd.DataFrame, var_name: str) -> Optional[np.ndarray]:
    """Extract a named variable as a numpy array from the analysis DataFrame."""
    if var_name in df.columns:
        series = df[var_name].values.astype(float)
        return series
    return None


# ---------------------------------------------------------------------------
# Core analysis functions
# ---------------------------------------------------------------------------

def analyze_correlation(
    x: np.ndarray,
    y: np.ndarray,
    x_name: str = "x",
    y_name: str = "y",
) -> dict:
    """
    Calculate Pearson and Spearman correlations between two variables.

    Args:
        x: Array of values for the first variable.
        y: Array of values for the second variable.
        x_name: Human-readable name for x.
        y_name: Human-readable name for y.

    Returns:
        Dictionary with pearson_r, pearson_p, spearman_r, spearman_p,
        strength, direction, n.
    """
    if len(x) != len(y):
        raise ValueError(f"Arrays must be the same length: {len(x)} vs {len(y)}")

    # Remove NaN pairs
    mask = ~(np.isnan(x) | np.isnan(y))
    x_clean = x[mask]
    y_clean = y[mask]

    n = len(x_clean)
    if n < 3:
        return {
            "pearson_r": 0.0,
            "pearson_p": 1.0,
            "spearman_r": 0.0,
            "spearman_p": 1.0,
            "strength": "insufficient_data",
            "direction": "none",
            "n": n,
            "x_name": x_name,
            "y_name": y_name,
        }

    # Check for constant arrays
    if np.std(x_clean) == 0 or np.std(y_clean) == 0:
        return {
            "pearson_r": 0.0,
            "pearson_p": 1.0,
            "spearman_r": 0.0,
            "spearman_p": 1.0,
            "strength": "no_variation",
            "direction": "none",
            "n": n,
            "x_name": x_name,
            "y_name": y_name,
        }

    pearson_r, pearson_p = scipy_stats.pearsonr(x_clean, y_clean)
    spearman_r, spearman_p = scipy_stats.spearmanr(x_clean, y_clean)

    abs_r = abs(pearson_r)
    if abs_r >= 0.7:
        strength = "strong"
    elif abs_r >= 0.4:
        strength = "moderate"
    elif abs_r >= 0.2:
        strength = "weak"
    else:
        strength = "negligible"

    direction = "positive" if pearson_r > 0 else "negative" if pearson_r < 0 else "none"

    return {
        "pearson_r": round(float(pearson_r), 4),
        "pearson_p": round(float(pearson_p), 6),
        "spearman_r": round(float(spearman_r), 4),
        "spearman_p": round(float(spearman_p), 6),
        "strength": strength,
        "direction": direction,
        "n": n,
        "x_name": x_name,
        "y_name": y_name,
    }


def check_temporal_precedence(
    db: Session,
    cause_col: str,
    effect_col: str,
    start_date: date,
    end_date: date,
    lag_days: list[int] = None,
) -> dict:
    """
    Test whether the putative cause precedes the effect at various lags.

    Cross-correlates the cause variable at time t with the effect at t+lag.
    A stronger correlation at positive lags suggests temporal precedence.

    Args:
        db: SQLAlchemy session.
        cause_col: Name of the cause variable.
        effect_col: Name of the effect variable.
        start_date: Start of analysis window.
        end_date: End of analysis window.
        lag_days: List of lag values to test (default: [1, 3, 7]).

    Returns:
        Dictionary with best_lag, best_correlation, lag_results,
        temporal_score (0-1).
    """
    if lag_days is None:
        lag_days = [1, 3, 7]

    df = _fetch_analysis_dataframe(db, start_date, end_date)
    if df.empty:
        return {
            "best_lag": 0,
            "best_correlation": 0.0,
            "lag_results": {},
            "temporal_score": 0.0,
            "error": "No data available",
        }

    cause = _get_variable_series(df, cause_col)
    effect = _get_variable_series(df, effect_col)

    if cause is None or effect is None:
        return {
            "best_lag": 0,
            "best_correlation": 0.0,
            "lag_results": {},
            "temporal_score": 0.0,
            "error": f"Variable not found: {cause_col if cause is None else effect_col}",
        }

    # Also compute zero-lag correlation as baseline
    lag_results = {}
    best_lag = 0
    best_corr = 0.0

    # Zero lag baseline
    mask_0 = ~(np.isnan(cause) | np.isnan(effect))
    if mask_0.sum() >= 3 and np.std(cause[mask_0]) > 0 and np.std(effect[mask_0]) > 0:
        r_0, _ = scipy_stats.pearsonr(cause[mask_0], effect[mask_0])
        lag_results[0] = round(float(r_0), 4)
        best_corr = abs(r_0)
    else:
        lag_results[0] = 0.0

    for lag in lag_days:
        if lag <= 0 or lag >= len(cause):
            lag_results[lag] = 0.0
            continue

        # Cause at time t, effect at time t+lag
        cause_lagged = cause[:-lag]
        effect_lagged = effect[lag:]

        mask = ~(np.isnan(cause_lagged) | np.isnan(effect_lagged))
        if mask.sum() < 3:
            lag_results[lag] = 0.0
            continue

        c = cause_lagged[mask]
        e = effect_lagged[mask]

        if np.std(c) == 0 or np.std(e) == 0:
            lag_results[lag] = 0.0
            continue

        r, _ = scipy_stats.pearsonr(c, e)
        lag_results[lag] = round(float(r), 4)

        if abs(r) > best_corr:
            best_corr = abs(r)
            best_lag = lag

    # Temporal score: how much stronger is the best lagged correlation
    # vs the zero-lag correlation?
    zero_lag_corr = abs(lag_results.get(0, 0.0))
    best_lagged_corr = max(
        abs(lag_results.get(lag, 0.0)) for lag in lag_days if lag in lag_results
    ) if lag_days else 0.0

    if best_lagged_corr > zero_lag_corr and best_lagged_corr > 0:
        # Cause leads effect -- good temporal precedence
        temporal_score = min(1.0, best_lagged_corr)
    elif zero_lag_corr > 0:
        # Simultaneous -- partial credit
        temporal_score = zero_lag_corr * 0.5
    else:
        temporal_score = 0.0

    return {
        "best_lag": best_lag,
        "best_correlation": round(float(best_corr), 4),
        "lag_results": lag_results,
        "temporal_score": round(float(temporal_score), 4),
    }


def check_isolation(
    db: Session,
    target_date_range: tuple[date, date],
) -> dict:
    """
    Assess how many variables changed simultaneously during a period.

    More simultaneous changes reduce causal confidence because any of
    the co-occurring changes could be the true cause.

    Args:
        db: SQLAlchemy session.
        target_date_range: Tuple of (start_date, end_date).

    Returns:
        Dictionary with changed_variables (list), change_count,
        isolation_score (0-1), details.
    """
    start_date, end_date = target_date_range

    # Get a wider window to compare: the target period vs the preceding period
    period_days = (end_date - start_date).days + 1
    pre_start = start_date - timedelta(days=period_days)
    pre_end = start_date - timedelta(days=1)

    df_target = _fetch_analysis_dataframe(db, start_date, end_date)
    df_pre = _fetch_analysis_dataframe(db, pre_start, pre_end)

    if df_target.empty or df_pre.empty:
        return {
            "changed_variables": [],
            "change_count": 0,
            "isolation_score": 0.5,
            "details": "Insufficient data for isolation analysis",
        }

    variables_to_check = [
        "brand_spend", "nonbrand_spend", "total_spend", "total_revenue",
        "new_customers", "conversion_rate", "is_promo",
    ]
    if "temperature" in df_target.columns and not df_target["temperature"].isna().all():
        variables_to_check.append("temperature")

    changed_variables = []
    details = {}

    for var in variables_to_check:
        if var not in df_target.columns or var not in df_pre.columns:
            continue

        target_vals = df_target[var].dropna().values.astype(float)
        pre_vals = df_pre[var].dropna().values.astype(float)

        if len(target_vals) < 2 or len(pre_vals) < 2:
            continue

        target_mean = float(np.mean(target_vals))
        pre_mean = float(np.mean(pre_vals))

        # Percentage change
        if pre_mean != 0:
            pct_change = (target_mean - pre_mean) / abs(pre_mean)
        else:
            pct_change = 0.0 if target_mean == 0 else 1.0

        # Threshold: more than 15% change is "significant"
        threshold = 0.15
        if abs(pct_change) > threshold:
            changed_variables.append(var)
            details[var] = {
                "pre_mean": round(pre_mean, 4),
                "target_mean": round(target_mean, 4),
                "pct_change": round(float(pct_change) * 100, 2),
            }

    change_count = len(changed_variables)

    # Isolation score: 1 variable changed = good isolation (score ~1.0)
    # Many variables = poor isolation (score -> 0)
    if change_count == 0:
        isolation_score = 0.5  # Nothing changed -- ambiguous
    elif change_count == 1:
        isolation_score = 1.0
    elif change_count == 2:
        isolation_score = 0.7
    elif change_count == 3:
        isolation_score = 0.4
    else:
        isolation_score = max(0.1, 1.0 - change_count * 0.15)

    return {
        "changed_variables": changed_variables,
        "change_count": change_count,
        "isolation_score": round(float(isolation_score), 4),
        "details": details,
    }


def check_saturation(
    x_spend: np.ndarray,
    y_revenue: np.ndarray,
) -> dict:
    """
    Fit a logarithmic curve to spend vs revenue and detect diminishing returns.

    Model: revenue = a * ln(spend) + b

    Args:
        x_spend: Array of spend values.
        y_revenue: Array of corresponding revenue values.

    Returns:
        Dictionary with saturation_point, current_efficiency_pct,
        curve_params, r_squared, saturation_score.
    """
    # Remove NaN and zero-spend entries
    mask = ~(np.isnan(x_spend) | np.isnan(y_revenue)) & (x_spend > 0)
    x = x_spend[mask]
    y = y_revenue[mask]

    if len(x) < 5:
        return {
            "saturation_point": 0.0,
            "current_efficiency_pct": 0.0,
            "curve_params": {"a": 0.0, "b": 0.0},
            "r_squared": 0.0,
            "saturation_score": 0.5,
            "error": "Insufficient data for saturation analysis",
        }

    try:
        def log_model(s, a, b):
            return a * np.log(np.maximum(s, 1e-10)) + b

        popt, _ = curve_fit(log_model, x, y, p0=[np.mean(y), 0.0], maxfev=5000)
        a, b = float(popt[0]), float(popt[1])

        # R-squared
        y_pred = log_model(x, a, b)
        ss_res = np.sum((y - y_pred) ** 2)
        ss_tot = np.sum((y - np.mean(y)) ** 2)
        r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

        # Marginal return at current spend: d(revenue)/d(spend) = a/spend
        current_spend = float(np.mean(x))
        current_marginal = a / current_spend if current_spend > 0 else 0.0

        # Saturation point: where marginal return drops below 1.0 (break-even)
        saturation_point = float(a) if a > 0 else 0.0

        # Current efficiency: how close are we to saturation?
        # efficiency = marginal_return / initial_marginal_return
        # At the minimum observed spend, what was the marginal return?
        min_spend = float(np.min(x))
        initial_marginal = a / min_spend if min_spend > 0 else 1.0
        current_efficiency_pct = (
            (current_marginal / initial_marginal * 100)
            if initial_marginal > 0
            else 0.0
        )

        # Saturation score: 0 = totally saturated, 1 = far from saturation
        if saturation_point > 0 and current_spend > 0:
            ratio = current_spend / saturation_point
            saturation_score = max(0.0, min(1.0, 1.0 - ratio))
        else:
            saturation_score = 0.5

        return {
            "saturation_point": round(saturation_point, 2),
            "current_efficiency_pct": round(float(current_efficiency_pct), 2),
            "curve_params": {"a": round(a, 4), "b": round(b, 4)},
            "r_squared": round(float(r_squared), 4),
            "saturation_score": round(float(saturation_score), 4),
            "current_spend_avg": round(current_spend, 2),
            "current_marginal_return": round(float(current_marginal), 4),
        }

    except (RuntimeError, ValueError) as e:
        logger.warning("Saturation curve fitting failed: %s", str(e))
        return {
            "saturation_point": 0.0,
            "current_efficiency_pct": 0.0,
            "curve_params": {"a": 0.0, "b": 0.0},
            "r_squared": 0.0,
            "saturation_score": 0.5,
            "error": f"Curve fitting failed: {str(e)}",
        }


def check_demand_dependency(
    db: Session,
    start_date: date,
    end_date: date,
) -> dict:
    """
    Determine whether revenue follows spend changes or organic demand changes
    more closely.

    If revenue correlates more with organic demand than with ad spend, the
    spend-revenue relationship may not be causal.

    Args:
        db: SQLAlchemy session.
        start_date: Start of analysis window.
        end_date: End of analysis window.

    Returns:
        Dictionary with spend_revenue_corr, organic_revenue_corr,
        demand_dependency_score (0-1), interpretation.
    """
    df = _fetch_analysis_dataframe(db, start_date, end_date)

    if df.empty or len(df) < 7:
        return {
            "spend_revenue_corr": 0.0,
            "organic_revenue_corr": 0.0,
            "demand_dependency_score": 0.5,
            "interpretation": "Insufficient data for demand dependency analysis",
        }

    spend = df["total_spend"].values.astype(float)
    revenue = df["total_revenue"].values.astype(float)

    # Compute spend-revenue correlation
    mask_sr = ~(np.isnan(spend) | np.isnan(revenue))
    if mask_sr.sum() >= 3 and np.std(spend[mask_sr]) > 0 and np.std(revenue[mask_sr]) > 0:
        spend_rev_corr, _ = scipy_stats.pearsonr(spend[mask_sr], revenue[mask_sr])
    else:
        spend_rev_corr = 0.0

    # Compute organic-revenue correlation
    organic = df.get("organic_sessions")
    if organic is not None:
        org_vals = organic.values.astype(float)
        mask_or = ~(np.isnan(org_vals) | np.isnan(revenue)) & (org_vals > 0)
        if mask_or.sum() >= 3 and np.std(org_vals[mask_or]) > 0 and np.std(revenue[mask_or]) > 0:
            org_rev_corr, _ = scipy_stats.pearsonr(org_vals[mask_or], revenue[mask_or])
        else:
            org_rev_corr = 0.0
    else:
        org_rev_corr = 0.0

    # Demand dependency score:
    # High score = revenue follows organic demand more than spend (spend may not be causal)
    # Low score = revenue follows spend more than organic demand (spend may be causal)
    abs_spend_corr = abs(spend_rev_corr)
    abs_org_corr = abs(org_rev_corr)

    if abs_spend_corr + abs_org_corr > 0:
        demand_dep = abs_org_corr / (abs_spend_corr + abs_org_corr)
    else:
        demand_dep = 0.5

    if abs_org_corr > abs_spend_corr:
        interpretation = (
            f"Revenue correlates more strongly with organic demand "
            f"(r={org_rev_corr:.3f}) than with ad spend (r={spend_rev_corr:.3f}). "
            f"This suggests underlying demand may be driving revenue more than ad spend."
        )
    elif abs_spend_corr > abs_org_corr:
        interpretation = (
            f"Revenue correlates more strongly with ad spend "
            f"(r={spend_rev_corr:.3f}) than with organic demand (r={org_rev_corr:.3f}). "
            f"Ad spend may be a genuine driver of revenue."
        )
    else:
        interpretation = (
            "Revenue correlates equally with spend and organic demand. "
            "Cannot distinguish the primary driver."
        )

    return {
        "spend_revenue_corr": round(float(spend_rev_corr), 4),
        "organic_revenue_corr": round(float(org_rev_corr), 4),
        "demand_dependency_score": round(float(demand_dep), 4),
        "interpretation": interpretation,
    }


# ---------------------------------------------------------------------------
# Full causal analysis
# ---------------------------------------------------------------------------

def full_causal_analysis(
    db: Session,
    var_x: str,
    var_y: str,
    start_date: date,
    end_date: date,
) -> dict:
    """
    Run a comprehensive causal analysis between two variables.

    Combines correlation analysis, temporal precedence, isolation assessment,
    saturation detection, and demand dependency into an overall causality
    confidence score.

    Supported variable pairs include:
    - brand_spend vs total_revenue
    - nonbrand_spend vs total_revenue
    - brand_spend vs new_customers
    - nonbrand_spend vs new_customers
    - total_spend vs total_revenue
    - temperature vs conversion_rate
    - is_promo vs revenue

    Args:
        db: SQLAlchemy session.
        var_x: Name of the independent (cause) variable.
        var_y: Name of the dependent (effect) variable.
        start_date: Analysis window start.
        end_date: Analysis window end.

    Returns:
        Dictionary with correlation_strength, temporal_score, isolation_score,
        saturation_score, demand_dependency_score, overall_causality_confidence,
        explanation, evidence.
    """
    evidence = []

    df = _fetch_analysis_dataframe(db, start_date, end_date)
    if df.empty:
        return {
            "correlation_strength": 0.0,
            "temporal_score": 0.0,
            "isolation_score": 0.0,
            "saturation_score": 0.0,
            "demand_dependency_score": 0.0,
            "overall_causality_confidence": "low",
            "explanation": "No data available for the specified period.",
            "evidence": [],
        }

    x_series = _get_variable_series(df, var_x)
    y_series = _get_variable_series(df, var_y)

    if x_series is None or y_series is None:
        missing = var_x if x_series is None else var_y
        return {
            "correlation_strength": 0.0,
            "temporal_score": 0.0,
            "isolation_score": 0.0,
            "saturation_score": 0.0,
            "demand_dependency_score": 0.0,
            "overall_causality_confidence": "low",
            "explanation": f"Variable '{missing}' not available in the data.",
            "evidence": [],
        }

    # 1. Correlation
    corr_result = analyze_correlation(x_series, y_series, var_x, var_y)
    correlation_strength = abs(corr_result["pearson_r"])
    evidence.append(
        f"Pearson correlation between {var_x} and {var_y}: r={corr_result['pearson_r']:.3f} "
        f"(p={corr_result['pearson_p']:.4f}), Spearman: r={corr_result['spearman_r']:.3f} "
        f"(p={corr_result['spearman_p']:.4f}). Strength: {corr_result['strength']}."
    )

    # 2. Temporal precedence
    temporal_result = check_temporal_precedence(
        db, var_x, var_y, start_date, end_date
    )
    temporal_score = temporal_result["temporal_score"]
    if temporal_result["best_lag"] > 0:
        evidence.append(
            f"Best temporal lag: {temporal_result['best_lag']} days "
            f"(correlation at lag: {temporal_result['best_correlation']:.3f}). "
            f"Changes in {var_x} precede changes in {var_y}."
        )
    else:
        evidence.append(
            f"No clear temporal precedence detected. {var_x} and {var_y} "
            f"appear to change simultaneously."
        )

    # 3. Isolation
    isolation_result = check_isolation(db, (start_date, end_date))
    isolation_score = isolation_result["isolation_score"]
    if isolation_result["change_count"] <= 1:
        evidence.append(
            f"Good isolation: only {isolation_result['change_count']} variable(s) changed "
            f"in the analysis period."
        )
    else:
        evidence.append(
            f"Poor isolation: {isolation_result['change_count']} variables changed "
            f"simultaneously ({', '.join(isolation_result['changed_variables'])}). "
            f"Hard to isolate the effect of {var_x}."
        )

    # 4. Saturation
    # Only compute saturation for spend-type variables
    spend_vars = {"brand_spend", "nonbrand_spend", "total_spend"}
    if var_x in spend_vars:
        saturation_result = check_saturation(x_series, y_series)
        saturation_score = saturation_result["saturation_score"]
        if saturation_result.get("error"):
            evidence.append(f"Saturation check: {saturation_result['error']}")
        else:
            evidence.append(
                f"Spend-response curve: R²={saturation_result['r_squared']:.3f}. "
                f"Current marginal return: {saturation_result.get('current_marginal_return', 0):.3f}. "
                f"Saturation point: ${saturation_result['saturation_point']:,.0f}. "
                f"Currently at {saturation_result['current_efficiency_pct']:.1f}% efficiency."
            )
    else:
        saturation_score = 0.5  # Neutral for non-spend variables
        evidence.append(
            f"Saturation analysis not applicable for non-spend variable '{var_x}'."
        )

    # 5. Demand dependency
    demand_result = check_demand_dependency(db, start_date, end_date)
    demand_dependency_score = demand_result["demand_dependency_score"]
    evidence.append(
        f"Demand dependency: {demand_result['interpretation']}"
    )

    # --- Overall confidence ---
    confidence = _compute_causality_confidence(
        correlation_strength, temporal_score, isolation_score,
        saturation_score, demand_dependency_score,
    )

    # Build explanation
    composite = (
        correlation_strength * 0.25
        + temporal_score * 0.20
        + isolation_score * 0.20
        + saturation_score * 0.15
        + (1.0 - demand_dependency_score) * 0.20
    )

    explanations = []
    if correlation_strength >= 0.5:
        explanations.append(
            f"Strong {('positive' if correlation_strength > 0 else 'negative')} correlation "
            f"({correlation_strength:.2f}) between {var_x} and {var_y}."
        )
    else:
        explanations.append(
            f"Weak correlation ({correlation_strength:.2f}) — insufficient statistical basis."
        )
    if temporal_score >= 0.5:
        explanations.append("Temporal precedence supports a causal direction.")
    else:
        explanations.append("Temporal evidence is weak or absent.")
    if isolation_score >= 0.5:
        explanations.append("Changes appear reasonably isolated from confounders.")
    else:
        explanations.append("Multiple variables changed simultaneously — confounding risk.")
    if saturation_score >= 0.3:
        explanations.append("Spend-response relationship suggests meaningful marginal impact.")
    else:
        explanations.append("Possible saturation — additional spend may not drive proportional returns.")
    if demand_dependency_score <= 0.5:
        explanations.append("Revenue appears to follow spend rather than just organic demand.")
    else:
        explanations.append("Revenue may be driven more by underlying demand than by ad spend.")

    explanation = " ".join(explanations)

    evidence = []
    evidence.append(f"Correlation: {correlation_strength:.3f}")
    evidence.append(f"Temporal score: {temporal_score:.3f}")
    evidence.append(f"Isolation score: {isolation_score:.3f}")
    evidence.append(f"Saturation score: {saturation_score:.3f}")
    evidence.append(f"Demand dependency: {demand_dependency_score:.3f}")
    evidence.append(f"Composite: {composite:.3f}")
    evidence.append(f"Verdict: {confidence} confidence")

    return {
        "correlation_strength": round(float(correlation_strength), 4),
        "temporal_score": round(float(temporal_score), 4),
        "isolation_score": round(float(isolation_score), 4),
        "saturation_score": round(float(saturation_score), 4),
        "demand_dependency_score": round(float(demand_dependency_score), 4),
        "overall_causality_confidence": confidence,
        "explanation": explanation,
        "evidence": evidence,
        "composite_score": round(float(composite), 4),
        "var_x": var_x,
        "var_y": var_y,
        "period": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
    }


def _compute_causality_confidence(
    correlation_strength: float,
    temporal_score: float,
    isolation_score: float,
    saturation_score: float,
    demand_dependency_score: float,
) -> str:
    """
    Compute overall causality confidence from component scores.

    Each score is 0-1. Higher = more evidence for causality, except
    demand_dependency_score where higher means revenue follows demand
    rather than spend (bad for causal claims about spend).

    Returns: "high", "medium", or "low"
    """
    # Weight the scores
    weights = {
        "correlation": 0.25,
        "temporal": 0.20,
        "isolation": 0.20,
        "saturation": 0.15,
        "demand": 0.20,
    }

    # For causality: high correlation + temporal precedence + good isolation
    # + not saturated + spend drives revenue (low demand dependency)
    # = strong causal evidence
    # Invert demand_dependency_score: low demand dependency = good for causality
    adjusted_demand = 1.0 - demand_dependency_score

    composite = (
        correlation_strength * weights["correlation"]
        + temporal_score * weights["temporal"]
        + isolation_score * weights["isolation"]
        + saturation_score * weights["saturation"]
        + adjusted_demand * weights["demand"]
    )

    if composite >= 0.65:
        confidence = "high"
    elif composite >= 0.40:
        confidence = "medium"
    else:
        confidence = "low"

    return confidence
