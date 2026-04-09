"""Search terms routes for listing, coverage stats, and reclassification."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.campaign import SearchTerm
from app.schemas.campaign import (
    SearchTermRead,
    SearchTermList,
    ClassificationCoverage,
)
from app.engines.classification import classify_all_terms

router = APIRouter(prefix="/search-terms", tags=["search-terms"])


@router.get("", response_model=SearchTermList)
def list_search_terms(
    classification: Optional[str] = Query(None),
    campaign_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List search terms with optional classification filter."""
    q = db.query(SearchTerm)

    if classification:
        q = q.filter(SearchTerm.classification == classification)
    if campaign_id:
        q = q.filter(SearchTerm.campaign_id == campaign_id)

    total = q.count()
    items = q.order_by(SearchTerm.id.desc()).offset(skip).limit(limit).all()

    return SearchTermList(
        items=[SearchTermRead.model_validate(st) for st in items],
        total=total,
    )


@router.get("/coverage", response_model=ClassificationCoverage)
def get_classification_coverage(db: Session = Depends(get_db)):
    """Classification coverage stats."""
    total = db.query(SearchTerm).count()

    counts = (
        db.query(SearchTerm.classification, func.count(SearchTerm.id))
        .group_by(SearchTerm.classification)
        .all()
    )

    breakdown = {cls: cnt for cls, cnt in counts}

    brand_count = breakdown.get("brand", 0)
    nonbrand_count = breakdown.get("nonbrand", 0)
    competitor_count = breakdown.get("competitor", 0)
    unknown_count = breakdown.get("unknown", 0)

    return ClassificationCoverage(
        total_terms=total,
        brand_count=brand_count,
        nonbrand_count=nonbrand_count,
        competitor_count=competitor_count,
        unknown_count=unknown_count,
        brand_pct=round(brand_count / total * 100, 2) if total > 0 else 0.0,
        nonbrand_pct=round(nonbrand_count / total * 100, 2) if total > 0 else 0.0,
        competitor_pct=round(competitor_count / total * 100, 2) if total > 0 else 0.0,
        unknown_pct=round(unknown_count / total * 100, 2) if total > 0 else 0.0,
    )


@router.post("/reclassify")
def reclassify_search_terms(db: Session = Depends(get_db)):
    """Trigger reclassification of all search terms using current rules and brand keywords."""
    stats = classify_all_terms(db)
    db.commit()
    return {
        "message": "Reclassification complete",
        "stats": stats,
    }
