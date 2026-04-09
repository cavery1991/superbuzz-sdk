"""Incrementality routes for observational analysis, proxy estimates, and experiments."""

from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.database import get_db
from app.models.campaign import Campaign, DailyMetrics, OrganicMetrics, Experiment
from app.schemas.campaign import ExperimentCreate, ExperimentRead, ExperimentList

router = APIRouter(prefix="/incrementality", tags=["incrementality"])


@router.get("/observational")
def get_observational_metrics(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Brand vs nonbrand observational comparison metrics.

    Compares brand and nonbrand campaign performance alongside organic metrics
    to provide a proxy view of incrementality.
    """
    # Paid metrics by type
    paid_q = db.query(
        Campaign.campaign_type,
        func.coalesce(func.sum(DailyMetrics.cost), 0).label("cost"),
        func.coalesce(func.sum(DailyMetrics.revenue), 0).label("revenue"),
        func.coalesce(func.sum(DailyMetrics.conversions), 0).label("conversions"),
        func.coalesce(func.sum(DailyMetrics.clicks), 0).label("clicks"),
        func.coalesce(func.sum(DailyMetrics.impressions), 0).label("impressions"),
        func.coalesce(func.sum(DailyMetrics.new_customers), 0).label("new_customers"),
    ).join(Campaign, Campaign.id == DailyMetrics.campaign_id)

    if start_date:
        paid_q = paid_q.filter(DailyMetrics.date >= start_date)
    if end_date:
        paid_q = paid_q.filter(DailyMetrics.date <= end_date)

    paid_q = paid_q.group_by(Campaign.campaign_type)
    paid_rows = {r.campaign_type: r for r in paid_q.all()}

    # Organic metrics
    organic_q = db.query(
        func.coalesce(func.sum(OrganicMetrics.organic_sessions), 0).label("organic_sessions"),
        func.coalesce(func.sum(OrganicMetrics.organic_revenue), 0).label("organic_revenue"),
        func.coalesce(func.sum(OrganicMetrics.organic_conversions), 0).label("organic_conversions"),
        func.coalesce(func.sum(OrganicMetrics.brand_organic_sessions), 0).label("brand_organic_sessions"),
        func.coalesce(func.sum(OrganicMetrics.nonbrand_organic_sessions), 0).label("nonbrand_organic_sessions"),
    )
    if start_date:
        organic_q = organic_q.filter(OrganicMetrics.date >= start_date)
    if end_date:
        organic_q = organic_q.filter(OrganicMetrics.date <= end_date)

    organic_row = organic_q.one()

    def _extract_paid(campaign_type: str) -> dict:
        row = paid_rows.get(campaign_type)
        if not row:
            return {
                "cost": 0.0, "revenue": 0.0, "conversions": 0.0,
                "clicks": 0, "impressions": 0, "new_customers": 0, "roas": 0.0, "cpa": 0.0,
            }
        cost = float(row.cost)
        revenue = float(row.revenue)
        conversions = float(row.conversions)
        return {
            "cost": cost,
            "revenue": revenue,
            "conversions": conversions,
            "clicks": int(row.clicks),
            "impressions": int(row.impressions),
            "new_customers": int(row.new_customers),
            "roas": round(revenue / cost, 4) if cost > 0 else 0.0,
            "cpa": round(cost / conversions, 2) if conversions > 0 else 0.0,
        }

    brand_paid = _extract_paid("brand")
    nonbrand_paid = _extract_paid("nonbrand")

    # Compute overlap indicator: brand paid vs brand organic
    brand_organic = int(organic_row.brand_organic_sessions)
    brand_clicks = brand_paid["clicks"]
    overlap_ratio = round(
        brand_clicks / (brand_clicks + brand_organic), 4
    ) if (brand_clicks + brand_organic) > 0 else 0.0

    return {
        "brand": brand_paid,
        "nonbrand": nonbrand_paid,
        "organic": {
            "total_sessions": int(organic_row.organic_sessions),
            "total_revenue": float(organic_row.organic_revenue),
            "total_conversions": float(organic_row.organic_conversions),
            "brand_sessions": brand_organic,
            "nonbrand_sessions": int(organic_row.nonbrand_organic_sessions),
        },
        "overlap_ratio": overlap_ratio,
        "interpretation": (
            "A high overlap ratio suggests brand paid clicks may be cannibalizing "
            "organic brand traffic. Consider running a geo-holdout experiment to measure true incrementality."
        ),
    }


@router.get("/proxy")
def get_proxy_incrementality(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Proxy incrementality estimates including cannibalization risk and spend curves.

    Analyzes the relationship between brand spend and organic brand sessions
    to estimate potential cannibalization.
    """
    # Get daily brand spend vs organic brand sessions
    brand_daily = (
        db.query(
            DailyMetrics.date,
            func.sum(DailyMetrics.cost).label("brand_cost"),
            func.sum(DailyMetrics.revenue).label("brand_revenue"),
            func.sum(DailyMetrics.conversions).label("brand_conversions"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .filter(Campaign.campaign_type == "brand")
    )
    if start_date:
        brand_daily = brand_daily.filter(DailyMetrics.date >= start_date)
    if end_date:
        brand_daily = brand_daily.filter(DailyMetrics.date <= end_date)
    brand_daily = brand_daily.group_by(DailyMetrics.date).all()

    organic_daily = db.query(
        OrganicMetrics.date,
        OrganicMetrics.brand_organic_sessions,
        OrganicMetrics.organic_revenue,
    )
    if start_date:
        organic_daily = organic_daily.filter(OrganicMetrics.date >= start_date)
    if end_date:
        organic_daily = organic_daily.filter(OrganicMetrics.date <= end_date)
    organic_daily = organic_daily.all()

    organic_by_date = {r.date: r for r in organic_daily}

    # Build correlation data
    spend_data = []
    organic_data = []
    for bd in brand_daily:
        org = organic_by_date.get(bd.date)
        if org:
            spend_data.append(float(bd.brand_cost))
            organic_data.append(int(org.brand_organic_sessions))

    correlation = None
    cannibalization_estimate = "insufficient_data"
    if len(spend_data) >= 7:
        try:
            import numpy as np
            from scipy import stats as scipy_stats

            corr, p_value = scipy_stats.pearsonr(spend_data, organic_data)
            correlation = {
                "pearson_r": round(float(corr), 4),
                "p_value": round(float(p_value), 6),
                "n_days": len(spend_data),
            }

            if corr < -0.3 and p_value < 0.05:
                cannibalization_estimate = "low_risk"
            elif corr > 0.3:
                cannibalization_estimate = "high_risk"
            else:
                cannibalization_estimate = "moderate_risk"
        except ImportError:
            correlation = {"error": "numpy/scipy not available"}

    # Nonbrand spend curve: diminishing returns estimation
    nonbrand_daily = (
        db.query(
            DailyMetrics.date,
            func.sum(DailyMetrics.cost).label("nb_cost"),
            func.sum(DailyMetrics.revenue).label("nb_revenue"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .filter(Campaign.campaign_type == "nonbrand")
    )
    if start_date:
        nonbrand_daily = nonbrand_daily.filter(DailyMetrics.date >= start_date)
    if end_date:
        nonbrand_daily = nonbrand_daily.filter(DailyMetrics.date <= end_date)
    nonbrand_daily = nonbrand_daily.group_by(DailyMetrics.date).all()

    spend_buckets: dict[str, dict] = {}
    for row in nonbrand_daily:
        cost = float(row.nb_cost)
        revenue = float(row.nb_revenue)
        if cost <= 0:
            continue
        # Bucket by spend quartile
        bucket_key = f"{int(cost // 100) * 100}-{int(cost // 100) * 100 + 99}"
        if bucket_key not in spend_buckets:
            spend_buckets[bucket_key] = {"total_cost": 0.0, "total_revenue": 0.0, "days": 0}
        spend_buckets[bucket_key]["total_cost"] += cost
        spend_buckets[bucket_key]["total_revenue"] += revenue
        spend_buckets[bucket_key]["days"] += 1

    spend_curve = []
    for bucket, data in sorted(spend_buckets.items()):
        avg_spend = data["total_cost"] / data["days"] if data["days"] > 0 else 0
        avg_revenue = data["total_revenue"] / data["days"] if data["days"] > 0 else 0
        roas = round(avg_revenue / avg_spend, 4) if avg_spend > 0 else 0.0
        spend_curve.append({
            "spend_range": bucket,
            "avg_daily_spend": round(avg_spend, 2),
            "avg_daily_revenue": round(avg_revenue, 2),
            "marginal_roas": roas,
            "days_in_bucket": data["days"],
        })

    return {
        "cannibalization": {
            "correlation": correlation,
            "risk_level": cannibalization_estimate,
            "interpretation": (
                "Compares daily brand paid spend vs organic brand sessions. "
                "Positive correlation suggests higher brand spend does NOT displace organic; "
                "negative correlation suggests potential cannibalization."
            ),
        },
        "nonbrand_spend_curve": spend_curve,
    }


@router.get("/experiments", response_model=ExperimentList)
def list_experiments(
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List all incrementality experiments."""
    q = db.query(Experiment)
    if status:
        q = q.filter(Experiment.status == status)

    total = q.count()
    items = q.order_by(Experiment.created_at.desc()).offset(skip).limit(limit).all()

    return ExperimentList(
        items=[ExperimentRead.model_validate(e) for e in items],
        total=total,
    )


@router.post("/experiments", response_model=ExperimentRead, status_code=201)
def create_experiment(payload: ExperimentCreate, db: Session = Depends(get_db)):
    """Create a new incrementality experiment."""
    experiment = Experiment(
        name=payload.name,
        experiment_type=payload.experiment_type,
        status=payload.status,
        start_date=payload.start_date,
        end_date=payload.end_date,
        treatment_description=payload.treatment_description,
        control_description=payload.control_description,
        config_json=payload.config_json,
    )
    db.add(experiment)
    db.commit()
    db.refresh(experiment)
    return ExperimentRead.model_validate(experiment)


@router.get("/experiments/{experiment_id}", response_model=ExperimentRead)
def get_experiment(experiment_id: int, db: Session = Depends(get_db)):
    """Get experiment details by ID."""
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return ExperimentRead.model_validate(experiment)
