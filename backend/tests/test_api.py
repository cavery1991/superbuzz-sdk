"""Tests for API endpoints."""

import pytest
from datetime import date, datetime
from app.models.campaign import (
    DataSource, Campaign, DailyMetrics, Insight, Recommendation, BrandKeyword
)


def _seed_basic_data(db):
    """Seed minimal data for API tests."""
    source = DataSource(name="google_ads", source_type="ppc", is_active=True)
    db.add(source)
    db.flush()

    campaign = Campaign(
        data_source_id=source.id,
        external_id="test-1",
        name="Test Brand Campaign",
        campaign_type="brand",
        channel="google_ads",
        status="active",
    )
    db.add(campaign)
    db.flush()

    for i in range(7):
        d = date(2026, 3, 25 + i)
        metrics = DailyMetrics(
            campaign_id=campaign.id,
            date=d,
            impressions=1000 + i * 100,
            clicks=100 + i * 10,
            cost=50.0 + i * 5,
            conversions=10 + i,
            revenue=500.0 + i * 50,
            new_customers=3 + i,
            returning_customers=7,
            orders=10 + i,
            cogs=175.0 + i * 17,
            gross_margin=325.0 + i * 33,
        )
        db.add(metrics)

    insight = Insight(
        date=date(2026, 3, 31),
        category="brand_efficiency",
        title="Test Insight",
        body="Brand spend increased but revenue stayed flat.",
        interpretation="Low incremental return from brand spend.",
        confidence="medium",
        recommended_action="Reduce brand spend by 15%.",
        evidence_json='{"spend_change": 0.28}',
        is_dismissed=False,
    )
    db.add(insight)

    rec = Recommendation(
        date=date(2026, 3, 31),
        action="Reduce brand spend by 15-20%",
        rationale="Brand spend shows diminishing returns.",
        expected_effect="Save $200/day with minimal revenue impact.",
        confidence="high",
        risk="Small risk of losing some branded impression share.",
        evidence_json='{}',
        status="pending",
    )
    db.add(rec)

    keyword = BrandKeyword(
        keyword="evergreen",
        match_type="contains",
        classification="brand",
        is_active=True,
    )
    db.add(keyword)

    db.commit()
    return campaign.id


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_list_campaigns(client, db):
    _seed_basic_data(db)
    response = client.get("/api/v1/campaigns")
    assert response.status_code == 200
    data = response.json()
    # Response is wrapped: {"items": [...], "total": n}
    assert data["total"] >= 1
    assert data["items"][0]["name"] == "Test Brand Campaign"


def test_kpi_summary(client, db):
    _seed_basic_data(db)
    response = client.get("/api/v1/metrics/kpi-summary")
    assert response.status_code == 200
    data = response.json()
    assert "total_spend" in data
    assert "total_revenue" in data
    assert data["total_spend"] > 0
    assert data["total_revenue"] > 0


def test_list_insights(client, db):
    _seed_basic_data(db)
    response = client.get("/api/v1/insights")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert data["items"][0]["title"] == "Test Insight"
    assert data["items"][0]["confidence"] == "medium"


def test_list_recommendations(client, db):
    _seed_basic_data(db)
    response = client.get("/api/v1/recommendations")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert data["items"][0]["confidence"] == "high"


def test_brand_keywords(client, db):
    _seed_basic_data(db)
    response = client.get("/api/v1/admin/brand-keywords")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert data["items"][0]["keyword"] == "evergreen"


def test_add_brand_keyword(client, db):
    response = client.post("/api/v1/admin/brand-keywords", json={
        "keyword": "new_brand",
        "match_type": "exact",
        "classification": "brand",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["keyword"] == "new_brand"
