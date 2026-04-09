"""Pattern matching routes for finding similar historical states and querying patterns."""

from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.database import get_db
from app.models.campaign import Campaign, DailyMetrics, ContextualData
from app.schemas.campaign import ContextualDataRead

router = APIRouter(prefix="/patterns", tags=["patterns"])


class CurrentState(BaseModel):
    """Input representing the current state to find similar historical periods."""
    brand_spend: Optional[float] = None
    nonbrand_spend: Optional[float] = None
    is_promo: Optional[bool] = None
    season: Optional[str] = None
    day_of_week: Optional[str] = None
    weather_condition: Optional[str] = None
    temperature_c: Optional[float] = None


class SimilarState(BaseModel):
    """A historical state similar to the query state."""
    date: date
    similarity_score: float
    brand_spend: float
    nonbrand_spend: float
    total_revenue: float
    total_conversions: float
    brand_roas: float
    nonbrand_roas: float
    is_promo: bool
    season: Optional[str] = None
    day_of_week: Optional[str] = None
    weather_condition: Optional[str] = None


class SimilarStatesResponse(BaseModel):
    query_state: dict
    similar_states: List[SimilarState]
    total_states_searched: int


@router.post("/similar", response_model=SimilarStatesResponse)
def find_similar_states(
    current_state: CurrentState,
    top_k: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Find similar historical states based on current context.

    Uses a weighted distance metric across spend levels, promo status,
    season, and weather to find the most analogous historical days.
    """
    # Build historical states
    daily_agg = (
        db.query(
            DailyMetrics.date,
            func.sum(
                case(
                    (Campaign.campaign_type == "brand", DailyMetrics.cost),
                    else_=0,
                )
            ).label("brand_spend"),
            func.sum(
                case(
                    (Campaign.campaign_type != "brand", DailyMetrics.cost),
                    else_=0,
                )
            ).label("nonbrand_spend"),
            func.sum(DailyMetrics.revenue).label("total_revenue"),
            func.sum(DailyMetrics.conversions).label("total_conversions"),
            func.sum(
                case(
                    (Campaign.campaign_type == "brand", DailyMetrics.revenue),
                    else_=0,
                )
            ).label("brand_revenue"),
            func.sum(
                case(
                    (Campaign.campaign_type != "brand", DailyMetrics.revenue),
                    else_=0,
                )
            ).label("nonbrand_revenue"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .group_by(DailyMetrics.date)
        .all()
    )

    # Get contextual data indexed by date
    ctx_data = {cd.date: cd for cd in db.query(ContextualData).all()}

    # Compute max values for normalization
    max_brand_spend = max((float(r.brand_spend) for r in daily_agg if r.brand_spend), default=1.0) or 1.0
    max_nonbrand_spend = max((float(r.nonbrand_spend) for r in daily_agg if r.nonbrand_spend), default=1.0) or 1.0

    scored_states = []
    for row in daily_agg:
        ctx = ctx_data.get(row.date)

        brand_spend = float(row.brand_spend) if row.brand_spend else 0.0
        nonbrand_spend = float(row.nonbrand_spend) if row.nonbrand_spend else 0.0
        brand_rev = float(row.brand_revenue) if row.brand_revenue else 0.0
        nonbrand_rev = float(row.nonbrand_revenue) if row.nonbrand_revenue else 0.0

        # Distance calculation
        distance = 0.0
        weights_sum = 0.0

        if current_state.brand_spend is not None:
            d = abs(brand_spend - current_state.brand_spend) / max_brand_spend
            distance += d * 3.0  # Weight spend similarity heavily
            weights_sum += 3.0

        if current_state.nonbrand_spend is not None:
            d = abs(nonbrand_spend - current_state.nonbrand_spend) / max_nonbrand_spend
            distance += d * 3.0
            weights_sum += 3.0

        if current_state.is_promo is not None and ctx:
            d = 0.0 if ctx.is_promo == current_state.is_promo else 1.0
            distance += d * 2.0
            weights_sum += 2.0

        if current_state.season is not None and ctx and ctx.season:
            d = 0.0 if ctx.season == current_state.season else 1.0
            distance += d * 1.5
            weights_sum += 1.5

        if current_state.day_of_week is not None and ctx and ctx.day_of_week:
            d = 0.0 if ctx.day_of_week == current_state.day_of_week else 0.5
            distance += d * 1.0
            weights_sum += 1.0

        if current_state.weather_condition is not None and ctx and ctx.weather_condition:
            d = 0.0 if ctx.weather_condition == current_state.weather_condition else 1.0
            distance += d * 0.5
            weights_sum += 0.5

        if current_state.temperature_c is not None and ctx and ctx.temperature_c is not None:
            d = min(abs(ctx.temperature_c - current_state.temperature_c) / 40.0, 1.0)
            distance += d * 0.5
            weights_sum += 0.5

        # Normalize distance and convert to similarity score (0-1)
        if weights_sum > 0:
            normalized_distance = distance / weights_sum
        else:
            normalized_distance = 0.5  # No filters: moderate similarity for all

        similarity = round(1.0 - min(normalized_distance, 1.0), 4)

        scored_states.append(SimilarState(
            date=row.date,
            similarity_score=similarity,
            brand_spend=brand_spend,
            nonbrand_spend=nonbrand_spend,
            total_revenue=float(row.total_revenue) if row.total_revenue else 0.0,
            total_conversions=float(row.total_conversions) if row.total_conversions else 0.0,
            brand_roas=round(brand_rev / brand_spend, 4) if brand_spend > 0 else 0.0,
            nonbrand_roas=round(nonbrand_rev / nonbrand_spend, 4) if nonbrand_spend > 0 else 0.0,
            is_promo=ctx.is_promo if ctx else False,
            season=ctx.season if ctx else None,
            day_of_week=ctx.day_of_week if ctx else None,
            weather_condition=ctx.weather_condition if ctx else None,
        ))

    # Sort by similarity descending and take top_k
    scored_states.sort(key=lambda s: s.similarity_score, reverse=True)
    top_states = scored_states[:top_k]

    return SimilarStatesResponse(
        query_state=current_state.model_dump(exclude_none=True),
        similar_states=top_states,
        total_states_searched=len(scored_states),
    )


@router.get("/query")
def query_patterns(
    q: str = Query(..., description="Natural language-ish query for pattern matching"),
    db: Session = Depends(get_db),
):
    """
    Natural language-ish query for pattern matching.

    Supports queries like:
    - "promo days" -> finds all promo days
    - "high spend" -> finds days with above-average spend
    - "winter" -> finds winter season days
    - "weekend" -> finds Saturday/Sunday days
    """
    query_lower = q.lower().strip()

    # Parse intent from query
    filters = {}

    # Promo
    if "promo" in query_lower or "promotion" in query_lower or "sale" in query_lower:
        filters["is_promo"] = True

    # Season
    for season in ["winter", "spring", "summer", "fall", "autumn"]:
        if season in query_lower:
            filters["season"] = "fall" if season == "autumn" else season
            break

    # Day of week
    weekend_days = {"saturday", "sunday"}
    weekday_names = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
    if "weekend" in query_lower:
        filters["day_type"] = "weekend"
    elif "weekday" in query_lower:
        filters["day_type"] = "weekday"
    else:
        for day in weekday_names:
            if day in query_lower:
                filters["day_of_week"] = day.capitalize()
                break

    # Build query
    daily_q = (
        db.query(
            DailyMetrics.date,
            func.sum(DailyMetrics.cost).label("total_cost"),
            func.sum(DailyMetrics.revenue).label("total_revenue"),
            func.sum(DailyMetrics.conversions).label("total_conversions"),
            func.sum(DailyMetrics.orders).label("total_orders"),
        )
        .join(Campaign, Campaign.id == DailyMetrics.campaign_id)
        .group_by(DailyMetrics.date)
    )

    # Apply spend filters via subquery approach
    results_raw = daily_q.all()

    # Get contextual data
    ctx_data = {cd.date: cd for cd in db.query(ContextualData).all()}

    # Filter and enrich
    matched = []
    for row in results_raw:
        ctx = ctx_data.get(row.date)
        total_cost = float(row.total_cost) if row.total_cost else 0.0
        total_revenue = float(row.total_revenue) if row.total_revenue else 0.0

        # Apply filters
        if "is_promo" in filters:
            if not ctx or ctx.is_promo != filters["is_promo"]:
                continue

        if "season" in filters:
            if not ctx or (ctx.season and ctx.season.lower() != filters["season"]):
                continue

        if "day_of_week" in filters:
            if not ctx or (ctx.day_of_week and ctx.day_of_week.lower() != filters["day_of_week"].lower()):
                continue

        if "day_type" in filters:
            if ctx and ctx.day_of_week:
                is_weekend = ctx.day_of_week.lower() in weekend_days
                if filters["day_type"] == "weekend" and not is_weekend:
                    continue
                if filters["day_type"] == "weekday" and is_weekend:
                    continue

        matched.append({
            "date": str(row.date),
            "total_cost": total_cost,
            "total_revenue": total_revenue,
            "total_conversions": float(row.total_conversions) if row.total_conversions else 0.0,
            "total_orders": int(row.total_orders) if row.total_orders else 0,
            "roas": round(total_revenue / total_cost, 4) if total_cost > 0 else 0.0,
            "context": {
                "is_promo": ctx.is_promo if ctx else None,
                "season": ctx.season if ctx else None,
                "day_of_week": ctx.day_of_week if ctx else None,
                "weather_condition": ctx.weather_condition if ctx else None,
                "promo_name": ctx.promo_name if ctx else None,
            } if ctx else None,
        })

    # High spend / low spend filter (post-aggregation)
    if "high spend" in query_lower or "high cost" in query_lower:
        if matched:
            avg_cost = sum(m["total_cost"] for m in matched) / len(matched)
            matched = [m for m in matched if m["total_cost"] > avg_cost]

    if "low spend" in query_lower or "low cost" in query_lower:
        if matched:
            avg_cost = sum(m["total_cost"] for m in matched) / len(matched)
            matched = [m for m in matched if m["total_cost"] < avg_cost]

    if "high roas" in query_lower:
        if matched:
            avg_roas = sum(m["roas"] for m in matched) / len(matched)
            matched = [m for m in matched if m["roas"] > avg_roas]

    # Summary statistics
    summary = {}
    if matched:
        costs = [m["total_cost"] for m in matched]
        revenues = [m["total_revenue"] for m in matched]
        summary = {
            "count": len(matched),
            "avg_cost": round(sum(costs) / len(costs), 2),
            "avg_revenue": round(sum(revenues) / len(revenues), 2),
            "avg_roas": round(sum(m["roas"] for m in matched) / len(matched), 4),
        }

    return {
        "query": q,
        "interpreted_filters": filters,
        "matches": matched[:100],  # Limit to 100 results
        "total_matches": len(matched),
        "summary": summary,
    }


@router.get("/states", response_model=List[ContextualDataRead])
def list_contextual_states(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List all contextual states (contextual data entries)."""
    q = db.query(ContextualData)

    if start_date:
        q = q.filter(ContextualData.date >= start_date)
    if end_date:
        q = q.filter(ContextualData.date <= end_date)

    items = q.order_by(ContextualData.date.desc()).offset(skip).limit(limit).all()
    return [ContextualDataRead.model_validate(cd) for cd in items]
