"""
Incrementality analysis engine with three levels of sophistication.

Level 1 - Observational: Compare brand vs nonbrand metrics.
Level 2 - Proxy Incrementality: Estimate cannibalization and spend-response curves.
Level 3 - Experiment Support: Calculate lift from holdout experiments.
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
    Experiment,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_daily_by_type(
    db: Session,
    start_date: date,
    end_date: date,
    campaign_type: Optional[str] = None,
) -> pd.DataFrame:
    """Fetch daily metrics aggregated by date, optionally filtered by campaign type."""
    query = (
        db.query(
            DailyMetrics.date,
            func.sum(DailyMetrics.impressions).label("impressions"),
            func.sum(DailyMetrics.clicks).label("clicks"),
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
            func.sum(DailyMetrics.returning_customers).label("returning_customers"),
            func.sum(DailyMetrics.orders).label("orders"),
            func.sum(DailyMetrics.cogs).label("cogs"),
            func.sum(DailyMetrics.gross_margin).label("gross_margin"),
        )
        .join(Campaign, DailyMetrics.campaign_id == Campaign.id)
        .filter(DailyMetrics.date >= start_date, DailyMetrics.date <= end_date)
    )
    if campaign_type:
        query = query.filter(Campaign.campaign_type == campaign_type)
    query = query.group_by(DailyMetrics.date).order_by(DailyMetrics.date)

    rows = query.all()
    if not rows:
        return pd.DataFrame()

    columns = [
        "date", "impressions", "clicks", "cost", "conversions", "revenue",
        "new_customers", "returning_customers", "orders", "cogs", "gross_margin",
    ]
    df = pd.DataFrame(rows, columns=columns)
    df["date"] = pd.to_datetime(df["date"])
    for col in columns[1:]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df


def _compute_aggregate_metrics(df: pd.DataFrame) -> dict:
    """Compute aggregate KPIs from a daily metrics DataFrame."""
    if df.empty:
        return {
            "total_spend": 0.0,
            "total_revenue": 0.0,
            "total_conversions": 0.0,
            "total_orders": 0,
            "total_new_customers": 0,
            "total_returning_customers": 0,
            "total_gross_margin": 0.0,
            "roas": 0.0,
            "cpa": 0.0,
            "new_customer_pct": 0.0,
            "contribution_margin": 0.0,
            "avg_daily_spend": 0.0,
            "avg_daily_revenue": 0.0,
        }

    total_spend = float(df["cost"].sum())
    total_revenue = float(df["revenue"].sum())
    total_conversions = float(df["conversions"].sum())
    total_orders = int(df["orders"].sum())
    total_new = int(df["new_customers"].sum())
    total_returning = int(df["returning_customers"].sum())
    total_gross_margin = float(df["gross_margin"].sum())
    total_customers = total_new + total_returning

    return {
        "total_spend": round(total_spend, 2),
        "total_revenue": round(total_revenue, 2),
        "total_conversions": round(total_conversions, 2),
        "total_orders": total_orders,
        "total_new_customers": total_new,
        "total_returning_customers": total_returning,
        "total_gross_margin": round(total_gross_margin, 2),
        "roas": round(total_revenue / total_spend, 4) if total_spend > 0 else 0.0,
        "cpa": round(total_spend / total_conversions, 2) if total_conversions > 0 else 0.0,
        "new_customer_pct": round(total_new / total_customers * 100, 2) if total_customers > 0 else 0.0,
        "contribution_margin": round(total_gross_margin - total_spend, 2),
        "avg_daily_spend": round(total_spend / len(df), 2) if len(df) > 0 else 0.0,
        "avg_daily_revenue": round(total_revenue / len(df), 2) if len(df) > 0 else 0.0,
    }


def _compute_weekly_rolling(df: pd.DataFrame) -> list[dict]:
    """Compute 7-day rolling averages for key metrics."""
    if df.empty or len(df) < 7:
        return []

    df_sorted = df.sort_values("date").copy()
    rolling = df_sorted[["cost", "revenue", "conversions", "new_customers"]].rolling(7).mean()
    df_sorted["rolling_spend"] = rolling["cost"]
    df_sorted["rolling_revenue"] = rolling["revenue"]
    df_sorted["rolling_conversions"] = rolling["conversions"]
    df_sorted["rolling_new_customers"] = rolling["new_customers"]
    df_sorted["rolling_roas"] = np.where(
        df_sorted["rolling_spend"] > 0,
        df_sorted["rolling_revenue"] / df_sorted["rolling_spend"],
        0.0,
    )

    # Drop rows where rolling is NaN (first 6 rows)
    valid = df_sorted.dropna(subset=["rolling_spend"])
    trends = []
    for _, row in valid.iterrows():
        trends.append({
            "date": row["date"].strftime("%Y-%m-%d"),
            "rolling_spend": round(float(row["rolling_spend"]), 2),
            "rolling_revenue": round(float(row["rolling_revenue"]), 2),
            "rolling_conversions": round(float(row["rolling_conversions"]), 2),
            "rolling_new_customers": round(float(row["rolling_new_customers"]), 2),
            "rolling_roas": round(float(row["rolling_roas"]), 4),
        })
    return trends


# ---------------------------------------------------------------------------
# Level 1: Observational Analysis
# ---------------------------------------------------------------------------

def observational_analysis(
    db: Session,
    start_date: date,
    end_date: date,
) -> dict:
    """
    Level 1 observational analysis comparing brand vs nonbrand performance.

    Computes aggregated metrics and weekly rolling trends for brand and
    nonbrand campaigns, plus an overall MER (Marketing Efficiency Ratio).

    Args:
        db: SQLAlchemy session.
        start_date: Analysis window start (inclusive).
        end_date: Analysis window end (inclusive).

    Returns:
        Dictionary with keys: brand_metrics, nonbrand_metrics, comparison,
        trends_brand, trends_nonbrand, mer, period.
    """
    brand_df = _fetch_daily_by_type(db, start_date, end_date, "brand")
    nonbrand_df = _fetch_daily_by_type(db, start_date, end_date, "nonbrand")
    all_df = _fetch_daily_by_type(db, start_date, end_date)

    brand_metrics = _compute_aggregate_metrics(brand_df)
    nonbrand_metrics = _compute_aggregate_metrics(nonbrand_df)
    all_metrics = _compute_aggregate_metrics(all_df)

    # MER = total revenue / total ad spend across all channels
    total_spend = all_metrics["total_spend"]
    total_revenue = all_metrics["total_revenue"]
    mer = round(total_revenue / total_spend, 4) if total_spend > 0 else 0.0

    # Comparison dict
    comparison = {
        "brand_spend_share_pct": round(
            brand_metrics["total_spend"] / total_spend * 100, 2
        ) if total_spend > 0 else 0.0,
        "nonbrand_spend_share_pct": round(
            nonbrand_metrics["total_spend"] / total_spend * 100, 2
        ) if total_spend > 0 else 0.0,
        "brand_revenue_share_pct": round(
            brand_metrics["total_revenue"] / total_revenue * 100, 2
        ) if total_revenue > 0 else 0.0,
        "nonbrand_revenue_share_pct": round(
            nonbrand_metrics["total_revenue"] / total_revenue * 100, 2
        ) if total_revenue > 0 else 0.0,
        "roas_difference": round(
            nonbrand_metrics["roas"] - brand_metrics["roas"], 4
        ),
        "cpa_difference": round(
            brand_metrics["cpa"] - nonbrand_metrics["cpa"], 2
        ),
        "brand_new_customer_pct": brand_metrics["new_customer_pct"],
        "nonbrand_new_customer_pct": nonbrand_metrics["new_customer_pct"],
    }

    return {
        "brand_metrics": brand_metrics,
        "nonbrand_metrics": nonbrand_metrics,
        "comparison": comparison,
        "trends_brand": _compute_weekly_rolling(brand_df),
        "trends_nonbrand": _compute_weekly_rolling(nonbrand_df),
        "mer": mer,
        "period": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "days": (end_date - start_date).days + 1,
        },
    }


# ---------------------------------------------------------------------------
# Level 2: Proxy Incrementality
# ---------------------------------------------------------------------------

def _log_curve(x: np.ndarray, a: float, b: float) -> np.ndarray:
    """Log regression model: revenue = a * ln(spend) + b."""
    return a * np.log(np.maximum(x, 1e-10)) + b


def proxy_incrementality(
    db: Session,
    start_date: date,
    end_date: date,
) -> dict:
    """
    Level 2 proxy incrementality analysis.

    Estimates cannibalization by comparing paid brand clicks with organic
    brand sessions, fits spend-response curves, and calculates marginal ROAS.

    Args:
        db: SQLAlchemy session.
        start_date: Analysis window start.
        end_date: Analysis window end.

    Returns:
        Dictionary with: cannibalization_estimate, spend_response_curve_params,
        marginal_roas, diminishing_returns_threshold, brand_dependence_score,
        correlation_paid_organic, analysis_details.
    """
    brand_df = _fetch_daily_by_type(db, start_date, end_date, "brand")
    nonbrand_df = _fetch_daily_by_type(db, start_date, end_date, "nonbrand")
    all_df = _fetch_daily_by_type(db, start_date, end_date)

    # Fetch organic metrics
    organic_rows = (
        db.query(OrganicMetrics)
        .filter(OrganicMetrics.date >= start_date, OrganicMetrics.date <= end_date)
        .all()
    )
    organic_df = pd.DataFrame(
        [
            {
                "date": pd.Timestamp(o.date),
                "brand_organic_sessions": o.brand_organic_sessions or 0,
                "nonbrand_organic_sessions": o.nonbrand_organic_sessions or 0,
                "organic_sessions": o.organic_sessions or 0,
                "organic_revenue": o.organic_revenue or 0.0,
            }
            for o in organic_rows
        ]
    ) if organic_rows else pd.DataFrame()

    result = {
        "cannibalization_estimate": 0.0,
        "spend_response_curve_params": {"a": 0.0, "b": 0.0},
        "marginal_roas": 0.0,
        "diminishing_returns_threshold": 0.0,
        "brand_dependence_score": 0.0,
        "correlation_paid_organic": 0.0,
        "analysis_details": {},
    }

    # --- Cannibalization estimate ---
    # Compare paid brand clicks with organic brand sessions.
    # If paid brand spend goes up and organic brand sessions go down,
    # cannibalization is occurring.
    if not brand_df.empty and not organic_df.empty:
        merged = pd.merge(
            brand_df[["date", "clicks", "cost"]].rename(
                columns={"clicks": "paid_brand_clicks", "cost": "paid_brand_spend"}
            ),
            organic_df[["date", "brand_organic_sessions"]],
            on="date",
            how="inner",
        )

        if len(merged) >= 7:
            # Correlation between paid brand spend and organic brand traffic
            corr, p_val = scipy_stats.pearsonr(
                merged["paid_brand_spend"].values,
                merged["brand_organic_sessions"].values,
            )
            result["correlation_paid_organic"] = round(float(corr), 4)

            # Negative correlation suggests cannibalization
            # Convert to 0-1 scale: -1 (full cannibalisation) -> 1.0, +1 (synergy) -> 0.0
            cannibalization = max(0.0, min(1.0, (-corr + 1) / 2))

            # Weight by volume: higher paid share = more potential cannibalization
            total_traffic = (
                merged["paid_brand_clicks"].sum()
                + merged["brand_organic_sessions"].sum()
            )
            paid_share = (
                merged["paid_brand_clicks"].sum() / total_traffic
                if total_traffic > 0
                else 0.0
            )
            result["cannibalization_estimate"] = round(
                float(cannibalization * paid_share + cannibalization * (1 - paid_share) * 0.5),
                4,
            )
            result["analysis_details"]["cannibalization_p_value"] = round(float(p_val), 6)
            result["analysis_details"]["paid_brand_share_of_brand_traffic"] = round(
                float(paid_share), 4
            )
        else:
            result["analysis_details"]["cannibalization_note"] = (
                "Insufficient overlapping data points for cannibalization analysis"
            )

    # --- Spend-response curve (log regression) ---
    # Fit: revenue = a * ln(spend) + b using all campaign data
    if not all_df.empty and len(all_df) >= 14:
        spend = all_df["cost"].values.astype(float)
        revenue = all_df["revenue"].values.astype(float)

        # Filter out zero-spend days for curve fitting
        mask = spend > 0
        if mask.sum() >= 10:
            x_fit = spend[mask]
            y_fit = revenue[mask]

            try:
                popt, pcov = curve_fit(
                    _log_curve,
                    x_fit,
                    y_fit,
                    p0=[y_fit.mean(), 0.0],
                    maxfev=5000,
                )
                a, b = float(popt[0]), float(popt[1])
                result["spend_response_curve_params"] = {
                    "a": round(a, 4),
                    "b": round(b, 4),
                }

                # Marginal ROAS at current average spend = d(revenue)/d(spend) = a/spend
                current_avg_spend = float(x_fit.mean())
                if current_avg_spend > 0:
                    marginal_roas = a / current_avg_spend
                    result["marginal_roas"] = round(float(marginal_roas), 4)

                # Diminishing returns threshold: where marginal ROAS drops below 1.0
                # a/spend = 1.0 => spend = a
                if a > 0:
                    result["diminishing_returns_threshold"] = round(float(a), 2)
                else:
                    result["diminishing_returns_threshold"] = 0.0

                # R-squared for fit quality
                y_pred = _log_curve(x_fit, a, b)
                ss_res = np.sum((y_fit - y_pred) ** 2)
                ss_tot = np.sum((y_fit - np.mean(y_fit)) ** 2)
                r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
                result["analysis_details"]["curve_r_squared"] = round(float(r_squared), 4)
                result["analysis_details"]["current_avg_daily_spend"] = round(
                    current_avg_spend, 2
                )

            except (RuntimeError, ValueError) as e:
                logger.warning("Spend-response curve fitting failed: %s", str(e))
                result["analysis_details"]["curve_fit_error"] = str(e)
    else:
        result["analysis_details"]["curve_note"] = (
            "Insufficient data for spend-response curve fitting (need >= 14 days)"
        )

    # --- Brand dependence score ---
    # How much of total revenue is attributable to brand campaigns?
    if not brand_df.empty and not all_df.empty:
        brand_rev = float(brand_df["revenue"].sum())
        total_rev = float(all_df["revenue"].sum())
        brand_spend = float(brand_df["cost"].sum())
        total_spend = float(all_df["cost"].sum())

        rev_dep = brand_rev / total_rev if total_rev > 0 else 0.0
        spend_dep = brand_spend / total_spend if total_spend > 0 else 0.0

        # Weighted score: if brand gets high revenue share but also high spend share,
        # the dependence is concerning
        result["brand_dependence_score"] = round(
            float(rev_dep * 0.4 + spend_dep * 0.3 + result["cannibalization_estimate"] * 0.3),
            4,
        )

    return result


# ---------------------------------------------------------------------------
# Level 3: Experiment Support
# ---------------------------------------------------------------------------

def calculate_experiment_results(
    db: Session,
    experiment_id: int,
) -> dict:
    """
    Calculate results for a holdout experiment by comparing treatment and
    control periods/geos.

    The experiment's config_json should contain:
    - treatment_campaign_ids: list of campaign IDs in the treatment group
    - control_campaign_ids: list of campaign IDs in the control group
    OR
    - treatment_period: {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}
    - control_period: {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}

    Args:
        db: SQLAlchemy session.
        experiment_id: The experiment ID.

    Returns:
        Dictionary with: lift_pct, confidence_interval, p_value, sample_size,
        is_significant, treatment_metrics, control_metrics, experiment_name.
    """
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        return {
            "error": f"Experiment {experiment_id} not found",
            "lift_pct": 0.0,
            "confidence_interval": [0.0, 0.0],
            "p_value": 1.0,
            "sample_size": 0,
            "is_significant": False,
        }

    if not experiment.start_date or not experiment.end_date:
        return {
            "error": "Experiment dates not configured",
            "lift_pct": 0.0,
            "confidence_interval": [0.0, 0.0],
            "p_value": 1.0,
            "sample_size": 0,
            "is_significant": False,
        }

    config = experiment.config_json or {}

    treatment_data = []
    control_data = []

    # --- Geo-based experiment (campaign IDs) ---
    if "treatment_campaign_ids" in config and "control_campaign_ids" in config:
        treatment_ids = config["treatment_campaign_ids"]
        control_ids = config["control_campaign_ids"]

        treatment_rows = (
            db.query(DailyMetrics)
            .filter(
                DailyMetrics.campaign_id.in_(treatment_ids),
                DailyMetrics.date >= experiment.start_date,
                DailyMetrics.date <= experiment.end_date,
            )
            .all()
        )
        control_rows = (
            db.query(DailyMetrics)
            .filter(
                DailyMetrics.campaign_id.in_(control_ids),
                DailyMetrics.date >= experiment.start_date,
                DailyMetrics.date <= experiment.end_date,
            )
            .all()
        )

        treatment_data = [float(r.revenue) for r in treatment_rows]
        control_data = [float(r.revenue) for r in control_rows]

    # --- Time-based experiment (pre/post periods) ---
    elif "treatment_period" in config and "control_period" in config:
        tp = config["treatment_period"]
        cp = config["control_period"]

        t_start = date.fromisoformat(tp["start"])
        t_end = date.fromisoformat(tp["end"])
        c_start = date.fromisoformat(cp["start"])
        c_end = date.fromisoformat(cp["end"])

        treatment_rows = (
            db.query(
                DailyMetrics.date,
                func.sum(DailyMetrics.revenue).label("revenue"),
            )
            .filter(DailyMetrics.date >= t_start, DailyMetrics.date <= t_end)
            .group_by(DailyMetrics.date)
            .all()
        )
        control_rows = (
            db.query(
                DailyMetrics.date,
                func.sum(DailyMetrics.revenue).label("revenue"),
            )
            .filter(DailyMetrics.date >= c_start, DailyMetrics.date <= c_end)
            .group_by(DailyMetrics.date)
            .all()
        )

        treatment_data = [float(r.revenue) for r in treatment_rows]
        control_data = [float(r.revenue) for r in control_rows]
    else:
        return {
            "error": "Experiment config missing treatment/control definitions",
            "lift_pct": 0.0,
            "confidence_interval": [0.0, 0.0],
            "p_value": 1.0,
            "sample_size": 0,
            "is_significant": False,
        }

    # --- Statistical comparison ---
    treatment_arr = np.array(treatment_data, dtype=float)
    control_arr = np.array(control_data, dtype=float)

    if len(treatment_arr) < 2 or len(control_arr) < 2:
        return {
            "error": "Insufficient data for statistical analysis (need >= 2 observations per group)",
            "lift_pct": 0.0,
            "confidence_interval": [0.0, 0.0],
            "p_value": 1.0,
            "sample_size": len(treatment_arr) + len(control_arr),
            "is_significant": False,
            "experiment_name": experiment.name,
        }

    treatment_mean = float(np.mean(treatment_arr))
    control_mean = float(np.mean(control_arr))

    # Lift percentage
    lift_pct = (
        (treatment_mean - control_mean) / control_mean * 100
        if control_mean != 0
        else 0.0
    )

    # Welch's t-test (does not assume equal variance)
    t_stat, p_value = scipy_stats.ttest_ind(treatment_arr, control_arr, equal_var=False)

    # Confidence interval for the difference in means
    diff = treatment_mean - control_mean
    treatment_se = float(np.std(treatment_arr, ddof=1) / np.sqrt(len(treatment_arr)))
    control_se = float(np.std(control_arr, ddof=1) / np.sqrt(len(control_arr)))
    se_diff = np.sqrt(treatment_se**2 + control_se**2)

    # 95% CI using t-distribution
    # Welch-Satterthwaite degrees of freedom
    if treatment_se**2 + control_se**2 > 0:
        df_num = (treatment_se**2 + control_se**2) ** 2
        df_den = (
            (treatment_se**4 / (len(treatment_arr) - 1) if len(treatment_arr) > 1 else 0)
            + (control_se**4 / (len(control_arr) - 1) if len(control_arr) > 1 else 0)
        )
        dof = df_num / df_den if df_den > 0 else min(len(treatment_arr), len(control_arr)) - 1
    else:
        dof = min(len(treatment_arr), len(control_arr)) - 1

    dof = max(dof, 1)
    t_crit = scipy_stats.t.ppf(0.975, dof)
    ci_lower = diff - t_crit * se_diff
    ci_upper = diff + t_crit * se_diff

    # Convert CI to percentage terms relative to control mean
    if control_mean != 0:
        ci_lower_pct = ci_lower / abs(control_mean) * 100
        ci_upper_pct = ci_upper / abs(control_mean) * 100
    else:
        ci_lower_pct = 0.0
        ci_upper_pct = 0.0

    is_significant = float(p_value) < 0.05

    return {
        "lift_pct": round(float(lift_pct), 4),
        "confidence_interval": [
            round(float(ci_lower_pct), 4),
            round(float(ci_upper_pct), 4),
        ],
        "p_value": round(float(p_value), 6),
        "sample_size": len(treatment_arr) + len(control_arr),
        "is_significant": is_significant,
        "treatment_metrics": {
            "mean_revenue": round(treatment_mean, 2),
            "std_revenue": round(float(np.std(treatment_arr, ddof=1)), 2),
            "n": len(treatment_arr),
        },
        "control_metrics": {
            "mean_revenue": round(control_mean, 2),
            "std_revenue": round(float(np.std(control_arr, ddof=1)), 2),
            "n": len(control_arr),
        },
        "experiment_name": experiment.name,
        "experiment_type": experiment.experiment_type,
        "t_statistic": round(float(t_stat), 4),
        "degrees_of_freedom": round(float(dof), 2),
    }
