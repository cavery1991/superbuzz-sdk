"""Tests for the brand/non-brand classification engine."""

import pytest
from datetime import datetime
from app.models.campaign import BrandKeyword, ClassificationRule


class MockBrandKeyword:
    def __init__(self, keyword, match_type="contains", classification="brand"):
        self.keyword = keyword
        self.match_type = match_type
        self.classification = classification
        self.is_active = True


class MockClassificationRule:
    def __init__(self, pattern, match_type="contains", classification="brand", priority=5):
        self.pattern = pattern
        self.match_type = match_type
        self.classification = classification
        self.priority = priority
        self.is_active = True


def make_classifier():
    """Import the classify_term function."""
    from app.engines.classification import classify_term
    return classify_term


def test_brand_keyword_exact_match():
    classify = make_classifier()
    keywords = [MockBrandKeyword("evergreen outdoor", match_type="exact")]
    rules = []
    assert classify("evergreen outdoor", rules, keywords) == "brand"


def test_brand_keyword_contains_match():
    classify = make_classifier()
    keywords = [MockBrandKeyword("evergreen", match_type="contains")]
    rules = []
    assert classify("evergreen hiking boots", rules, keywords) == "brand"


def test_nonbrand_classification():
    classify = make_classifier()
    keywords = [MockBrandKeyword("evergreen", match_type="contains")]
    rules = []
    assert classify("best hiking boots 2024", rules, keywords) == "nonbrand"


def test_competitor_regex_rule():
    classify = make_classifier()
    keywords = [MockBrandKeyword("evergreen", match_type="contains")]
    rules = [MockClassificationRule(
        r"north\s*face|patagonia|columbia",
        match_type="regex",
        classification="competitor",
        priority=5
    )]
    assert classify("patagonia hiking jacket", rules, keywords) == "competitor"


def test_empty_term():
    classify = make_classifier()
    assert classify("", [], []) == "unknown"


def test_rule_priority():
    classify = make_classifier()
    keywords = []
    rules = [
        MockClassificationRule("outdoor", match_type="contains",
                               classification="nonbrand", priority=1),
        MockClassificationRule("evergreen outdoor", match_type="contains",
                               classification="brand", priority=10),
    ]
    assert classify("evergreen outdoor gear", rules, keywords) == "brand"


def test_case_insensitive():
    classify = make_classifier()
    keywords = [MockBrandKeyword("evergreen", match_type="contains")]
    rules = []
    assert classify("EVERGREEN Hiking Boots", rules, keywords) == "brand"
