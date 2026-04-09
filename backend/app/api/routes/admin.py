"""Admin routes for managing brand keywords, classification rules, and contextual data."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.campaign import BrandKeyword, ClassificationRule, ContextualData
from app.schemas.campaign import (
    BrandKeywordCreate,
    BrandKeywordRead,
    BrandKeywordList,
    ClassificationRuleCreate,
    ClassificationRuleUpdate,
    ClassificationRuleRead,
    ClassificationRuleList,
    ContextualDataCreate,
    ContextualDataRead,
    ContextualDataList,
)

router = APIRouter(prefix="/admin", tags=["admin"])


# ──────────────────────────────────────────────
# Brand Keywords
# ──────────────────────────────────────────────

@router.get("/brand-keywords", response_model=BrandKeywordList)
def list_brand_keywords(
    is_active: Optional[bool] = Query(None),
    classification: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List all brand keywords."""
    q = db.query(BrandKeyword)

    if is_active is not None:
        q = q.filter(BrandKeyword.is_active == is_active)
    if classification:
        q = q.filter(BrandKeyword.classification == classification)

    total = q.count()
    items = q.order_by(BrandKeyword.created_at.desc()).offset(skip).limit(limit).all()

    return BrandKeywordList(
        items=[BrandKeywordRead.model_validate(bk) for bk in items],
        total=total,
    )


@router.post("/brand-keywords", response_model=BrandKeywordRead, status_code=201)
def add_brand_keyword(payload: BrandKeywordCreate, db: Session = Depends(get_db)):
    """Add a new brand keyword."""
    valid_match_types = {"exact", "contains", "regex"}
    if payload.match_type not in valid_match_types:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid match_type. Must be one of: {', '.join(valid_match_types)}",
        )

    valid_classifications = {"brand", "competitor"}
    if payload.classification not in valid_classifications:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid classification. Must be one of: {', '.join(valid_classifications)}",
        )

    bk = BrandKeyword(
        keyword=payload.keyword,
        match_type=payload.match_type,
        classification=payload.classification,
        is_active=payload.is_active,
    )
    db.add(bk)
    db.commit()
    db.refresh(bk)
    return BrandKeywordRead.model_validate(bk)


@router.delete("/brand-keywords/{keyword_id}", status_code=204)
def delete_brand_keyword(keyword_id: int, db: Session = Depends(get_db)):
    """Remove a brand keyword."""
    bk = db.query(BrandKeyword).filter(BrandKeyword.id == keyword_id).first()
    if not bk:
        raise HTTPException(status_code=404, detail="Brand keyword not found")

    db.delete(bk)
    db.commit()
    return None


# ──────────────────────────────────────────────
# Classification Rules
# ──────────────────────────────────────────────

@router.get("/classification-rules", response_model=ClassificationRuleList)
def list_classification_rules(
    is_active: Optional[bool] = Query(None),
    classification: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List all classification rules."""
    q = db.query(ClassificationRule)

    if is_active is not None:
        q = q.filter(ClassificationRule.is_active == is_active)
    if classification:
        q = q.filter(ClassificationRule.classification == classification)

    total = q.count()
    items = (
        q.order_by(ClassificationRule.priority.desc(), ClassificationRule.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    return ClassificationRuleList(
        items=[ClassificationRuleRead.model_validate(r) for r in items],
        total=total,
    )


@router.post("/classification-rules", response_model=ClassificationRuleRead, status_code=201)
def add_classification_rule(payload: ClassificationRuleCreate, db: Session = Depends(get_db)):
    """Add a new classification rule."""
    valid_match_types = {"exact", "contains", "regex"}
    if payload.match_type not in valid_match_types:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid match_type. Must be one of: {', '.join(valid_match_types)}",
        )

    valid_classifications = {"brand", "nonbrand", "competitor"}
    if payload.classification not in valid_classifications:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid classification. Must be one of: {', '.join(valid_classifications)}",
        )

    rule = ClassificationRule(
        pattern=payload.pattern,
        match_type=payload.match_type,
        classification=payload.classification,
        priority=payload.priority,
        is_active=payload.is_active,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return ClassificationRuleRead.model_validate(rule)


@router.put("/classification-rules/{rule_id}", response_model=ClassificationRuleRead)
def update_classification_rule(
    rule_id: int,
    payload: ClassificationRuleUpdate,
    db: Session = Depends(get_db),
):
    """Update an existing classification rule."""
    rule = db.query(ClassificationRule).filter(ClassificationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Classification rule not found")

    valid_match_types = {"exact", "contains", "regex"}
    valid_classifications = {"brand", "nonbrand", "competitor"}

    if payload.match_type is not None:
        if payload.match_type not in valid_match_types:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid match_type. Must be one of: {', '.join(valid_match_types)}",
            )
        rule.match_type = payload.match_type

    if payload.classification is not None:
        if payload.classification not in valid_classifications:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid classification. Must be one of: {', '.join(valid_classifications)}",
            )
        rule.classification = payload.classification

    if payload.pattern is not None:
        rule.pattern = payload.pattern
    if payload.priority is not None:
        rule.priority = payload.priority
    if payload.is_active is not None:
        rule.is_active = payload.is_active

    db.commit()
    db.refresh(rule)
    return ClassificationRuleRead.model_validate(rule)


@router.delete("/classification-rules/{rule_id}", status_code=204)
def delete_classification_rule(rule_id: int, db: Session = Depends(get_db)):
    """Delete a classification rule."""
    rule = db.query(ClassificationRule).filter(ClassificationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Classification rule not found")

    db.delete(rule)
    db.commit()
    return None


# ──────────────────────────────────────────────
# Contextual Data
# ──────────────────────────────────────────────

@router.get("/contextual-data", response_model=ContextualDataList)
def list_contextual_data(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    is_promo: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List contextual data entries."""
    q = db.query(ContextualData)

    if start_date:
        q = q.filter(ContextualData.date >= start_date)
    if end_date:
        q = q.filter(ContextualData.date <= end_date)
    if is_promo is not None:
        q = q.filter(ContextualData.is_promo == is_promo)

    total = q.count()
    items = q.order_by(ContextualData.date.desc()).offset(skip).limit(limit).all()

    return ContextualDataList(
        items=[ContextualDataRead.model_validate(cd) for cd in items],
        total=total,
    )


@router.post("/contextual-data", response_model=ContextualDataRead, status_code=201)
def add_or_update_contextual_data(payload: ContextualDataCreate, db: Session = Depends(get_db)):
    """
    Add or update contextual data for a date.

    If an entry already exists for the given date, it will be updated.
    Otherwise, a new entry is created.
    """
    existing = db.query(ContextualData).filter(ContextualData.date == payload.date).first()

    if existing:
        # Update existing entry
        if payload.day_of_week is not None:
            existing.day_of_week = payload.day_of_week
        if payload.month is not None:
            existing.month = payload.month
        if payload.season is not None:
            existing.season = payload.season
        if payload.temperature_c is not None:
            existing.temperature_c = payload.temperature_c
        if payload.weather_condition is not None:
            existing.weather_condition = payload.weather_condition
        existing.is_promo = payload.is_promo
        if payload.promo_name is not None:
            existing.promo_name = payload.promo_name
        if payload.stock_status is not None:
            existing.stock_status = payload.stock_status
        if payload.notes is not None:
            existing.notes = payload.notes

        db.commit()
        db.refresh(existing)
        return ContextualDataRead.model_validate(existing)
    else:
        cd = ContextualData(
            date=payload.date,
            day_of_week=payload.day_of_week,
            month=payload.month,
            season=payload.season,
            temperature_c=payload.temperature_c,
            weather_condition=payload.weather_condition,
            is_promo=payload.is_promo,
            promo_name=payload.promo_name,
            stock_status=payload.stock_status,
            notes=payload.notes,
        )
        db.add(cd)
        db.commit()
        db.refresh(cd)
        return ContextualDataRead.model_validate(cd)
