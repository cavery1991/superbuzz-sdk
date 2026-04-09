"""
Recommendation engine.

Produces actionable, evidence-based recommendations by synthesizing data
from the incrementality, causation, and pattern engines. Each recommendation
includes a clear action, rationale, expected effect, confidence level, risk
assessment, and supporting evidence.
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
    OrganicMetrics,
    ContextualData,
)
from app.engines.incrementality import (
    observational_analysis,
    proxy_incrementality,
)
from app.engines.causation import full_causal_analysis
from app.engines.patterns import (
    build_state,
    find_similar_states,
    summarize_similar_outcomes,
    _compute_distribution_breakpoints,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_recommendation(
    action: str,
    rationale: str,
    expected_effect: str,
    confidence: str,
    risk: str,
    evidence: list,
) -> dict:
    """Create a standardized recommendation dictionary."""
    return {
        "action": action,
        "rationale": rationale,
        "expected_effect": expected_effect,
        "confidence": confidence,
        "risk": risk,
        "evidence": evidence,
    }


def _get_recent_metrics(
    db: Session,
    days: int = 7,
    campaign_type: Optional[str] = None,
) -> dict:
    """Get aggregated metrics for the most recent N days."""
    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=days - 1)

    query = (
        db.query(
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.clicks).label("clicks"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
            func.sum(DailyMetrics.returning_customers).label("returning_customers"),
            func.sum(DailyMetrics.gross_margin).label("gross_margin"),
        )
        .join(Campaign, DailyMetrics.campaign_id == Campaign.id)
        .filter(DailyMetrics.date >= start_date, DailyMetrics.date <= end_date)
    )
    if campaign_type:
        query = query.filter(Campaign.campaign_type == campaign_type)

    row = query.first()
    if not row or row.cost is None:
        return {
            "cost": 0.0, "revenue": 0.0, "conversions": 0.0,
            "clicks": 0, "new_customers": 0, "returning_customers": 0,
            "gross_margin": 0.0, "days": days,
        }

    return {
        "cost": float(row.cost or 0),
        "revenue": float(row.revenue or 0),
        "conversions": float(row.conversions or 0),
        "clicks": int(row.clicks or 0),
        "new_customers": int(row.new_customers or 0),
        "returning_customers": int(row.returning_customers or 0),
        "gross_margin": float(row.gross_margin or 0),
        "days": days,
    }


def _get_current_state(db: Session) -> dict:
    """Build the current state for pattern matching (last 7 days average)."""
    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=6)

    total_metrics = _get_recent_metrics(db, 7)
    brand_metrics = _get_recent_metrics(db, 7, "brand")

    # Get latest contextual data
    ctx = (
        db.query(ContextualData)
        .filter(ContextualData.date <= end_date)
        .order_by(ContextualData.date.desc())
        .first()
    )

    breakpoints = _compute_distribution_breakpoints(db)

    avg_metrics = {
        "total_cost": total_metrics["cost"] / max(total_metrics["days"], 1),
        "total_clicks": total_metrics["clicks"] // max(total_metrics["days"], 1),
        "brand_cost": brand_metrics["cost"] / max(brand_metrics["days"], 1),
    }

    context = {
        "temperature_c": ctx.temperature_c if ctx else None,
        "is_promo": ctx.is_promo if ctx else False,
    }

    return build_state(end_date, avg_metrics, context, breakpoints)


# ---------------------------------------------------------------------------
# Individual recommendation generators
# ---------------------------------------------------------------------------

def _recommend_reduce_brand_spend(
    db: Session,
    obs: dict,
    proxy: dict,
) -> Optional[dict]:
    """Recommend reducing brand spend when cannibalization is high."""
    cannibalization = proxy.get("cannibalization_estimate", 0)
    brand_dep = proxy.get("brand_dependence_score", 0)

    if cannibalization <= 0.3:
        return None

    brand_metrics = obs.get("brand_metrics", {})
    brand_spend = brand_metrics.get("total_spend", 0)
    brand_roas = brand_metrics.get("roas", 0)

    # Suggest reduction proportional to cannibalization estimate
    reduction_pct = min(30, int(cannibalization * 40))

    return _make_recommendation(
        action=f"Reduce brand campaign spend by {reduction_pct}%",
        rationale=(
            f"Cannibalization estimate is {cannibalization:.0%}, indicating "
            f"paid brand ads are capturing traffic that would arrive organically. "
            f"Brand dependence score: {brand_dep:.2f}."
        ),
        expected_effect=(
            f"Savings of ~${brand_spend * reduction_pct / 100:,.0f} per period. "
            f"Revenue impact expected to be minimal if organic absorbs the traffic. "
            f"Monitor organic brand sessions closely."
        ),
        confidence="high" if cannibalization > 0.5 else "medium",
        risk=(
            "If organic does not absorb lost paid traffic, revenue may decline. "
            "Recommend a phased reduction with close monitoring."
        ),
        evidence=[
            f"Cannibalization estimate: {cannibalization:.2%}",
            f"Brand dependence score: {brand_dep:.2f}",
            f"Current brand ROAS: {brand_roas:.2f}",
            f"Paid-organic correlation: {proxy.get('correlation_paid_organic', 0):.3f}",
        ],
    )


def _recommend_reallocate_to_nonbrand(
    db: Session,
    obs: dict,
    proxy: dict,
) -> Optional[dict]:
    """Recommend reallocating budget when nonbrand marginal ROAS exceeds brand."""
    brand_metrics = obs.get("brand_metrics", {})
    nonbrand_metrics = obs.get("nonbrand_metrics", {})

    brand_roas = brand_metrics.get("roas", 0)
    nonbrand_roas = nonbrand_metrics.get("roas", 0)
    marginal_roas = proxy.get("marginal_roas", 0)

    if nonbrand_roas <= brand_roas or nonbrand_roas <= 0:
        return None

    brand_spend = brand_metrics.get("total_spend", 0)
    nonbrand_spend = nonbrand_metrics.get("total_spend", 0)
    total_spend = brand_spend + nonbrand_spend

    if total_spend == 0:
        return None

    brand_share = brand_spend / total_spend * 100

    return _make_recommendation(
        action=(
            f"Reallocate 10-20% of brand budget to non-brand campaigns"
        ),
        rationale=(
            f"Non-brand ROAS ({nonbrand_roas:.2f}) exceeds brand ROAS "
            f"({brand_roas:.2f}). Non-brand campaigns are also more likely "
            f"to drive incremental new customer acquisition. "
            f"Current brand spend share: {brand_share:.1f}%."
        ),
        expected_effect=(
            f"With marginal ROAS of {marginal_roas:.2f}, shifting "
            f"${brand_spend * 0.15:,.0f} to non-brand could yield "
            f"~${brand_spend * 0.15 * max(nonbrand_roas - brand_roas, 0):,.0f} "
            f"in incremental revenue."
        ),
        confidence="medium",
        risk=(
            "Brand traffic may decline if organic cannot fully compensate. "
            "Non-brand may have higher variance and could underperform."
        ),
        evidence=[
            f"Brand ROAS: {brand_roas:.2f}",
            f"Non-brand ROAS: {nonbrand_roas:.2f}",
            f"Marginal ROAS: {marginal_roas:.2f}",
            f"Brand spend share: {brand_share:.1f}%",
            f"Non-brand new customer %: {nonbrand_metrics.get('new_customer_pct', 0):.1f}%",
        ],
    )


def _recommend_hold_spend(
    db: Session,
    obs: dict,
    causal: dict,
) -> Optional[dict]:
    """Recommend holding spend flat when uncertainty is high."""
    confidence = causal.get("overall_causality_confidence", "low")
    composite = causal.get("composite_score", 0)

    if confidence != "low":
        return None

    return _make_recommendation(
        action="Hold total ad spend flat until causal evidence improves",
        rationale=(
            f"Causal confidence between spend and revenue is {confidence} "
            f"(composite score: {composite:.2f}). Without clearer evidence "
            f"that spend drives incremental revenue, changes in either "
            f"direction carry unquantified risk."
        ),
        expected_effect=(
            "Revenue should remain stable. Use the hold period to gather "
            "data for better analysis."
        ),
        confidence="medium",
        risk=(
            "May miss growth opportunities if spend is actually driving "
            "incremental revenue. However, the risk of wasted spend is "
            "currently higher."
        ),
        evidence=[
            f"Causal confidence: {confidence}",
            f"Composite causal score: {composite:.2f}",
            f"Correlation strength: {causal.get('correlation_strength', 0):.3f}",
            f"Temporal score: {causal.get('temporal_score', 0):.3f}",
            f"Isolation score: {causal.get('isolation_score', 0):.3f}",
        ],
    )


def _recommend_holdout_test(
    db: Session,
    obs: dict,
    causal: dict,
    proxy: dict,
) -> Optional[dict]:
    """Recommend running a holdout test when causal confidence is low."""
    confidence = causal.get("overall_causality_confidence", "low")
    cannibalization = proxy.get("cannibalization_estimate", 0)

    if confidence == "high":
        return None

    brand_spend = obs.get("brand_metrics", {}).get("total_spend", 0)

    return _make_recommendation(
        action="Run a brand holdout experiment (geo or time-based)",
        rationale=(
            f"Causal confidence is '{confidence}' and cannibalization "
            f"estimate is {cannibalization:.0%}. A controlled holdout "
            f"experiment would provide direct evidence of brand spend "
            f"incrementality."
        ),
        expected_effect=(
            "A 2-4 week geo holdout test would establish the true "
            "incremental value of brand spend with high statistical "
            "confidence, enabling data-driven budget optimization."
        ),
        confidence="high",  # High confidence in the recommendation itself
        risk=(
            "Revenue may temporarily decline in holdout regions/periods. "
            "Ensure test regions are representative and the test duration "
            "is sufficient for statistical power."
        ),
        evidence=[
            f"Current causal confidence: {confidence}",
            f"Cannibalization estimate: {cannibalization:.0%}",
            f"Brand spend at stake: ${brand_spend:,.0f}",
            "Holdout tests are the gold standard for incrementality measurement",
        ],
    )


def _recommend_weather_investigation(
    db: Session,
) -> Optional[dict]:
    """Recommend investigating weather-sensitive categories."""
    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=29)

    ctx_rows = (
        db.query(ContextualData)
        .filter(
            ContextualData.date >= start_date,
            ContextualData.date <= end_date,
            ContextualData.temperature_c.isnot(None),
        )
        .all()
    )

    if len(ctx_rows) < 14:
        return None

    # Quick correlation check
    from app.engines.causation import _fetch_analysis_dataframe

    df = _fetch_analysis_dataframe(db, start_date, end_date)
    if df.empty or "temperature" not in df.columns or df["temperature"].isna().all():
        return None

    temp = df["temperature"].dropna().values
    if len(temp) < 14:
        return None

    rev = df.loc[df["temperature"].notna(), "total_revenue"].values
    if len(rev) != len(temp) or np.std(temp) == 0 or np.std(rev) == 0:
        return None

    from scipy import stats as scipy_stats
    corr, p_val = scipy_stats.pearsonr(temp, rev)

    if abs(corr) > 0.25:
        return _make_recommendation(
            action="Investigate weather-sensitive product categories",
            rationale=(
                f"Temperature correlates with revenue at r={corr:.2f} "
                f"(p={p_val:.3f}). Certain product categories may be "
                f"weather-dependent."
            ),
            expected_effect=(
                "Identifying weather-sensitive categories could enable "
                "proactive bid adjustments and inventory planning, "
                "improving ROAS by 5-15%."
            ),
            confidence="low",
            risk="Correlation may be coincidental or driven by seasonality rather than weather.",
            evidence=[
                f"Temperature-revenue correlation: {corr:.3f}",
                f"P-value: {p_val:.4f}",
                f"Data points: {len(temp)}",
            ],
        )
    return None


def _recommend_increase_spend(
    db: Session,
    obs: dict,
    proxy: dict,
    causal: dict,
) -> Optional[dict]:
    """Recommend increasing spend when within safe efficiency range."""
    marginal_roas = proxy.get("marginal_roas", 0)
    threshold = proxy.get("diminishing_returns_threshold", 0)
    causal_confidence = causal.get("overall_causality_confidence", "low")

    if marginal_roas <= 1.5 or causal_confidence == "low":
        return None

    total_metrics = obs.get("nonbrand_metrics", {})
    current_spend = total_metrics.get("avg_daily_spend", 0)

    if threshold > 0 and current_spend >= threshold * 0.9:
        return None  # Too close to diminishing returns

    # Suggest a modest increase
    increase_pct = 10 if causal_confidence == "medium" else 20

    return _make_recommendation(
        action=f"Increase non-brand spend by {increase_pct}%",
        rationale=(
            f"Marginal ROAS is {marginal_roas:.2f} (above break-even) and "
            f"current spend is {'well ' if threshold > 0 and current_spend < threshold * 0.7 else ''}"
            f"below the diminishing returns threshold"
            f"{f' (${threshold:,.0f}/day)' if threshold > 0 else ''}. "
            f"Causal confidence is '{causal_confidence}'."
        ),
        expected_effect=(
            f"A {increase_pct}% spend increase (~${current_spend * increase_pct / 100:,.0f}/day) "
            f"at marginal ROAS of {marginal_roas:.2f} should generate "
            f"~${current_spend * increase_pct / 100 * marginal_roas:,.0f}/day in incremental revenue."
        ),
        confidence=causal_confidence,
        risk=(
            "Marginal returns may decline faster than predicted. "
            "Increase gradually and monitor daily ROAS closely."
        ),
        evidence=[
            f"Marginal ROAS: {marginal_roas:.2f}",
            f"Diminishing returns threshold: ${threshold:,.0f}/day" if threshold > 0 else "Threshold not calculable",
            f"Current avg daily spend: ${current_spend:,.0f}",
            f"Causal confidence: {causal_confidence}",
        ],
    )


def _recommend_avoid_scaling(
    db: Session,
    proxy: dict,
) -> Optional[dict]:
    """Warn against scaling spend above the marginal threshold."""
    marginal_roas = proxy.get("marginal_roas", 0)
    threshold = proxy.get("diminishing_returns_threshold", 0)

    if marginal_roas >= 1.0 or threshold == 0:
        return None

    return _make_recommendation(
        action="Avoid increasing total ad spend above current levels",
        rationale=(
            f"Marginal ROAS has dropped to {marginal_roas:.2f}, which is "
            f"below break-even. The diminishing returns threshold is "
            f"approximately ${threshold:,.0f}/day."
        ),
        expected_effect=(
            "Any additional spend is expected to generate less than "
            "$1 in revenue per $1 spent. Reducing spend to the threshold "
            "level could save budget without significant revenue loss."
        ),
        confidence="high" if marginal_roas < 0.5 else "medium",
        risk=(
            "The spend-response model may be imprecise. Rapid cuts could "
            "cause temporary revenue dips from algorithmic re-learning."
        ),
        evidence=[
            f"Marginal ROAS: {marginal_roas:.2f}",
            f"Diminishing returns threshold: ${threshold:,.0f}/day",
            f"Spend-response curve R-squared: {proxy.get('analysis_details', {}).get('curve_r_squared', 'N/A')}",
        ],
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_recommendations(db: Session) -> list[dict]:
    """
    Produce actionable recommendations based on current data state.

    Synthesizes data from the incrementality, causation, and pattern engines
    to generate a prioritized list of recommendations.

    Args:
        db: SQLAlchemy session.

    Returns:
        List of recommendation dicts, each with: action, rationale,
        expected_effect, confidence, risk, evidence.
    """
    today = date.today()
    end_date = today - timedelta(days=1)
    start_date = end_date - timedelta(days=29)  # 30-day window

    recommendations = []

    # Gather analysis results
    try:
        obs = observational_analysis(db, start_date, end_date)
    except Exception as e:
        logger.error("Observational analysis failed: %s", str(e), exc_info=True)
        obs = {"brand_metrics": {}, "nonbrand_metrics": {}, "comparison": {}}

    try:
        proxy = proxy_incrementality(db, start_date, end_date)
    except Exception as e:
        logger.error("Proxy incrementality failed: %s", str(e), exc_info=True)
        proxy = {
            "cannibalization_estimate": 0,
            "marginal_roas": 0,
            "diminishing_returns_threshold": 0,
            "brand_dependence_score": 0,
            "analysis_details": {},
        }

    try:
        causal = full_causal_analysis(
            db, "total_spend", "total_revenue", start_date, end_date
        )
    except Exception as e:
        logger.error("Causal analysis failed: %s", str(e), exc_info=True)
        causal = {
            "overall_causality_confidence": "low",
            "composite_score": 0,
            "correlation_strength": 0,
            "temporal_score": 0,
            "isolation_score": 0,
        }

    # Generate each type of recommendation
    generators = [
        lambda: _recommend_reduce_brand_spend(db, obs, proxy),
        lambda: _recommend_reallocate_to_nonbrand(db, obs, proxy),
        lambda: _recommend_hold_spend(db, obs, causal),
        lambda: _recommend_holdout_test(db, obs, causal, proxy),
        lambda: _recommend_weather_investigation(db),
        lambda: _recommend_increase_spend(db, obs, proxy, causal),
        lambda: _recommend_avoid_scaling(db, proxy),
    ]

    for generator in generators:
        try:
            rec = generator()
            if rec is not None:
                recommendations.append(rec)
        except Exception as e:
            logger.error("Recommendation generator failed: %s", str(e), exc_info=True)

    # Resolve conflicting recommendations
    recommendations = _resolve_conflicts(recommendations)

    # Sort by confidence
    confidence_order = {"high": 0, "medium": 1, "low": 2}
    recommendations.sort(key=lambda r: confidence_order.get(r["confidence"], 3))

    logger.info("Generated %d recommendations", len(recommendations))

    return recommendations


def _resolve_conflicts(recommendations: list[dict]) -> list[dict]:
    """
    Remove or de-prioritize conflicting recommendations.

    For example, 'increase spend' and 'hold spend flat' cannot both apply.
    """
    actions = {r["action"]: r for r in recommendations}
    resolved = list(recommendations)

    # If both 'increase spend' and 'hold spend flat' are present,
    # keep the one with higher confidence
    increase_recs = [r for r in resolved if "Increase" in r["action"]]
    hold_recs = [r for r in resolved if "Hold" in r["action"]]

    if increase_recs and hold_recs:
        increase_conf = increase_recs[0]["confidence"]
        hold_conf = hold_recs[0]["confidence"]
        conf_rank = {"high": 0, "medium": 1, "low": 2}
        if conf_rank.get(hold_conf, 3) <= conf_rank.get(increase_conf, 3):
            # Remove increase recommendation
            resolved = [r for r in resolved if "Increase" not in r["action"]]
        else:
            resolved = [r for r in resolved if "Hold" not in r["action"]]

    # If both 'increase spend' and 'avoid scaling' are present, keep 'avoid scaling'
    increase_recs = [r for r in resolved if "Increase" in r["action"]]
    avoid_recs = [r for r in resolved if "Avoid" in r["action"]]
    if increase_recs and avoid_recs:
        resolved = [r for r in resolved if "Increase" not in r["action"]]

    return resolved
