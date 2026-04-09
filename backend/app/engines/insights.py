"""
Insight generation engine.

Analyzes recent PPC data and generates structured, human-readable insights
covering brand efficiency, non-brand growth, cannibalization, diminishing
returns, seasonality, weather patterns, promo effectiveness, and new
customer acquisition trends.
"""

import logging
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.campaign import (
    Campaign,
    DailyMetrics,
    OrganicMetrics,
    ContextualData,
    ShopifyOrder,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_pct_change(new_val: float, old_val: float) -> float:
    """Calculate percentage change, safe from division by zero."""
    if old_val == 0:
        return 0.0 if new_val == 0 else 100.0
    return (new_val - old_val) / abs(old_val) * 100


def _fetch_aggregated_daily(
    db: Session,
    start_date: date,
    end_date: date,
    campaign_type: Optional[str] = None,
) -> pd.DataFrame:
    """Fetch daily metrics aggregated by date, optionally by campaign type."""
    query = (
        db.query(
            DailyMetrics.date,
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
    )
    if campaign_type:
        query = query.filter(Campaign.campaign_type == campaign_type)
    query = query.group_by(DailyMetrics.date).order_by(DailyMetrics.date)

    rows = query.all()
    if not rows:
        return pd.DataFrame()

    columns = [
        "date", "cost", "revenue", "conversions", "clicks", "impressions",
        "new_customers", "returning_customers", "orders", "gross_margin",
    ]
    df = pd.DataFrame(rows, columns=columns)
    df["date"] = pd.to_datetime(df["date"])
    for col in columns[1:]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df


def _make_insight(
    title: str,
    body: str,
    interpretation: str,
    confidence: str,
    recommended_action: str,
    evidence: list,
    category: str,
) -> dict:
    """Create a standardized insight dictionary."""
    return {
        "title": title,
        "body": body,
        "interpretation": interpretation,
        "confidence": confidence,
        "recommended_action": recommended_action,
        "evidence": evidence,
        "category": category,
    }


# ---------------------------------------------------------------------------
# Individual insight generators
# ---------------------------------------------------------------------------

def _check_brand_efficiency(
    db: Session,
    recent_start: date,
    recent_end: date,
    prior_start: date,
    prior_end: date,
) -> Optional[dict]:
    """Check if brand spend is up but revenue is flat or declining."""
    recent_brand = _fetch_aggregated_daily(db, recent_start, recent_end, "brand")
    prior_brand = _fetch_aggregated_daily(db, prior_start, prior_end, "brand")

    if recent_brand.empty or prior_brand.empty:
        return None

    recent_spend = float(recent_brand["cost"].sum())
    prior_spend = float(prior_brand["cost"].sum())
    recent_rev = float(recent_brand["revenue"].sum())
    prior_rev = float(prior_brand["revenue"].sum())

    spend_change = _safe_pct_change(recent_spend, prior_spend)
    rev_change = _safe_pct_change(recent_rev, prior_rev)

    # Brand efficiency concern: spend up but revenue flat or down
    if spend_change > 10 and rev_change < 5:
        recent_roas = recent_rev / recent_spend if recent_spend > 0 else 0
        prior_roas = prior_rev / prior_spend if prior_spend > 0 else 0

        confidence = "high" if abs(spend_change) > 20 else "medium"

        return _make_insight(
            title="Brand Efficiency Declining",
            body=(
                f"Brand spend increased {spend_change:.1f}% "
                f"(${prior_spend:,.0f} -> ${recent_spend:,.0f}) but revenue "
                f"{'decreased' if rev_change < 0 else 'only grew'} {rev_change:.1f}% "
                f"(${prior_rev:,.0f} -> ${recent_rev:,.0f})."
            ),
            interpretation=(
                f"Brand ROAS dropped from {prior_roas:.2f} to {recent_roas:.2f}. "
                "Additional brand spend is generating diminishing returns, possibly "
                "because brand search traffic is inelastic to ad spend."
            ),
            confidence=confidence,
            recommended_action=(
                "Consider reducing brand spend by 10-20% and monitor whether "
                "organic brand traffic picks up the slack. If revenue holds, "
                "the freed budget can be reallocated to non-brand campaigns."
            ),
            evidence=[
                f"Brand spend change: {spend_change:+.1f}%",
                f"Brand revenue change: {rev_change:+.1f}%",
                f"ROAS: {prior_roas:.2f} -> {recent_roas:.2f}",
            ],
            category="brand_efficiency",
        )
    return None


def _check_nonbrand_growth(
    db: Session,
    recent_start: date,
    recent_end: date,
    prior_start: date,
    prior_end: date,
) -> Optional[dict]:
    """Check if nonbrand spend is up and new customers are growing."""
    recent_nb = _fetch_aggregated_daily(db, recent_start, recent_end, "nonbrand")
    prior_nb = _fetch_aggregated_daily(db, prior_start, prior_end, "nonbrand")

    if recent_nb.empty or prior_nb.empty:
        return None

    recent_spend = float(recent_nb["cost"].sum())
    prior_spend = float(prior_nb["cost"].sum())
    recent_nc = int(recent_nb["new_customers"].sum())
    prior_nc = int(prior_nb["new_customers"].sum())
    recent_rev = float(recent_nb["revenue"].sum())

    spend_change = _safe_pct_change(recent_spend, prior_spend)
    nc_change = _safe_pct_change(float(recent_nc), float(prior_nc))

    if spend_change > 5 and nc_change > 5:
        cpa = recent_spend / recent_nc if recent_nc > 0 else 0
        roas = recent_rev / recent_spend if recent_spend > 0 else 0

        return _make_insight(
            title="Non-Brand Growth Signal Detected",
            body=(
                f"Non-brand spend grew {spend_change:.1f}% and new customer "
                f"acquisitions grew {nc_change:.1f}% ({prior_nc} -> {recent_nc})."
            ),
            interpretation=(
                "Non-brand campaigns are efficiently acquiring new customers. "
                f"Current non-brand CPA is ${cpa:,.0f} with ROAS of {roas:.2f}. "
                "This is a healthy signal for incremental growth."
            ),
            confidence="high" if nc_change > 15 else "medium",
            recommended_action=(
                "Continue scaling non-brand spend while monitoring CPA. "
                "Consider testing increased budgets in top-performing non-brand campaigns."
            ),
            evidence=[
                f"Non-brand spend change: {spend_change:+.1f}%",
                f"New customer change: {nc_change:+.1f}%",
                f"Non-brand CPA: ${cpa:,.0f}",
                f"Non-brand ROAS: {roas:.2f}",
            ],
            category="nonbrand_growth",
        )
    return None


def _check_cannibalization(
    db: Session,
    recent_start: date,
    recent_end: date,
    prior_start: date,
    prior_end: date,
) -> Optional[dict]:
    """Check if paid brand is up while organic brand is down (cannibalization)."""
    recent_brand = _fetch_aggregated_daily(db, recent_start, recent_end, "brand")
    prior_brand = _fetch_aggregated_daily(db, prior_start, prior_end, "brand")

    if recent_brand.empty or prior_brand.empty:
        return None

    recent_paid_clicks = int(recent_brand["clicks"].sum())
    prior_paid_clicks = int(prior_brand["clicks"].sum())
    paid_change = _safe_pct_change(float(recent_paid_clicks), float(prior_paid_clicks))

    # Check organic brand sessions
    recent_organic = (
        db.query(func.sum(OrganicMetrics.brand_organic_sessions))
        .filter(
            OrganicMetrics.date >= recent_start,
            OrganicMetrics.date <= recent_end,
        )
        .scalar()
    )
    prior_organic = (
        db.query(func.sum(OrganicMetrics.brand_organic_sessions))
        .filter(
            OrganicMetrics.date >= prior_start,
            OrganicMetrics.date <= prior_end,
        )
        .scalar()
    )

    recent_organic = int(recent_organic or 0)
    prior_organic = int(prior_organic or 0)

    if prior_organic == 0:
        return None

    organic_change = _safe_pct_change(float(recent_organic), float(prior_organic))

    # Cannibalization signal: paid brand up AND organic brand down
    if paid_change > 5 and organic_change < -5:
        return _make_insight(
            title="Brand Cannibalization Warning",
            body=(
                f"Paid brand clicks increased {paid_change:.1f}% while organic "
                f"brand sessions decreased {organic_change:.1f}% "
                f"({prior_organic:,} -> {recent_organic:,})."
            ),
            interpretation=(
                "Paid brand ads may be cannibalizing organic brand traffic. "
                "Users who would have clicked organic listings are instead "
                "clicking paid ads, increasing cost without incremental revenue."
            ),
            confidence="high" if (paid_change > 15 and organic_change < -10) else "medium",
            recommended_action=(
                "Run a brand holdout test: pause brand ads in a subset of "
                "geos or times and measure whether organic traffic absorbs the "
                "lost paid clicks. If total traffic holds, reduce brand spend."
            ),
            evidence=[
                f"Paid brand click change: {paid_change:+.1f}%",
                f"Organic brand session change: {organic_change:+.1f}%",
                f"Recent paid brand clicks: {recent_paid_clicks:,}",
                f"Recent organic brand sessions: {recent_organic:,}",
            ],
            category="cannibalization",
        )
    return None


def _check_diminishing_returns(
    db: Session,
    recent_start: date,
    recent_end: date,
) -> Optional[dict]:
    """Check if marginal ROAS is declining over the lookback window."""
    df = _fetch_aggregated_daily(db, recent_start, recent_end)
    if df.empty or len(df) < 14:
        return None

    df_sorted = df.sort_values("date")

    # Split into halves
    mid = len(df_sorted) // 2
    first_half = df_sorted.iloc[:mid]
    second_half = df_sorted.iloc[mid:]

    first_spend = float(first_half["cost"].sum())
    first_rev = float(first_half["revenue"].sum())
    second_spend = float(second_half["cost"].sum())
    second_rev = float(second_half["revenue"].sum())

    first_roas = first_rev / first_spend if first_spend > 0 else 0
    second_roas = second_rev / second_spend if second_spend > 0 else 0

    # Marginal ROAS of the second half relative to the first
    spend_delta = second_spend - first_spend
    rev_delta = second_rev - first_rev
    marginal_roas = rev_delta / spend_delta if spend_delta > 0 else 0

    if second_roas < first_roas * 0.85 and first_roas > 0:
        return _make_insight(
            title="Diminishing Returns Alert",
            body=(
                f"ROAS declined from {first_roas:.2f} in the first half "
                f"to {second_roas:.2f} in the second half of the analysis period. "
                f"Marginal ROAS on incremental spend: {marginal_roas:.2f}."
            ),
            interpretation=(
                "Increasing spend is yielding progressively lower returns. "
                "The spend-response curve appears to be flattening, "
                "suggesting the current spend level may be approaching or "
                "exceeding the point of diminishing returns."
            ),
            confidence="high" if second_roas < first_roas * 0.7 else "medium",
            recommended_action=(
                "Identify the highest marginal-return campaigns and concentrate budget there. "
                "Consider reducing total spend by 10-15% to test whether revenue holds."
            ),
            evidence=[
                f"First half ROAS: {first_roas:.2f}",
                f"Second half ROAS: {second_roas:.2f}",
                f"Marginal ROAS on incremental spend: {marginal_roas:.2f}",
                f"First half spend: ${first_spend:,.0f}",
                f"Second half spend: ${second_spend:,.0f}",
            ],
            category="diminishing_returns",
        )
    return None


def _check_seasonality(
    db: Session,
    recent_start: date,
    recent_end: date,
) -> Optional[dict]:
    """Check if performance differs from the same period last year."""
    # Same period last year
    yoy_start = recent_start.replace(year=recent_start.year - 1)
    yoy_end = recent_end.replace(year=recent_end.year - 1)

    recent_df = _fetch_aggregated_daily(db, recent_start, recent_end)
    yoy_df = _fetch_aggregated_daily(db, yoy_start, yoy_end)

    if recent_df.empty or yoy_df.empty:
        return None

    recent_rev = float(recent_df["revenue"].sum())
    yoy_rev = float(yoy_df["revenue"].sum())
    recent_spend = float(recent_df["cost"].sum())
    yoy_spend = float(yoy_df["cost"].sum())

    rev_change = _safe_pct_change(recent_rev, yoy_rev)
    spend_change = _safe_pct_change(recent_spend, yoy_spend)

    if abs(rev_change) > 15:
        direction = "above" if rev_change > 0 else "below"
        return _make_insight(
            title="Seasonal Performance Deviation",
            body=(
                f"Revenue is {abs(rev_change):.1f}% {direction} the same period "
                f"last year (${yoy_rev:,.0f} -> ${recent_rev:,.0f}). "
                f"Spend changed {spend_change:+.1f}%."
            ),
            interpretation=(
                f"{'Strong seasonal tailwind detected.' if rev_change > 0 else 'Seasonal headwind or market shift detected.'} "
                f"This should be factored into performance benchmarks and spend planning."
            ),
            confidence="medium",
            recommended_action=(
                f"{'Consider scaling spend to capitalize on seasonal demand.' if rev_change > 15 else 'Review whether lower performance is seasonal or structural. Adjust targets accordingly.'}"
            ),
            evidence=[
                f"YoY revenue change: {rev_change:+.1f}%",
                f"YoY spend change: {spend_change:+.1f}%",
                f"Current period: {recent_start} to {recent_end}",
                f"Comparison period: {yoy_start} to {yoy_end}",
            ],
            category="seasonality",
        )
    return None


def _check_weather_patterns(
    db: Session,
    recent_start: date,
    recent_end: date,
) -> Optional[dict]:
    """Check if weather conditions correlate with performance changes."""
    df = _fetch_aggregated_daily(db, recent_start, recent_end)
    if df.empty:
        return None

    # Fetch contextual data for the period
    ctx_rows = (
        db.query(ContextualData)
        .filter(
            ContextualData.date >= recent_start,
            ContextualData.date <= recent_end,
            ContextualData.temperature_c.isnot(None),
        )
        .all()
    )

    if len(ctx_rows) < 7:
        return None

    ctx_df = pd.DataFrame(
        [{"date": pd.Timestamp(c.date), "temperature_c": float(c.temperature_c)} for c in ctx_rows]
    )
    merged = pd.merge(df, ctx_df, on="date", how="inner")
    if len(merged) < 7:
        return None

    # Calculate conversion rate
    merged["cvr"] = np.where(
        merged["clicks"] > 0,
        merged["conversions"] / merged["clicks"],
        0.0,
    )

    temp = merged["temperature_c"].values.astype(float)
    cvr = merged["cvr"].values.astype(float)

    if np.std(temp) == 0 or np.std(cvr) == 0:
        return None

    corr, p_val = scipy_stats.pearsonr(temp, cvr)

    if abs(corr) > 0.3 and p_val < 0.1:
        direction = "higher" if corr > 0 else "lower"
        return _make_insight(
            title="Weather-Correlated Performance Pattern",
            body=(
                f"Temperature and conversion rate show a {abs(corr):.2f} "
                f"{'positive' if corr > 0 else 'negative'} correlation "
                f"(p={p_val:.3f}). {direction.capitalize()} temperatures "
                f"are associated with {direction} conversion rates."
            ),
            interpretation=(
                "External weather conditions appear to influence purchase behavior. "
                "This may reflect product category sensitivity to weather "
                "(e.g., seasonal apparel, outdoor products)."
            ),
            confidence="medium" if p_val < 0.05 else "low",
            recommended_action=(
                "Consider weather-aware bid adjustments or creative strategies. "
                "Monitor whether this pattern holds across different seasons."
            ),
            evidence=[
                f"Temperature-CVR correlation: {corr:.3f}",
                f"P-value: {p_val:.4f}",
                f"Temperature range: {temp.min():.1f}C to {temp.max():.1f}C",
                f"CVR range: {cvr.min():.3f} to {cvr.max():.3f}",
            ],
            category="weather",
        )
    return None


def _check_promo_effectiveness(
    db: Session,
    recent_start: date,
    recent_end: date,
) -> Optional[dict]:
    """Check if promotions are effective by comparing promo vs non-promo days."""
    df = _fetch_aggregated_daily(db, recent_start, recent_end)
    if df.empty:
        return None

    ctx_rows = (
        db.query(ContextualData)
        .filter(
            ContextualData.date >= recent_start,
            ContextualData.date <= recent_end,
        )
        .all()
    )
    if not ctx_rows:
        return None

    ctx_df = pd.DataFrame(
        [{"date": pd.Timestamp(c.date), "is_promo": c.is_promo} for c in ctx_rows]
    )
    merged = pd.merge(df, ctx_df, on="date", how="inner")

    promo_days = merged[merged["is_promo"] == True]  # noqa: E712
    non_promo_days = merged[merged["is_promo"] == False]  # noqa: E712

    if len(promo_days) < 2 or len(non_promo_days) < 2:
        return None

    promo_rev_avg = float(promo_days["revenue"].mean())
    non_promo_rev_avg = float(non_promo_days["revenue"].mean())
    promo_cost_avg = float(promo_days["cost"].mean())
    non_promo_cost_avg = float(non_promo_days["cost"].mean())

    rev_lift = _safe_pct_change(promo_rev_avg, non_promo_rev_avg)
    cost_lift = _safe_pct_change(promo_cost_avg, non_promo_cost_avg)

    promo_roas = promo_rev_avg / promo_cost_avg if promo_cost_avg > 0 else 0
    non_promo_roas = non_promo_rev_avg / non_promo_cost_avg if non_promo_cost_avg > 0 else 0

    # Statistical test
    t_stat, p_val = scipy_stats.ttest_ind(
        promo_days["revenue"].values.astype(float),
        non_promo_days["revenue"].values.astype(float),
        equal_var=False,
    )

    if abs(rev_lift) > 10:
        effective = rev_lift > 0
        return _make_insight(
            title=f"Promo {'Effective' if effective else 'Underperforming'}",
            body=(
                f"Promo days averaged ${promo_rev_avg:,.0f} revenue vs "
                f"${non_promo_rev_avg:,.0f} on non-promo days "
                f"({rev_lift:+.1f}% lift, p={p_val:.3f})."
            ),
            interpretation=(
                f"{'Promotions are driving meaningful revenue lift.' if effective else 'Promotions are not generating enough lift to justify the cost.'} "
                f"Promo ROAS: {promo_roas:.2f} vs non-promo: {non_promo_roas:.2f}. "
                f"Spend also changed by {cost_lift:+.1f}% on promo days."
            ),
            confidence="high" if p_val < 0.05 else "medium" if p_val < 0.1 else "low",
            recommended_action=(
                f"{'Continue running promotions and consider increasing frequency.' if effective else 'Re-evaluate promotion strategy -- either increase discount depth or reduce promo spend.'}"
            ),
            evidence=[
                f"Promo days: {len(promo_days)}, Non-promo days: {len(non_promo_days)}",
                f"Revenue lift: {rev_lift:+.1f}%",
                f"Cost change on promo days: {cost_lift:+.1f}%",
                f"Statistical significance (p-value): {p_val:.4f}",
                f"Promo ROAS: {promo_roas:.2f}, Non-promo ROAS: {non_promo_roas:.2f}",
            ],
            category="promo_effectiveness",
        )
    return None


def _check_new_customer_trends(
    db: Session,
    recent_start: date,
    recent_end: date,
    prior_start: date,
    prior_end: date,
) -> Optional[dict]:
    """Check new customer acquisition trends."""
    recent_df = _fetch_aggregated_daily(db, recent_start, recent_end)
    prior_df = _fetch_aggregated_daily(db, prior_start, prior_end)

    if recent_df.empty or prior_df.empty:
        return None

    recent_nc = int(recent_df["new_customers"].sum())
    prior_nc = int(prior_df["new_customers"].sum())
    recent_total = recent_nc + int(recent_df["returning_customers"].sum())
    prior_total = prior_nc + int(prior_df["returning_customers"].sum())

    recent_nc_pct = (recent_nc / recent_total * 100) if recent_total > 0 else 0
    prior_nc_pct = (prior_nc / prior_total * 100) if prior_total > 0 else 0

    nc_count_change = _safe_pct_change(float(recent_nc), float(prior_nc))
    nc_pct_change = recent_nc_pct - prior_nc_pct

    if abs(nc_count_change) > 10 or abs(nc_pct_change) > 5:
        improving = nc_count_change > 0
        return _make_insight(
            title=f"New Customer Acquisition {'Growing' if improving else 'Declining'}",
            body=(
                f"New customers changed {nc_count_change:+.1f}% "
                f"({prior_nc:,} -> {recent_nc:,}). "
                f"New customer share: {prior_nc_pct:.1f}% -> {recent_nc_pct:.1f}%."
            ),
            interpretation=(
                f"{'The customer base is expanding healthily.' if improving else 'Reliance on returning customers is increasing, which may signal declining market reach.'}"
            ),
            confidence="high" if abs(nc_count_change) > 20 else "medium",
            recommended_action=(
                f"{'Sustain current acquisition strategy and consider LTV-based bid optimization.' if improving else 'Review non-brand and prospecting campaign performance. Consider increasing top-of-funnel spend.'}"
            ),
            evidence=[
                f"New customer count change: {nc_count_change:+.1f}%",
                f"New customer share change: {nc_pct_change:+.1f}pp",
                f"Recent new customers: {recent_nc:,}",
                f"Prior new customers: {prior_nc:,}",
            ],
            category="new_customer_acquisition",
        )
    return None


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_insights(
    db: Session,
    lookback_days: int = 30,
) -> list[dict]:
    """
    Analyze recent data and generate actionable insights.

    Each insight follows the structure:
    1. What changed (body)
    2. What happened next (interpretation)
    3. Confidence level (high/medium/low)
    4. Recommended action

    Args:
        db: SQLAlchemy session.
        lookback_days: Number of days to look back (default: 30).

    Returns:
        List of insight dicts, each with: title, body, interpretation,
        confidence, recommended_action, evidence, category.
    """
    today = date.today()
    recent_end = today - timedelta(days=1)  # Yesterday
    recent_start = recent_end - timedelta(days=lookback_days - 1)

    # Prior period for comparison (same length, immediately before)
    prior_end = recent_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=lookback_days - 1)

    insights = []

    # Run all insight generators
    generators = [
        lambda: _check_brand_efficiency(db, recent_start, recent_end, prior_start, prior_end),
        lambda: _check_nonbrand_growth(db, recent_start, recent_end, prior_start, prior_end),
        lambda: _check_cannibalization(db, recent_start, recent_end, prior_start, prior_end),
        lambda: _check_diminishing_returns(db, recent_start, recent_end),
        lambda: _check_seasonality(db, recent_start, recent_end),
        lambda: _check_weather_patterns(db, recent_start, recent_end),
        lambda: _check_promo_effectiveness(db, recent_start, recent_end),
        lambda: _check_new_customer_trends(db, recent_start, recent_end, prior_start, prior_end),
    ]

    for generator in generators:
        try:
            insight = generator()
            if insight is not None:
                insights.append(insight)
        except Exception as e:
            logger.error("Insight generator failed: %s", str(e), exc_info=True)

    # Sort by confidence: high first, then medium, then low
    confidence_order = {"high": 0, "medium": 1, "low": 2}
    insights.sort(key=lambda i: confidence_order.get(i["confidence"], 3))

    logger.info("Generated %d insights for lookback=%d days", len(insights), lookback_days)

    return insights
