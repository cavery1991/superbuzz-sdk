"""Tests for Python analysis modules."""

import pandas as pd
import pytest
from analysis import search_query_mining, pmax_segmentation, search_term_triage


def make_search_df(rows):
    defaults = {
        "search_term": "test term",
        "impressions": 1000,
        "clicks": 50,
        "cost": 100,
        "conversions": 5,
        "conversion_value": 500,
    }
    data = [{**defaults, **r} for r in rows]
    return pd.DataFrame(data)


def make_product_df(rows):
    defaults = {
        "product_id": "SKU-001",
        "title": "Test Product",
        "category": "General",
        "price": 100,
        "cost_of_goods": 50,
        "impressions": 1000,
        "clicks": 50,
        "cost": 100,
        "conversions": 5,
        "conversion_value": 500,
    }
    data = [{**defaults, **r} for r in rows]
    return pd.DataFrame(data)


# ── Search Query Mining ──

class TestSearchQueryMining:
    def test_intent_classification(self):
        assert search_query_mining.classify_intent("buy shoes online") == "high-intent-transactional"
        assert search_query_mining.classify_intent("how to clean shoes") == "informational"
        assert search_query_mining.classify_intent("shoes") == "generic"

    def test_intent_brand(self):
        assert search_query_mining.classify_intent("mybrand shoes", brand_terms=["mybrand"]) == "brand"

    def test_profitability(self):
        row = {"clicks": 50, "cost": 100, "conversions": 5, "conversion_value": 500, "impressions": 1000}
        assert search_query_mining.classify_profitability(row) == "profitable"

    def test_profitability_wasteful(self):
        row = {"clicks": 50, "cost": 200, "conversions": 1, "conversion_value": 50, "impressions": 1000}
        assert search_query_mining.classify_profitability(row) == "wasteful"

    def test_negatives(self):
        df = make_search_df([
            {"search_term": "free stuff", "clicks": 20, "cost": 50, "conversions": 0, "conversion_value": 0},
        ])
        result = search_query_mining.find_negatives(df)
        assert len(result) == 1
        assert result.iloc[0]["search_term"] == "free stuff"

    def test_expansions(self):
        df = make_search_df([
            {"search_term": "great product", "clicks": 30, "conversions": 5, "cost": 50, "conversion_value": 300},
        ])
        result = search_query_mining.find_expansions(df)
        assert len(result) == 1

    def test_full_run(self):
        df = make_search_df([
            {"search_term": "buy running shoes", "cost": 100, "conversion_value": 600, "clicks": 50, "conversions": 10},
            {"search_term": "free downloads", "cost": 80, "conversion_value": 0, "conversions": 0, "clicks": 40},
        ])
        results = search_query_mining.run(df)
        assert "Summary" in results
        assert "Negative Keyword Candidates" in results
        assert len(results["Summary"]) == 2


# ── PMax Segmentation ──

class TestPMaxSegmentation:
    def test_margin_calc(self):
        row = {"price": 100, "cost_of_goods": 30}
        assert pmax_segmentation.calc_margin(row) == 70.0

    def test_margin_tiers(self):
        assert pmax_segmentation.margin_tier(60) == "high-margin"
        assert pmax_segmentation.margin_tier(35) == "mid-margin"
        assert pmax_segmentation.margin_tier(10) == "low-margin"
        assert pmax_segmentation.margin_tier(-5) == "negative-margin"

    def test_performance_tiers(self):
        hero = {"impressions": 2000, "clicks": 100, "cost": 200, "conversions": 15, "conversion_value": 1500}
        assert pmax_segmentation.performance_tier(hero) == "hero"

        zombie = {"impressions": 10, "clicks": 0, "cost": 0, "conversions": 0, "conversion_value": 0}
        assert pmax_segmentation.performance_tier(zombie) == "zombie"

    def test_full_run(self):
        df = make_product_df([
            {"product_id": "A", "price": 100, "cost_of_goods": 30, "conversions": 15, "conversion_value": 1500, "cost": 200, "clicks": 80, "impressions": 3000},
            {"product_id": "B", "price": 50, "cost_of_goods": 45, "impressions": 20, "clicks": 0, "cost": 0, "conversions": 0, "conversion_value": 0},
        ])
        results = pmax_segmentation.run(df)
        assert "Asset Group Recommendations" in results
        assert "Insights" in results
        assert len(results["Insights"]) >= 1


# ── Search Term Triage ──

class TestSearchTermTriage:
    def test_negative_action(self):
        row = {"search_term": "junk", "impressions": 1000, "clicks": 20, "cost": 50,
               "conversions": 0, "conversion_value": 0}
        result = search_term_triage.triage_term(row)
        assert result["action"] == "add_negative"

    def test_isolate_action(self):
        row = {"search_term": "great term", "impressions": 1000, "clicks": 40, "cost": 50,
               "conversions": 5, "conversion_value": 500}
        result = search_term_triage.triage_term(row)
        assert result["action"].startswith("isolate")

    def test_leave_action(self):
        row = {"search_term": "ok term", "impressions": 1000, "clicks": 30, "cost": 80,
               "conversions": 4, "conversion_value": 200, "match_type": "broad"}
        result = search_term_triage.triage_term(row)
        assert result["action"] == "leave_in_broad"

    def test_skip_low_data(self):
        row = {"search_term": "rare", "impressions": 50, "clicks": 3, "cost": 5,
               "conversions": 0, "conversion_value": 0}
        assert search_term_triage.triage_term(row) is None

    def test_landing_page_gaps(self):
        df = make_search_df([
            {"search_term": "no lp term", "clicks": 10, "landing_page": ""},
        ])
        df["landing_page"] = ""
        gaps = search_term_triage.find_landing_page_gaps(df)
        assert len(gaps) == 1

    def test_full_run(self):
        df = make_search_df([
            {"search_term": "negate me", "clicks": 20, "cost": 60, "conversions": 0, "conversion_value": 0},
            {"search_term": "isolate me", "clicks": 40, "cost": 50, "conversions": 5, "conversion_value": 500},
            {"search_term": "leave me", "clicks": 30, "cost": 80, "conversions": 4, "conversion_value": 200},
        ])
        results = search_term_triage.run(df)
        assert "Action Queue" in results
        assert "Summary" in results
        assert len(results["Action Queue"]) == 3
