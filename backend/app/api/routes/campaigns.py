"""Campaign routes for listing, detail, metrics, and summary."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.campaign import Campaign, DailyMetrics
from app.schemas.campaign import (
    CampaignRead,
    CampaignList,
    CampaignSummary,
    DailyMetricsRead,
    DailyMetricsList,
)

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.get("/summary", response_model=CampaignSummary)
def get_campaigns_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """Aggregated summary across all campaigns."""
    total_campaigns = db.query(Campaign).count()

    metrics_q = db.query(
        func.coalesce(func.sum(DailyMetrics.cost), 0).label("total_spend"),
        func.coalesce(func.sum(DailyMetrics.revenue), 0).label("total_revenue"),
        func.coalesce(func.sum(DailyMetrics.conversions), 0).label("total_conversions"),
    ).join(Campaign, Campaign.id == DailyMetrics.campaign_id)

    if start_date:
        metrics_q = metrics_q.filter(DailyMetrics.date >= start_date)
    if end_date:
        metrics_q = metrics_q.filter(DailyMetrics.date <= end_date)

    row = metrics_q.one()
    total_spend = float(row.total_spend)
    total_revenue = float(row.total_revenue)
    total_conversions = float(row.total_conversions)
    overall_roas = round(total_revenue / total_spend, 4) if total_spend > 0 else 0.0

    # Breakdown by campaign_type
    by_type_q = (
        db.query(
            Campaign.campaign_type,
            func.coalesce(func.sum(DailyMetrics.cost), 0).label("spend"),
            func.coalesce(func.sum(DailyMetrics.revenue), 0).label("revenue"),
            func.coalesce(func.sum(DailyMetrics.conversions), 0).label("conversions"),
            func.count(func.distinct(Campaign.id)).label("campaign_count"),
        )
        .join(DailyMetrics, DailyMetrics.campaign_id == Campaign.id)
    )
    if start_date:
        by_type_q = by_type_q.filter(DailyMetrics.date >= start_date)
    if end_date:
        by_type_q = by_type_q.filter(DailyMetrics.date <= end_date)

    by_type_q = by_type_q.group_by(Campaign.campaign_type)

    by_type = {}
    for r in by_type_q.all():
        spend = float(r.spend)
        revenue = float(r.revenue)
        by_type[r.campaign_type] = {
            "campaign_count": r.campaign_count,
            "spend": spend,
            "revenue": revenue,
            "conversions": float(r.conversions),
            "roas": round(revenue / spend, 4) if spend > 0 else 0.0,
        }

    return CampaignSummary(
        total_campaigns=total_campaigns,
        total_spend=total_spend,
        total_revenue=total_revenue,
        total_conversions=total_conversions,
        overall_roas=overall_roas,
        by_type=by_type,
    )


@router.get("", response_model=CampaignList)
def list_campaigns(
    channel: Optional[str] = Query(None),
    campaign_type: Optional[str] = Query(None, alias="type"),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List all campaigns with optional filters."""
    q = db.query(Campaign)

    if channel:
        q = q.filter(Campaign.channel == channel)
    if campaign_type:
        q = q.filter(Campaign.campaign_type == campaign_type)
    if status:
        q = q.filter(Campaign.status == status)

    total = q.count()
    items = q.order_by(Campaign.created_at.desc()).offset(skip).limit(limit).all()

    return CampaignList(
        items=[CampaignRead.model_validate(c) for c in items],
        total=total,
    )


@router.get("/{campaign_id}", response_model=CampaignRead)
def get_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Get campaign details by ID."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return CampaignRead.model_validate(campaign)


@router.get("/{campaign_id}/metrics", response_model=DailyMetricsList)
def get_campaign_metrics(
    campaign_id: int,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(365, ge=1, le=3650),
    db: Session = Depends(get_db),
):
    """Get daily metrics for a specific campaign with optional date range filter."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    q = db.query(DailyMetrics).filter(DailyMetrics.campaign_id == campaign_id)

    if start_date:
        q = q.filter(DailyMetrics.date >= start_date)
    if end_date:
        q = q.filter(DailyMetrics.date <= end_date)

    total = q.count()
    items = q.order_by(DailyMetrics.date.desc()).offset(skip).limit(limit).all()

    return DailyMetricsList(
        items=[DailyMetricsRead.model_validate(m) for m in items],
        total=total,
    )
