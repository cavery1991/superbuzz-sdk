"""Metrics routes for aggregated daily metrics, brand vs nonbrand, and KPI summaries."""

from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.database import get_db
from app.models.campaign import Campaign, DailyMetrics
from app.schemas.campaign import (
    AggregatedDailyMetrics,
    BrandVsNonbrand,
    KpiSummary,
)

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/daily", response_model=List[AggregatedDailyMetrics])
def get_daily_metrics(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    group_by_type: bool = Query(False, description="Group results by brand/nonbrand"),
    db: Session = Depends(get_db),
):
    """Aggregated daily metrics with date range, optionally grouped by brand/nonbrand."""
    if group_by_type:
        q = db.query(
            DailyMetrics.date,
            Campaign.campaign_type,
            func.sum(DailyMetrics.impressions).label("impressions"),
            func.sum(DailyMetrics.clicks).label("clicks"),
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
            func.sum(DailyMetrics.returning_customers).label("returning_customers"),
            func.sum(DailyMetrics.orders).label("orders"),
        ).join(Campaign, Campaign.id == DailyMetrics.campaign_id)
    else:
        q = db.query(
            DailyMetrics.date,
            func.sum(DailyMetrics.impressions).label("impressions"),
            func.sum(DailyMetrics.clicks).label("clicks"),
            func.sum(DailyMetrics.cost).label("cost"),
            func.sum(DailyMetrics.conversions).label("conversions"),
            func.sum(DailyMetrics.revenue).label("revenue"),
            func.sum(DailyMetrics.new_customers).label("new_customers"),
            func.sum(DailyMetrics.returning_customers).label("returning_customers"),
            func.sum(DailyMetrics.orders).label("orders"),
        ).join(Campaign, Campaign.id == DailyMetrics.campaign_id)

    if start_date:
        q = q.filter(DailyMetrics.date >= start_date)
    if end_date:
        q = q.filter(DailyMetrics.date <= end_date)

    if group_by_type:
        q = q.group_by(DailyMetrics.date, Campaign.campaign_type)
    else:
        q = q.group_by(DailyMetrics.date)

    q = q.order_by(DailyMetrics.date.asc())

    results = []
    for row in q.all():
        cost = float(row.cost) if row.cost else 0.0
        revenue = float(row.revenue) if row.revenue else 0.0
        clicks = int(row.clicks) if row.clicks else 0
        impressions = int(row.impressions) if row.impressions else 0
        conversions = float(row.conversions) if row.conversions else 0.0

        roas = round(revenue / cost, 4) if cost > 0 else 0.0
        ctr = round(clicks / impressions, 4) if impressions > 0 else 0.0
        cpa = round(cost / conversions, 2) if conversions > 0 else 0.0

        campaign_type = row.campaign_type if group_by_type else None

        results.append(
            AggregatedDailyMetrics(
                date=row.date,
                campaign_type=campaign_type,
                impressions=impressions,
                clicks=clicks,
                cost=cost,
                conversions=conversions,
                revenue=revenue,
                roas=roas,
                ctr=ctr,
                cpa=cpa,
                new_customers=int(row.new_customers) if row.new_customers else 0,
                returning_customers=int(row.returning_customers) if row.returning_customers else 0,
                orders=int(row.orders) if row.orders else 0,
            )
        )

    return results


@router.get("/brand-vs-nonbrand", response_model=List[BrandVsNonbrand])
def get_brand_vs_nonbrand(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """Brand vs nonbrand comparison over time."""
    q = db.query(
        DailyMetrics.date,
        func.sum(
            case((Campaign.campaign_type == "brand", DailyMetrics.cost), else_=0)
        ).label("brand_cost"),
        func.sum(
            case((Campaign.campaign_type == "brand", DailyMetrics.revenue), else_=0)
        ).label("brand_revenue"),
        func.sum(
            case((Campaign.campaign_type == "brand", DailyMetrics.conversions), else_=0)
        ).label("brand_conversions"),
        func.sum(
            case((Campaign.campaign_type != "brand", DailyMetrics.cost), else_=0)
        ).label("nonbrand_cost"),
        func.sum(
            case((Campaign.campaign_type != "brand", DailyMetrics.revenue), else_=0)
        ).label("nonbrand_revenue"),
        func.sum(
            case((Campaign.campaign_type != "brand", DailyMetrics.conversions), else_=0)
        ).label("nonbrand_conversions"),
    ).join(Campaign, Campaign.id == DailyMetrics.campaign_id)

    if start_date:
        q = q.filter(DailyMetrics.date >= start_date)
    if end_date:
        q = q.filter(DailyMetrics.date <= end_date)

    q = q.group_by(DailyMetrics.date).order_by(DailyMetrics.date.asc())

    results = []
    for row in q.all():
        bc = float(row.brand_cost) if row.brand_cost else 0.0
        br = float(row.brand_revenue) if row.brand_revenue else 0.0
        nbc = float(row.nonbrand_cost) if row.nonbrand_cost else 0.0
        nbr = float(row.nonbrand_revenue) if row.nonbrand_revenue else 0.0

        results.append(
            BrandVsNonbrand(
                date=row.date,
                brand_cost=bc,
                brand_revenue=br,
                brand_roas=round(br / bc, 4) if bc > 0 else 0.0,
                brand_conversions=float(row.brand_conversions) if row.brand_conversions else 0.0,
                nonbrand_cost=nbc,
                nonbrand_revenue=nbr,
                nonbrand_roas=round(nbr / nbc, 4) if nbc > 0 else 0.0,
                nonbrand_conversions=float(row.nonbrand_conversions) if row.nonbrand_conversions else 0.0,
            )
        )

    return results


@router.get("/kpi-summary", response_model=KpiSummary)
def get_kpi_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """High-level KPIs: total spend, revenue, ROAS, CPA, MER, new customer %."""
    q = db.query(
        func.coalesce(func.sum(DailyMetrics.cost), 0).label("total_spend"),
        func.coalesce(func.sum(DailyMetrics.revenue), 0).label("total_revenue"),
        func.coalesce(func.sum(DailyMetrics.conversions), 0).label("total_conversions"),
        func.coalesce(func.sum(DailyMetrics.orders), 0).label("total_orders"),
        func.coalesce(func.sum(DailyMetrics.new_customers), 0).label("total_new_customers"),
        func.coalesce(func.sum(DailyMetrics.returning_customers), 0).label("total_returning_customers"),
        func.coalesce(func.sum(DailyMetrics.gross_margin), 0).label("total_gross_margin"),
    )

    if start_date:
        q = q.filter(DailyMetrics.date >= start_date)
    if end_date:
        q = q.filter(DailyMetrics.date <= end_date)

    row = q.one()

    total_spend = float(row.total_spend)
    total_revenue = float(row.total_revenue)
    total_conversions = float(row.total_conversions)
    total_orders = int(row.total_orders)
    total_new = int(row.total_new_customers)
    total_returning = int(row.total_returning_customers)
    total_gross_margin = float(row.total_gross_margin)

    total_customers = total_new + total_returning

    roas = round(total_revenue / total_spend, 4) if total_spend > 0 else 0.0
    cpa = round(total_spend / total_conversions, 2) if total_conversions > 0 else 0.0
    # MER = Marketing Efficiency Ratio = total revenue / total ad spend
    mer = round(total_revenue / total_spend, 4) if total_spend > 0 else 0.0
    new_customer_pct = round(total_new / total_customers * 100, 2) if total_customers > 0 else 0.0
    avg_order_value = round(total_revenue / total_orders, 2) if total_orders > 0 else 0.0

    return KpiSummary(
        total_spend=total_spend,
        total_revenue=total_revenue,
        total_conversions=total_conversions,
        roas=roas,
        cpa=cpa,
        mer=mer,
        new_customer_pct=new_customer_pct,
        total_orders=total_orders,
        total_new_customers=total_new,
        total_returning_customers=total_returning,
        avg_order_value=avg_order_value,
        total_gross_margin=total_gross_margin,
    )
