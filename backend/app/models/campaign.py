from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, DateTime, Text,
    ForeignKey, Index, JSON,
)
from sqlalchemy.orm import relationship
from app.database import Base


class DataSource(Base):
    __tablename__ = "data_sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    source_type = Column(String(50), nullable=False)  # google_ads, ga4, shopify, meta_ads
    config_json = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    campaigns = relationship("Campaign", back_populates="data_source")

    def __repr__(self):
        return f"<DataSource(id={self.id}, name='{self.name}', type='{self.source_type}')>"


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    data_source_id = Column(Integer, ForeignKey("data_sources.id"), nullable=False)
    external_id = Column(String(255), nullable=True)
    name = Column(String(500), nullable=False)
    campaign_type = Column(String(50), default="unknown", nullable=False)  # brand/nonbrand/competitor/unknown
    channel = Column(String(100), nullable=True)
    status = Column(String(50), default="active", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    data_source = relationship("DataSource", back_populates="campaigns")
    daily_metrics = relationship("DailyMetrics", back_populates="campaign", cascade="all, delete-orphan")
    search_terms = relationship("SearchTerm", back_populates="campaign", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Campaign(id={self.id}, name='{self.name}', type='{self.campaign_type}')>"


class DailyMetrics(Base):
    __tablename__ = "daily_metrics"
    __table_args__ = (
        Index("ix_daily_metrics_campaign_date", "campaign_id", "date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    date = Column(Date, nullable=False)
    impressions = Column(Integer, default=0, nullable=False)
    clicks = Column(Integer, default=0, nullable=False)
    cost = Column(Float, default=0.0, nullable=False)
    conversions = Column(Float, default=0.0, nullable=False)
    revenue = Column(Float, default=0.0, nullable=False)
    new_customers = Column(Integer, default=0, nullable=False)
    returning_customers = Column(Integer, default=0, nullable=False)
    orders = Column(Integer, default=0, nullable=False)
    cogs = Column(Float, default=0.0, nullable=False)
    gross_margin = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    campaign = relationship("Campaign", back_populates="daily_metrics")

    def __repr__(self):
        return f"<DailyMetrics(campaign_id={self.campaign_id}, date={self.date}, cost={self.cost}, revenue={self.revenue})>"


class SearchTerm(Base):
    __tablename__ = "search_terms"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    term = Column(String(500), nullable=False)
    classification = Column(String(50), default="unknown", nullable=False)  # brand/nonbrand/competitor/unknown
    match_type = Column(String(50), nullable=True)
    date = Column(Date, nullable=True)
    impressions = Column(Integer, default=0, nullable=False)
    clicks = Column(Integer, default=0, nullable=False)
    cost = Column(Float, default=0.0, nullable=False)
    conversions = Column(Float, default=0.0, nullable=False)
    revenue = Column(Float, default=0.0, nullable=False)

    campaign = relationship("Campaign", back_populates="search_terms")

    def __repr__(self):
        return f"<SearchTerm(id={self.id}, term='{self.term}', classification='{self.classification}')>"


class BrandKeyword(Base):
    __tablename__ = "brand_keywords"

    id = Column(Integer, primary_key=True, index=True)
    keyword = Column(String(255), nullable=False)
    match_type = Column(String(50), default="contains", nullable=False)  # exact/contains/regex
    classification = Column(String(50), default="brand", nullable=False)  # brand/competitor
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<BrandKeyword(id={self.id}, keyword='{self.keyword}', type='{self.match_type}')>"


class OrganicMetrics(Base):
    __tablename__ = "organic_metrics"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    source = Column(String(50), nullable=False)  # ga4/gsc
    organic_sessions = Column(Integer, default=0, nullable=False)
    organic_revenue = Column(Float, default=0.0, nullable=False)
    organic_conversions = Column(Float, default=0.0, nullable=False)
    brand_organic_sessions = Column(Integer, default=0, nullable=False)
    nonbrand_organic_sessions = Column(Integer, default=0, nullable=False)

    def __repr__(self):
        return f"<OrganicMetrics(date={self.date}, source='{self.source}', sessions={self.organic_sessions})>"


class ShopifyOrder(Base):
    __tablename__ = "shopify_orders"

    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(String(255), nullable=True)
    date = Column(Date, nullable=False)
    revenue = Column(Float, default=0.0, nullable=False)
    cogs = Column(Float, default=0.0, nullable=False)
    gross_margin = Column(Float, default=0.0, nullable=False)
    new_customer = Column(Boolean, default=False, nullable=False)
    source_channel = Column(String(100), nullable=True)
    utm_source = Column(String(255), nullable=True)
    utm_medium = Column(String(255), nullable=True)
    utm_campaign = Column(String(255), nullable=True)
    promo_code = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<ShopifyOrder(id={self.id}, external_id='{self.external_id}', revenue={self.revenue})>"


class ContextualData(Base):
    __tablename__ = "contextual_data"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, unique=True)
    day_of_week = Column(String(20), nullable=True)
    month = Column(String(20), nullable=True)
    season = Column(String(20), nullable=True)
    temperature_c = Column(Float, nullable=True)
    weather_condition = Column(String(100), nullable=True)
    is_promo = Column(Boolean, default=False, nullable=False)
    promo_name = Column(String(255), nullable=True)
    stock_status = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)

    def __repr__(self):
        return f"<ContextualData(date={self.date}, is_promo={self.is_promo})>"


class Experiment(Base):
    __tablename__ = "experiments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    experiment_type = Column(String(50), nullable=False)  # geo_holdout/time_holdout/budget_shift
    status = Column(String(50), default="draft", nullable=False)  # draft/running/completed/cancelled
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    treatment_description = Column(Text, nullable=True)
    control_description = Column(Text, nullable=True)
    config_json = Column(JSON, nullable=True)
    results_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<Experiment(id={self.id}, name='{self.name}', status='{self.status}')>"


class ClassificationRule(Base):
    __tablename__ = "classification_rules"

    id = Column(Integer, primary_key=True, index=True)
    pattern = Column(String(500), nullable=False)
    match_type = Column(String(50), default="contains", nullable=False)  # exact/contains/regex
    classification = Column(String(50), nullable=False)  # brand/nonbrand/competitor
    priority = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<ClassificationRule(id={self.id}, pattern='{self.pattern}', classification='{self.classification}')>"


class Insight(Base):
    __tablename__ = "insights"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    category = Column(String(50), nullable=False)  # brand_efficiency/incrementality/causation/pattern/general
    title = Column(String(500), nullable=False)
    body = Column(Text, nullable=True)
    interpretation = Column(Text, nullable=True)
    confidence = Column(String(20), default="medium", nullable=False)  # high/medium/low
    recommended_action = Column(Text, nullable=True)
    evidence_json = Column(JSON, nullable=True)
    is_dismissed = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<Insight(id={self.id}, title='{self.title}', confidence='{self.confidence}')>"


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    action = Column(Text, nullable=False)
    rationale = Column(Text, nullable=True)
    expected_effect = Column(Text, nullable=True)
    confidence = Column(String(20), default="medium", nullable=False)  # high/medium/low
    risk = Column(Text, nullable=True)
    evidence_json = Column(JSON, nullable=True)
    status = Column(String(50), default="pending", nullable=False)  # pending/accepted/rejected/expired
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<Recommendation(id={self.id}, action='{self.action[:50]}', status='{self.status}')>"
