"""
Brand vs non-brand search term classification engine.

Classifies search terms into brand, nonbrand, or competitor categories
using configurable rules (exact, contains, regex) and brand keyword lists.
"""

import re
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.campaign import (
    BrandKeyword,
    ClassificationRule,
    SearchTerm,
)

logger = logging.getLogger(__name__)


def _normalize_term(term: str) -> str:
    """Lowercase and strip whitespace for consistent matching."""
    return term.strip().lower()


def _match_rule(term_normalized: str, rule: ClassificationRule) -> bool:
    """Check if a normalized search term matches a classification rule."""
    pattern = rule.pattern.strip().lower()

    if rule.match_type == "exact":
        return term_normalized == pattern
    elif rule.match_type == "contains":
        return pattern in term_normalized
    elif rule.match_type == "regex":
        try:
            return bool(re.search(pattern, term_normalized, re.IGNORECASE))
        except re.error:
            logger.warning("Invalid regex pattern in rule %d: %s", rule.id, rule.pattern)
            return False
    return False


def _match_brand_keyword(term_normalized: str, bk: BrandKeyword) -> bool:
    """Check if a normalized search term matches a brand keyword."""
    keyword = bk.keyword.strip().lower()

    if bk.match_type == "exact":
        return term_normalized == keyword
    elif bk.match_type == "contains":
        return keyword in term_normalized
    elif bk.match_type == "regex":
        try:
            return bool(re.search(keyword, term_normalized, re.IGNORECASE))
        except re.error:
            logger.warning("Invalid regex in brand keyword %d: %s", bk.id, bk.keyword)
            return False
    # Default to contains
    return keyword in term_normalized


def classify_term(
    term: str,
    rules: list[ClassificationRule],
    brand_keywords: list[BrandKeyword],
) -> str:
    """
    Classify a single search term as brand, nonbrand, or competitor.

    Classification priority:
    1. Explicit classification rules (sorted by priority descending)
    2. Brand keyword matches
    3. Default to 'nonbrand' if no match found

    Args:
        term: The search term to classify.
        rules: Active classification rules sorted by priority desc.
        brand_keywords: Active brand keywords.

    Returns:
        Classification string: 'brand', 'nonbrand', or 'competitor'.
    """
    if not term or not term.strip():
        return "unknown"

    term_normalized = _normalize_term(term)

    # Phase 1: Check explicit rules in priority order (highest first).
    sorted_rules = sorted(rules, key=lambda r: r.priority, reverse=True)
    for rule in sorted_rules:
        if not rule.is_active:
            continue
        if _match_rule(term_normalized, rule):
            return rule.classification

    # Phase 2: Check brand keywords.
    has_brand_match = False
    has_competitor_match = False

    for bk in brand_keywords:
        if not bk.is_active:
            continue
        if _match_brand_keyword(term_normalized, bk):
            if bk.classification == "competitor":
                has_competitor_match = True
            else:
                has_brand_match = True

    # Competitor takes precedence if there is a brand+competitor overlap
    # (e.g. "nike vs adidas" when adidas is the brand and nike is a competitor keyword)
    if has_competitor_match:
        return "competitor"
    if has_brand_match:
        return "brand"

    # Phase 3: Default
    return "nonbrand"


def classify_all_terms(db: Session) -> dict:
    """
    Reclassify all search terms in the database.

    Loads all active classification rules and brand keywords, then iterates
    over every search term and updates its classification.

    Args:
        db: SQLAlchemy database session.

    Returns:
        Dictionary with classification statistics:
        {
            "total": int,
            "brand": int,
            "nonbrand": int,
            "competitor": int,
            "unknown": int,
            "changed": int,
        }
    """
    rules = (
        db.query(ClassificationRule)
        .filter(ClassificationRule.is_active.is_(True))
        .order_by(ClassificationRule.priority.desc())
        .all()
    )
    brand_keywords = (
        db.query(BrandKeyword)
        .filter(BrandKeyword.is_active.is_(True))
        .all()
    )

    search_terms = db.query(SearchTerm).all()

    stats = {
        "total": 0,
        "brand": 0,
        "nonbrand": 0,
        "competitor": 0,
        "unknown": 0,
        "changed": 0,
    }

    for st in search_terms:
        stats["total"] += 1
        old_classification = st.classification
        new_classification = classify_term(st.term, rules, brand_keywords)
        st.classification = new_classification

        if old_classification != new_classification:
            stats["changed"] += 1

        stats[new_classification] = stats.get(new_classification, 0) + 1

    db.flush()
    logger.info(
        "Reclassified %d search terms: %d changed. brand=%d, nonbrand=%d, competitor=%d, unknown=%d",
        stats["total"],
        stats["changed"],
        stats["brand"],
        stats["nonbrand"],
        stats["competitor"],
        stats["unknown"],
    )

    return stats


def get_coverage_stats(db: Session) -> dict:
    """
    Return classification coverage breakdown for all search terms.

    Args:
        db: SQLAlchemy database session.

    Returns:
        Dictionary with coverage statistics:
        {
            "total_terms": int,
            "classified": int,
            "unclassified": int,
            "coverage_pct": float,
            "by_classification": {
                "brand": {"count": int, "pct": float, "impressions": int, "clicks": int, "cost": float, "revenue": float},
                "nonbrand": {...},
                "competitor": {...},
                "unknown": {...},
            },
            "rule_count": int,
            "brand_keyword_count": int,
        }
    """
    search_terms = db.query(SearchTerm).all()

    total = len(search_terms)
    by_classification: dict[str, dict] = {}

    for st in search_terms:
        cls = st.classification or "unknown"
        if cls not in by_classification:
            by_classification[cls] = {
                "count": 0,
                "pct": 0.0,
                "impressions": 0,
                "clicks": 0,
                "cost": 0.0,
                "revenue": 0.0,
            }
        bucket = by_classification[cls]
        bucket["count"] += 1
        bucket["impressions"] += st.impressions or 0
        bucket["clicks"] += st.clicks or 0
        bucket["cost"] += st.cost or 0.0
        bucket["revenue"] += st.revenue or 0.0

    # Calculate percentages
    for cls, bucket in by_classification.items():
        bucket["pct"] = round((bucket["count"] / total * 100) if total > 0 else 0.0, 2)

    classified = sum(
        v["count"] for k, v in by_classification.items() if k != "unknown"
    )
    unclassified = by_classification.get("unknown", {}).get("count", 0)
    coverage_pct = round((classified / total * 100) if total > 0 else 0.0, 2)

    rule_count = (
        db.query(ClassificationRule)
        .filter(ClassificationRule.is_active.is_(True))
        .count()
    )
    brand_keyword_count = (
        db.query(BrandKeyword)
        .filter(BrandKeyword.is_active.is_(True))
        .count()
    )

    return {
        "total_terms": total,
        "classified": classified,
        "unclassified": unclassified,
        "coverage_pct": coverage_pct,
        "by_classification": by_classification,
        "rule_count": rule_count,
        "brand_keyword_count": brand_keyword_count,
    }
