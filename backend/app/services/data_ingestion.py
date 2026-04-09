"""
Data ingestion service for normalizing data from various sources
into the unified daily grain model.

This module provides connectors and normalization logic for:
- Google Ads
- GA4
- Shopify
- Meta Ads (placeholder)
- TikTok Ads (placeholder)
- Google Search Console (placeholder)
- Weather API (placeholder)
"""

from datetime import date, datetime
from typing import Optional
from sqlalchemy.orm import Session

from app.models.campaign import (
    DataSource, Campaign, DailyMetrics, OrganicMetrics,
    ShopifyOrder, ContextualData, SearchTerm
)


class GoogleAdsConnector:
    """
    Connector for Google Ads API.
    In production, this would use the google-ads Python client library.
    Currently provides the interface and mock implementation.
    """

    def __init__(self, client_id: str = "", client_secret: str = "",
                 refresh_token: str = "", developer_token: str = "",
                 customer_id: str = ""):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.developer_token = developer_token
        self.customer_id = customer_id

    def fetch_campaigns(self, start_date: date, end_date: date) -> list[dict]:
        """Fetch campaign performance data from Google Ads."""
        # In production: use google.ads.googleads.client.GoogleAdsClient
        # Query: SELECT campaign.id, campaign.name, metrics.impressions, ...
        # FROM campaign WHERE segments.date BETWEEN '{start}' AND '{end}'
        raise NotImplementedError(
            "Connect real Google Ads API credentials to enable. "
            "See .env.example for required fields."
        )

    def fetch_search_terms(self, start_date: date, end_date: date) -> list[dict]:
        """Fetch search term report from Google Ads."""
        raise NotImplementedError(
            "Connect real Google Ads API credentials to enable."
        )


class GA4Connector:
    """
    Connector for Google Analytics 4 via the Data API.
    """

    def __init__(self, property_id: str = "", credentials_json: str = ""):
        self.property_id = property_id
        self.credentials_json = credentials_json

    def fetch_traffic_data(self, start_date: date, end_date: date) -> list[dict]:
        """Fetch session and revenue data from GA4."""
        # In production: use google.analytics.data_v1beta
        raise NotImplementedError(
            "Connect real GA4 credentials to enable. "
            "See .env.example for required fields."
        )


class ShopifyConnector:
    """
    Connector for Shopify Admin API.
    """

    def __init__(self, store_url: str = "", access_token: str = ""):
        self.store_url = store_url
        self.access_token = access_token

    def fetch_orders(self, start_date: date, end_date: date) -> list[dict]:
        """Fetch orders from Shopify."""
        # In production: use shopify Python library or REST API
        raise NotImplementedError(
            "Connect real Shopify credentials to enable. "
            "See .env.example for required fields."
        )


class MetaAdsConnector:
    """Placeholder connector for Meta (Facebook/Instagram) Ads."""

    def __init__(self, access_token: str = "", ad_account_id: str = ""):
        self.access_token = access_token
        self.ad_account_id = ad_account_id

    def fetch_campaigns(self, start_date: date, end_date: date) -> list[dict]:
        raise NotImplementedError("Meta Ads connector not yet implemented.")


class TikTokAdsConnector:
    """Placeholder connector for TikTok Ads."""

    def __init__(self, access_token: str = "", advertiser_id: str = ""):
        self.access_token = access_token
        self.advertiser_id = advertiser_id

    def fetch_campaigns(self, start_date: date, end_date: date) -> list[dict]:
        raise NotImplementedError("TikTok Ads connector not yet implemented.")


class WeatherConnector:
    """Placeholder connector for weather API data."""

    def __init__(self, api_key: str = ""):
        self.api_key = api_key

    def fetch_weather(self, location: str, start_date: date, end_date: date) -> list[dict]:
        raise NotImplementedError("Weather API connector not yet implemented.")


def normalize_to_daily_metrics(
    db: Session,
    campaign_id: int,
    raw_data: list[dict]
) -> int:
    """
    Normalize raw source data into DailyMetrics records.

    Args:
        db: Database session
        campaign_id: ID of the campaign these metrics belong to
        raw_data: List of dicts with keys matching DailyMetrics fields

    Returns:
        Number of records upserted
    """
    count = 0
    for row in raw_data:
        existing = db.query(DailyMetrics).filter(
            DailyMetrics.campaign_id == campaign_id,
            DailyMetrics.date == row["date"]
        ).first()

        if existing:
            for key, value in row.items():
                if key != "date" and hasattr(existing, key):
                    setattr(existing, key, value)
        else:
            metrics = DailyMetrics(
                campaign_id=campaign_id,
                date=row["date"],
                impressions=row.get("impressions", 0),
                clicks=row.get("clicks", 0),
                cost=row.get("cost", 0.0),
                conversions=row.get("conversions", 0),
                revenue=row.get("revenue", 0.0),
                new_customers=row.get("new_customers", 0),
                returning_customers=row.get("returning_customers", 0),
                orders=row.get("orders", 0),
                cogs=row.get("cogs", 0.0),
                gross_margin=row.get("gross_margin", 0.0),
            )
            db.add(metrics)
        count += 1

    db.commit()
    return count


def get_or_create_data_source(
    db: Session,
    name: str,
    source_type: str
) -> DataSource:
    """Get existing or create new data source."""
    source = db.query(DataSource).filter(DataSource.name == name).first()
    if not source:
        source = DataSource(name=name, source_type=source_type, is_active=True)
        db.add(source)
        db.commit()
        db.refresh(source)
    return source
