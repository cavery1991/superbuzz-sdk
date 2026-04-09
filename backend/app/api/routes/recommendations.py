"""Recommendations routes for listing, generating, and updating recommendation status."""

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.campaign import Recommendation, Campaign, DailyMetrics, OrganicMetrics, ContextualData
from app.schemas.campaign import (
    RecommendationRead,
    RecommendationList,
    RecommendationStatusUpdate,
)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("", response_model=RecommendationList)
def list_recommendations(
    status: Optional[str] = Query(None),
    confidence: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List recommendations with optional status and confidence filters."""
    q = db.query(Recommendation)

    if status:
        q = q.filter(Recommendation.status == status)
    if confidence:
        q = q.filter(Recommendation.confidence == confidence)

    total = q.count()
    items = q.order_by(Recommendation.created_at.desc()).offset(skip).limit(limit).all()

    return RecommendationList(
        items=[RecommendationRead.model_validate(r) for r in items],
        total=total,
    )


@router.post("/generate")
def generate_recommendations(
    lookback_days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """
    Trigger recommendation generation based on recent performance data.

    Analyzes spend efficiency, channel performance, and contextual factors
    to produce actionable budget and strategy recommendations.
    """
    today = date.today()
    start_date = today - timedelta(days=lookback_days)

    generated = []

    # ── Get performance by campaign type ──
    type_metrics = (
        db.query(
            Campaign.campaign_type,
            func.coalesce(func.sum(DailyMetrics.cost), 0).label("cost"),
            func.coalesce(func.sum(DailyMetrics.revenue), 0).label("revenue"),
            func.coalesce(func.sum(DailyMetrics.conversions), 0).label("conversions"),
            func.coalesce(func.sum(DailyMetrics.new_customers), 0).label("new_customers"),
            func.coalesce(func.sum(DailyMetrics.orders), 0).label("orders"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .filter(DailyMetrics.date >= start_date)
        .group_by(Campaign.campaign_type)
        .all()
    )

    metrics_by_type = {}
    for row in type_metrics:
        cost = float(row.cost)
        revenue = float(row.revenue)
        conversions = float(row.conversions)
        metrics_by_type[row.campaign_type] = {
            "cost": cost,
            "revenue": revenue,
            "conversions": conversions,
            "new_customers": int(row.new_customers),
            "orders": int(row.orders),
            "roas": round(revenue / cost, 2) if cost > 0 else 0,
            "cpa": round(cost / conversions, 2) if conversions > 0 else 0,
        }

    brand = metrics_by_type.get("brand", {})
    nonbrand = metrics_by_type.get("nonbrand", {})

    # ── Recommendation 1: Brand spend optimization ──
    brand_roas = brand.get("roas", 0)
    nb_roas = nonbrand.get("roas", 0)
    brand_cost = brand.get("cost", 0)

    if brand_roas > 0 and nb_roas > 0:
        if brand_roas > nb_roas * 2.5:
            rec = Recommendation(
                date=today,
                action="Reduce brand PPC spend by 20-30% and redirect to nonbrand.",
                rationale=(
                    f"Brand ROAS ({brand_roas}x) is {round(brand_roas/nb_roas, 1)}x higher than "
                    f"nonbrand ROAS ({nb_roas}x). Inflated brand ROAS often indicates demand capture, "
                    f"not demand creation. Reducing brand spend may reveal that organic captures most brand traffic."
                ),
                expected_effect=(
                    "If brand traffic is largely organic, a 20-30% brand spend reduction "
                    "should result in minimal revenue loss (est. <5%) while freeing budget for "
                    "higher-incrementality nonbrand campaigns."
                ),
                confidence="medium",
                risk="Short-term brand impression share loss; competitor conquesting risk.",
                evidence_json={
                    "brand_roas": brand_roas,
                    "nonbrand_roas": nb_roas,
                    "brand_cost": brand_cost,
                    "lookback_days": lookback_days,
                },
            )
            db.add(rec)
            generated.append("reduce_brand_spend")

        elif nb_roas > brand_roas * 1.5:
            rec = Recommendation(
                date=today,
                action="Increase nonbrand budget allocation.",
                rationale=(
                    f"Nonbrand ROAS ({nb_roas}x) significantly outperforms brand ({brand_roas}x). "
                    f"Nonbrand campaigns appear to have strong return and may benefit from increased investment."
                ),
                expected_effect=(
                    "Increased nonbrand spend typically captures incremental demand. "
                    "Expect diminishing returns at higher spend levels."
                ),
                confidence="medium",
                risk="Diminishing ROAS at higher nonbrand spend levels.",
                evidence_json={"brand_roas": brand_roas, "nonbrand_roas": nb_roas},
            )
            db.add(rec)
            generated.append("increase_nonbrand")

    # ── Recommendation 2: New customer acquisition ──
    total_new = sum(m.get("new_customers", 0) for m in metrics_by_type.values())
    total_orders = sum(m.get("orders", 0) for m in metrics_by_type.values())
    total_cost = sum(m.get("cost", 0) for m in metrics_by_type.values())

    if total_orders > 0:
        new_pct = round(total_new / total_orders * 100, 1)
        if new_pct < 30 and total_cost > 0:
            ncac = round(total_cost / max(total_new, 1), 2)
            rec = Recommendation(
                date=today,
                action="Shift budget toward new customer acquisition campaigns.",
                rationale=(
                    f"Only {new_pct}% of orders are from new customers. "
                    f"Current new customer acquisition cost is ${ncac:.0f}. "
                    f"Consider allocating more to prospecting/nonbrand to grow the customer base."
                ),
                expected_effect="Improved long-term revenue through customer base expansion.",
                confidence="medium",
                risk="Short-term ROAS may decrease as prospecting is less efficient than retargeting.",
                evidence_json={
                    "new_customer_pct": new_pct,
                    "ncac": ncac,
                    "total_new_customers": total_new,
                    "total_orders": total_orders,
                },
            )
            db.add(rec)
            generated.append("new_customer_focus")

    # ── Recommendation 3: Experiment recommendation ──
    if brand_cost > 500:
        from app.models.campaign import Experiment

        active_experiments = (
            db.query(Experiment)
            .filter(Experiment.status.in_(["draft", "running"]))
            .count()
        )

        if active_experiments == 0:
            rec = Recommendation(
                date=today,
                action="Set up a geo-holdout experiment to measure brand incrementality.",
                rationale=(
                    f"You are spending ${brand_cost:,.0f} on brand campaigns over {lookback_days} days "
                    f"without any active incrementality experiments. An experiment would provide "
                    f"definitive evidence of brand PPC's true contribution."
                ),
                expected_effect=(
                    "Conclusive data on brand PPC incrementality, enabling optimal budget allocation."
                ),
                confidence="high",
                risk="Minimal risk; holdout markets may see temporary share loss.",
                evidence_json={
                    "brand_cost": brand_cost,
                    "active_experiments": active_experiments,
                },
            )
            db.add(rec)
            generated.append("run_experiment")

    # ── Recommendation 4: Check for promo uplift opportunity ──
    promo_days = (
        db.query(ContextualData.date)
        .filter(ContextualData.is_promo == True, ContextualData.date >= start_date)  # noqa: E712
        .all()
    )
    promo_dates = {r.date for r in promo_days}

    if promo_dates:
        promo_metrics = (
            db.query(
                func.coalesce(func.sum(DailyMetrics.cost), 0).label("cost"),
                func.coalesce(func.sum(DailyMetrics.revenue), 0).label("revenue"),
            )
            .filter(DailyMetrics.date.in_(promo_dates))
            .one()
        )
        non_promo_metrics = (
            db.query(
                func.coalesce(func.sum(DailyMetrics.cost), 0).label("cost"),
                func.coalesce(func.sum(DailyMetrics.revenue), 0).label("revenue"),
            )
            .filter(DailyMetrics.date >= start_date, ~DailyMetrics.date.in_(promo_dates))
            .one()
        )

        promo_cost = float(promo_metrics.cost)
        promo_rev = float(promo_metrics.revenue)
        np_cost = float(non_promo_metrics.cost)
        np_rev = float(non_promo_metrics.revenue)
        n_promo = len(promo_dates)
        n_non_promo = lookback_days - n_promo

        if n_promo > 0 and n_non_promo > 0 and promo_cost > 0 and np_cost > 0:
            promo_daily_roas = round((promo_rev / n_promo) / (promo_cost / n_promo), 2)
            np_daily_roas = round((np_rev / n_non_promo) / (np_cost / n_non_promo), 2)

            if promo_daily_roas > np_daily_roas * 1.3:
                rec = Recommendation(
                    date=today,
                    action="Increase ad spend during promotional periods.",
                    rationale=(
                        f"ROAS during promo days ({promo_daily_roas}x) is significantly higher than "
                        f"non-promo days ({np_daily_roas}x). Increasing spend during promos "
                        f"could capture more high-intent traffic."
                    ),
                    expected_effect="Higher revenue capture during promotional periods.",
                    confidence="medium",
                    risk="Diminishing returns if promo spend increases too aggressively.",
                    evidence_json={
                        "promo_roas": promo_daily_roas,
                        "non_promo_roas": np_daily_roas,
                        "promo_days": n_promo,
                        "non_promo_days": n_non_promo,
                    },
                )
                db.add(rec)
                generated.append("promo_spend_increase")

    db.commit()

    return {
        "message": f"Generated {len(generated)} recommendations",
        "recommendations_generated": generated,
        "lookback_days": lookback_days,
    }


@router.patch("/{recommendation_id}/status", response_model=RecommendationRead)
def update_recommendation_status(
    recommendation_id: int,
    payload: RecommendationStatusUpdate,
    db: Session = Depends(get_db),
):
    """Update recommendation status (accepted/rejected)."""
    rec = db.query(Recommendation).filter(Recommendation.id == recommendation_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")

    valid_statuses = {"accepted", "rejected", "pending", "expired"}
    if payload.status not in valid_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}",
        )

    rec.status = payload.status
    db.commit()
    db.refresh(rec)
    return RecommendationRead.model_validate(rec)
