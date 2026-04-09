"""Simulator routes for running scenario simulations."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.database import get_db
from app.models.campaign import Campaign, DailyMetrics, ContextualData
from app.schemas.campaign import SimulatorInput, SimulatorOutput, HistoricalAnalogue

router = APIRouter(prefix="/simulator", tags=["simulator"])


@router.post("/scenario", response_model=SimulatorOutput)
def run_scenario(
    scenario: SimulatorInput,
    db: Session = Depends(get_db),
):
    """
    Run a scenario simulation.

    Given proposed spend changes and context, project revenue impact
    based on historical analogues and spend-response relationships.
    """
    warnings = []

    # ── Step 1: Get recent baseline metrics ──
    recent_baseline = (
        db.query(
            func.avg(
                case(
                    (Campaign.campaign_type == "brand", DailyMetrics.cost),
                    else_=None,
                )
            ).label("avg_brand_cost"),
            func.avg(
                case(
                    (Campaign.campaign_type != "brand", DailyMetrics.cost),
                    else_=None,
                )
            ).label("avg_nonbrand_cost"),
            func.avg(DailyMetrics.revenue).label("avg_revenue"),
            func.count(func.distinct(DailyMetrics.date)).label("n_days"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .one()
    )

    avg_brand_cost = float(recent_baseline.avg_brand_cost or 0)
    avg_nonbrand_cost = float(recent_baseline.avg_nonbrand_cost or 0)
    avg_revenue = float(recent_baseline.avg_revenue or 0)
    n_days = int(recent_baseline.n_days or 0)

    if n_days < 7:
        warnings.append(f"Only {n_days} days of data available; projections may be unreliable.")

    if avg_brand_cost == 0 and avg_nonbrand_cost == 0:
        return SimulatorOutput(
            projected_revenue_change_pct=0.0,
            confidence_low=0.0,
            confidence_high=0.0,
            historical_analogues=[],
            warnings=["No spend data available for simulation."],
        )

    # Proposed new spend levels
    proposed_brand = avg_brand_cost * (1 + scenario.brand_spend_change_pct / 100.0)
    proposed_nonbrand = avg_nonbrand_cost * (1 + scenario.nonbrand_spend_change_pct / 100.0)

    # ── Step 2: Find historical analogues ──
    # Get daily aggregated data
    daily_data = (
        db.query(
            DailyMetrics.date,
            func.sum(
                case(
                    (Campaign.campaign_type == "brand", DailyMetrics.cost),
                    else_=0,
                )
            ).label("brand_cost"),
            func.sum(
                case(
                    (Campaign.campaign_type != "brand", DailyMetrics.cost),
                    else_=0,
                )
            ).label("nonbrand_cost"),
            func.sum(DailyMetrics.revenue).label("revenue"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .group_by(DailyMetrics.date)
        .order_by(DailyMetrics.date)
        .all()
    )

    if len(daily_data) < 2:
        return SimulatorOutput(
            projected_revenue_change_pct=0.0,
            confidence_low=0.0,
            confidence_high=0.0,
            historical_analogues=[],
            warnings=["Insufficient historical data for simulation."],
        )

    # Get contextual data for promo matching
    ctx_data = {cd.date: cd for cd in db.query(ContextualData).all()}

    # Compute day-over-day changes
    analogues = []
    for i in range(1, len(daily_data)):
        prev = daily_data[i - 1]
        curr = daily_data[i]

        prev_bc = float(prev.brand_cost)
        curr_bc = float(curr.brand_cost)
        prev_nbc = float(prev.nonbrand_cost)
        curr_nbc = float(curr.nonbrand_cost)
        prev_rev = float(prev.revenue)
        curr_rev = float(curr.revenue)

        if prev_bc == 0 and prev_nbc == 0:
            continue

        brand_chg = ((curr_bc - prev_bc) / prev_bc * 100) if prev_bc > 0 else 0
        nb_chg = ((curr_nbc - prev_nbc) / prev_nbc * 100) if prev_nbc > 0 else 0
        rev_chg = ((curr_rev - prev_rev) / prev_rev * 100) if prev_rev > 0 else 0

        ctx = ctx_data.get(curr.date)
        was_promo = ctx.is_promo if ctx else False

        # Check if this day is a reasonable analogue
        # (spend change direction roughly matches the scenario)
        brand_dir_match = (
            (scenario.brand_spend_change_pct >= 0 and brand_chg >= 0)
            or (scenario.brand_spend_change_pct < 0 and brand_chg < 0)
            or abs(scenario.brand_spend_change_pct) < 5
        )
        nb_dir_match = (
            (scenario.nonbrand_spend_change_pct >= 0 and nb_chg >= 0)
            or (scenario.nonbrand_spend_change_pct < 0 and nb_chg < 0)
            or abs(scenario.nonbrand_spend_change_pct) < 5
        )

        promo_match = (not scenario.is_promo and not was_promo) or (scenario.is_promo and was_promo)

        if brand_dir_match and nb_dir_match:
            # Compute similarity score
            brand_sim = 1.0 / (1.0 + abs(brand_chg - scenario.brand_spend_change_pct) / 10.0)
            nb_sim = 1.0 / (1.0 + abs(nb_chg - scenario.nonbrand_spend_change_pct) / 10.0)
            promo_sim = 1.0 if promo_match else 0.5
            score = brand_sim * nb_sim * promo_sim

            analogues.append({
                "date": curr.date,
                "brand_spend_change": round(brand_chg, 2),
                "nonbrand_spend_change": round(nb_chg, 2),
                "revenue_change": round(rev_chg, 2),
                "was_promo": was_promo,
                "score": score,
            })

    # Sort by relevance score
    analogues.sort(key=lambda x: x["score"], reverse=True)
    top_analogues = analogues[:10]

    # ── Step 3: Project revenue change ──
    if top_analogues:
        # Weighted average of revenue changes from analogues
        total_weight = sum(a["score"] for a in top_analogues)
        if total_weight > 0:
            projected_change = sum(
                a["revenue_change"] * a["score"] for a in top_analogues
            ) / total_weight
        else:
            projected_change = 0.0

        # Confidence interval from analogue variance
        rev_changes = [a["revenue_change"] for a in top_analogues]
        if len(rev_changes) >= 2:
            try:
                import numpy as np

                arr = np.array(rev_changes)
                std = float(np.std(arr))
                confidence_low = round(projected_change - 1.96 * std, 2)
                confidence_high = round(projected_change + 1.96 * std, 2)
            except ImportError:
                mean_change = sum(rev_changes) / len(rev_changes)
                spread = max(abs(max(rev_changes) - mean_change), abs(min(rev_changes) - mean_change))
                confidence_low = round(projected_change - spread, 2)
                confidence_high = round(projected_change + spread, 2)
        else:
            confidence_low = round(projected_change * 0.5, 2)
            confidence_high = round(projected_change * 1.5, 2)
    else:
        # Fallback: simple elasticity estimate
        # Assume nonbrand has ~0.3 elasticity, brand ~0.1
        brand_rev_share = avg_brand_cost / (avg_brand_cost + avg_nonbrand_cost) if (avg_brand_cost + avg_nonbrand_cost) > 0 else 0.5
        nb_rev_share = 1 - brand_rev_share

        projected_change = (
            scenario.brand_spend_change_pct * 0.1 * brand_rev_share
            + scenario.nonbrand_spend_change_pct * 0.3 * nb_rev_share
        )

        if scenario.is_promo:
            projected_change *= 1.2

        confidence_low = round(projected_change * 0.3, 2)
        confidence_high = round(projected_change * 1.7, 2)
        warnings.append("No close historical analogues found; using elasticity-based estimate.")

    projected_change = round(projected_change, 2)

    # ── Warnings ──
    if abs(scenario.brand_spend_change_pct) > 50:
        warnings.append("Large brand spend changes (>50%) have high uncertainty.")
    if abs(scenario.nonbrand_spend_change_pct) > 50:
        warnings.append("Large nonbrand spend changes (>50%) may hit diminishing returns.")
    if len(top_analogues) < 3:
        warnings.append("Few historical analogues found; confidence interval is wide.")

    historical_analogues = [
        HistoricalAnalogue(
            date=a["date"],
            brand_spend_change=a["brand_spend_change"],
            nonbrand_spend_change=a["nonbrand_spend_change"],
            revenue_change=a["revenue_change"],
            was_promo=a["was_promo"],
        )
        for a in top_analogues[:5]
    ]

    return SimulatorOutput(
        projected_revenue_change_pct=projected_change,
        confidence_low=confidence_low,
        confidence_high=confidence_high,
        historical_analogues=historical_analogues,
        warnings=warnings,
    )
