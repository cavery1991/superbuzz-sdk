"""Insights routes for listing, generating, and dismissing insights."""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.database import get_db
from app.models.campaign import Insight, Campaign, DailyMetrics, OrganicMetrics
from app.schemas.campaign import InsightRead, InsightList

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("", response_model=InsightList)
def list_insights(
    category: Optional[str] = Query(None),
    confidence: Optional[str] = Query(None),
    include_dismissed: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List generated insights with optional filters."""
    q = db.query(Insight)

    if category:
        q = q.filter(Insight.category == category)
    if confidence:
        q = q.filter(Insight.confidence == confidence)
    if not include_dismissed:
        q = q.filter(Insight.is_dismissed == False)  # noqa: E712

    total = q.count()
    items = q.order_by(Insight.created_at.desc()).offset(skip).limit(limit).all()

    return InsightList(
        items=[InsightRead.model_validate(i) for i in items],
        total=total,
    )


@router.post("/generate")
def generate_insights(
    lookback_days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """
    Trigger insight generation based on recent data.

    Analyzes the last N days of data and generates actionable insights
    about brand efficiency, incrementality signals, and patterns.
    """
    from datetime import timedelta

    today = date.today()
    start_date = today - timedelta(days=lookback_days)

    generated = []

    # ── Insight 1: Brand efficiency analysis ──
    brand_metrics = (
        db.query(
            func.coalesce(func.sum(DailyMetrics.cost), 0).label("cost"),
            func.coalesce(func.sum(DailyMetrics.revenue), 0).label("revenue"),
            func.coalesce(func.sum(DailyMetrics.conversions), 0).label("conversions"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .filter(Campaign.campaign_type == "brand")
        .filter(DailyMetrics.date >= start_date)
        .one()
    )

    nonbrand_metrics = (
        db.query(
            func.coalesce(func.sum(DailyMetrics.cost), 0).label("cost"),
            func.coalesce(func.sum(DailyMetrics.revenue), 0).label("revenue"),
            func.coalesce(func.sum(DailyMetrics.conversions), 0).label("conversions"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .filter(Campaign.campaign_type == "nonbrand")
        .filter(DailyMetrics.date >= start_date)
        .one()
    )

    brand_cost = float(brand_metrics.cost)
    brand_rev = float(brand_metrics.revenue)
    nb_cost = float(nonbrand_metrics.cost)
    nb_rev = float(nonbrand_metrics.revenue)
    brand_roas = round(brand_rev / brand_cost, 2) if brand_cost > 0 else 0
    nb_roas = round(nb_rev / nb_cost, 2) if nb_cost > 0 else 0

    if brand_cost > 0 and nb_cost > 0:
        if brand_roas > nb_roas * 2:
            insight = Insight(
                date=today,
                category="brand_efficiency",
                title="Brand ROAS significantly exceeds nonbrand ROAS",
                body=(
                    f"Over the last {lookback_days} days, brand ROAS ({brand_roas}x) is more than "
                    f"2x nonbrand ROAS ({nb_roas}x). This may indicate brand campaigns are capturing "
                    f"demand that would convert organically."
                ),
                interpretation=(
                    "High brand ROAS relative to nonbrand often signals that brand campaigns are "
                    "capturing existing intent rather than creating new demand. Consider testing "
                    "a brand spend reduction to measure true incrementality."
                ),
                confidence="high",
                recommended_action="Run a geo-holdout experiment to measure brand incrementality.",
                evidence_json={
                    "brand_roas": brand_roas,
                    "nonbrand_roas": nb_roas,
                    "brand_cost": brand_cost,
                    "nonbrand_cost": nb_cost,
                    "lookback_days": lookback_days,
                },
            )
            db.add(insight)
            generated.append("brand_efficiency_high_roas")
        elif nb_roas > brand_roas * 1.5:
            insight = Insight(
                date=today,
                category="brand_efficiency",
                title="Nonbrand ROAS outperforming brand",
                body=(
                    f"Nonbrand ROAS ({nb_roas}x) is significantly higher than brand ROAS ({brand_roas}x). "
                    f"This is unusual and may indicate strong product-market fit for prospecting campaigns."
                ),
                interpretation=(
                    "When nonbrand outperforms brand, it often indicates the category or product "
                    "has strong pull-through demand. Consider increasing nonbrand budget."
                ),
                confidence="medium",
                recommended_action="Consider shifting budget from brand to nonbrand campaigns.",
                evidence_json={
                    "brand_roas": brand_roas,
                    "nonbrand_roas": nb_roas,
                    "lookback_days": lookback_days,
                },
            )
            db.add(insight)
            generated.append("brand_efficiency_nb_outperform")

    # ── Insight 2: Organic cannibalization signal ──
    organic_data = (
        db.query(
            func.coalesce(func.sum(OrganicMetrics.brand_organic_sessions), 0).label("brand_sessions"),
            func.coalesce(func.sum(OrganicMetrics.nonbrand_organic_sessions), 0).label("nb_sessions"),
            func.coalesce(func.sum(OrganicMetrics.organic_revenue), 0).label("organic_rev"),
        )
        .filter(OrganicMetrics.date >= start_date)
        .one()
    )

    brand_organic = int(organic_data.brand_sessions)
    organic_rev = float(organic_data.organic_rev)

    if brand_organic > 0 and brand_cost > 0:
        cost_per_organic_session = round(brand_cost / brand_organic, 2)
        if cost_per_organic_session < 1.0 and brand_organic > 100:
            insight = Insight(
                date=today,
                category="incrementality",
                title="Low brand paid cost relative to organic brand traffic",
                body=(
                    f"Brand paid spend (${brand_cost:,.0f}) yields a cost-per-organic-brand-session "
                    f"of ${cost_per_organic_session:.2f}, suggesting organic brand traffic is strong "
                    f"and paid may have limited incremental value."
                ),
                interpretation=(
                    "When organic brand traffic is large relative to paid brand spend, "
                    "the incremental lift from brand PPC is likely small."
                ),
                confidence="medium",
                recommended_action="Test reducing brand spend by 20-30% and monitor organic traffic.",
                evidence_json={
                    "brand_cost": brand_cost,
                    "brand_organic_sessions": brand_organic,
                    "cost_per_organic_session": cost_per_organic_session,
                },
            )
            db.add(insight)
            generated.append("incrementality_cannibalization")

    # ── Insight 3: Spend trend insight ──
    half = lookback_days // 2
    mid_date = today - timedelta(days=half)

    first_half = (
        db.query(func.coalesce(func.sum(DailyMetrics.cost), 0))
        .filter(DailyMetrics.date >= start_date, DailyMetrics.date < mid_date)
        .scalar()
    )
    second_half = (
        db.query(func.coalesce(func.sum(DailyMetrics.cost), 0))
        .filter(DailyMetrics.date >= mid_date, DailyMetrics.date <= today)
        .scalar()
    )

    first_half = float(first_half)
    second_half = float(second_half)

    if first_half > 0:
        change_pct = round((second_half - first_half) / first_half * 100, 1)
        if abs(change_pct) > 20:
            direction = "increased" if change_pct > 0 else "decreased"
            insight = Insight(
                date=today,
                category="pattern",
                title=f"Total ad spend {direction} by {abs(change_pct)}% in recent period",
                body=(
                    f"Comparing first half vs second half of the {lookback_days}-day window: "
                    f"spend went from ${first_half:,.0f} to ${second_half:,.0f} ({change_pct:+.1f}%)."
                ),
                interpretation=(
                    f"A {abs(change_pct):.0f}% {'increase' if change_pct > 0 else 'decrease'} in spend "
                    f"warrants attention. Check if this was intentional and monitor ROAS impact."
                ),
                confidence="high",
                recommended_action=f"Review whether the spend {'increase' if change_pct > 0 else 'decrease'} is aligned with business goals.",
                evidence_json={
                    "first_half_spend": first_half,
                    "second_half_spend": second_half,
                    "change_pct": change_pct,
                },
            )
            db.add(insight)
            generated.append("pattern_spend_trend")

    db.commit()

    return {
        "message": f"Generated {len(generated)} insights",
        "insights_generated": generated,
        "lookback_days": lookback_days,
    }


@router.patch("/{insight_id}/dismiss", response_model=InsightRead)
def dismiss_insight(insight_id: int, db: Session = Depends(get_db)):
    """Dismiss an insight so it no longer appears in default listings."""
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")

    insight.is_dismissed = True
    db.commit()
    db.refresh(insight)
    return InsightRead.model_validate(insight)
