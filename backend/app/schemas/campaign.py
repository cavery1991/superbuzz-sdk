import datetime as dt
from typing import Optional, List, Any
from pydantic import BaseModel, ConfigDict

# Note: We use dt.date and dt.datetime in type annotations for fields named
# 'date' to avoid Pydantic v2 name-shadowing resolution issues where the
# field's default value (None) causes the type to resolve to NoneType.
date = dt.date
datetime = dt.datetime


# ──────────────────────────────────────────────
# DataSource
# ──────────────────────────────────────────────
class DataSourceCreate(BaseModel):
    name: str
    source_type: str
    config_json: Optional[Any] = None
    is_active: bool = True


class DataSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    source_type: str
    config_json: Optional[Any] = None
    is_active: bool
    created_at: datetime


class DataSourceList(BaseModel):
    items: List[DataSourceRead]
    total: int


# ──────────────────────────────────────────────
# Campaign
# ──────────────────────────────────────────────
class CampaignCreate(BaseModel):
    data_source_id: int
    external_id: Optional[str] = None
    name: str
    campaign_type: str = "unknown"
    channel: Optional[str] = None
    status: str = "active"


class CampaignRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    data_source_id: int
    external_id: Optional[str] = None
    name: str
    campaign_type: str
    channel: Optional[str] = None
    status: str
    created_at: datetime


class CampaignList(BaseModel):
    items: List[CampaignRead]
    total: int


class CampaignSummary(BaseModel):
    total_campaigns: int
    total_spend: float
    total_revenue: float
    total_conversions: float
    overall_roas: float
    by_type: dict


# ──────────────────────────────────────────────
# DailyMetrics
# ──────────────────────────────────────────────
class DailyMetricsCreate(BaseModel):
    campaign_id: int
    date: dt.date
    impressions: int = 0
    clicks: int = 0
    cost: float = 0.0
    conversions: float = 0.0
    revenue: float = 0.0
    new_customers: int = 0
    returning_customers: int = 0
    orders: int = 0
    cogs: float = 0.0
    gross_margin: float = 0.0


class DailyMetricsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    date: dt.date
    impressions: int
    clicks: int
    cost: float
    conversions: float
    revenue: float
    new_customers: int
    returning_customers: int
    orders: int
    cogs: float
    gross_margin: float
    created_at: datetime


class DailyMetricsList(BaseModel):
    items: List[DailyMetricsRead]
    total: int


class AggregatedDailyMetrics(BaseModel):
    date: dt.date
    campaign_type: Optional[str] = None
    impressions: int
    clicks: int
    cost: float
    conversions: float
    revenue: float
    roas: float
    ctr: float
    cpa: float
    new_customers: int
    returning_customers: int
    orders: int


class BrandVsNonbrand(BaseModel):
    date: dt.date
    brand_cost: float
    brand_revenue: float
    brand_roas: float
    brand_conversions: float
    nonbrand_cost: float
    nonbrand_revenue: float
    nonbrand_roas: float
    nonbrand_conversions: float


class KpiSummary(BaseModel):
    total_spend: float
    total_revenue: float
    total_conversions: float
    roas: float
    cpa: float
    mer: float
    new_customer_pct: float
    total_orders: int
    total_new_customers: int
    total_returning_customers: int
    avg_order_value: float
    total_gross_margin: float


# ──────────────────────────────────────────────
# SearchTerm
# ──────────────────────────────────────────────
class SearchTermCreate(BaseModel):
    campaign_id: int
    term: str
    classification: str = "unknown"
    match_type: Optional[str] = None
    date: Optional[dt.date] = None
    impressions: int = 0
    clicks: int = 0
    cost: float = 0.0
    conversions: float = 0.0
    revenue: float = 0.0


class SearchTermRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    term: str
    classification: str
    match_type: Optional[str] = None
    date: Optional[dt.date] = None
    impressions: int
    clicks: int
    cost: float
    conversions: float
    revenue: float


class SearchTermList(BaseModel):
    items: List[SearchTermRead]
    total: int


class ClassificationCoverage(BaseModel):
    total_terms: int
    brand_count: int
    nonbrand_count: int
    competitor_count: int
    unknown_count: int
    brand_pct: float
    nonbrand_pct: float
    competitor_pct: float
    unknown_pct: float


# ──────────────────────────────────────────────
# BrandKeyword
# ──────────────────────────────────────────────
class BrandKeywordCreate(BaseModel):
    keyword: str
    match_type: str = "contains"
    classification: str = "brand"
    is_active: bool = True


class BrandKeywordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    keyword: str
    match_type: str
    classification: str
    is_active: bool
    created_at: datetime


class BrandKeywordList(BaseModel):
    items: List[BrandKeywordRead]
    total: int


# ──────────────────────────────────────────────
# OrganicMetrics
# ──────────────────────────────────────────────
class OrganicMetricsCreate(BaseModel):
    date: dt.date
    source: str
    organic_sessions: int = 0
    organic_revenue: float = 0.0
    organic_conversions: float = 0.0
    brand_organic_sessions: int = 0
    nonbrand_organic_sessions: int = 0


class OrganicMetricsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: dt.date
    source: str
    organic_sessions: int
    organic_revenue: float
    organic_conversions: float
    brand_organic_sessions: int
    nonbrand_organic_sessions: int


class OrganicMetricsList(BaseModel):
    items: List[OrganicMetricsRead]
    total: int


# ──────────────────────────────────────────────
# ShopifyOrder
# ──────────────────────────────────────────────
class ShopifyOrderCreate(BaseModel):
    external_id: Optional[str] = None
    date: dt.date
    revenue: float = 0.0
    cogs: float = 0.0
    gross_margin: float = 0.0
    new_customer: bool = False
    source_channel: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    promo_code: Optional[str] = None


class ShopifyOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: Optional[str] = None
    date: dt.date
    revenue: float
    cogs: float
    gross_margin: float
    new_customer: bool
    source_channel: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    promo_code: Optional[str] = None
    created_at: datetime


class ShopifyOrderList(BaseModel):
    items: List[ShopifyOrderRead]
    total: int


# ──────────────────────────────────────────────
# ContextualData
# ──────────────────────────────────────────────
class ContextualDataCreate(BaseModel):
    date: dt.date
    day_of_week: Optional[str] = None
    month: Optional[str] = None
    season: Optional[str] = None
    temperature_c: Optional[float] = None
    weather_condition: Optional[str] = None
    is_promo: bool = False
    promo_name: Optional[str] = None
    stock_status: Optional[str] = None
    notes: Optional[str] = None


class ContextualDataRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: dt.date
    day_of_week: Optional[str] = None
    month: Optional[str] = None
    season: Optional[str] = None
    temperature_c: Optional[float] = None
    weather_condition: Optional[str] = None
    is_promo: bool
    promo_name: Optional[str] = None
    stock_status: Optional[str] = None
    notes: Optional[str] = None


class ContextualDataList(BaseModel):
    items: List[ContextualDataRead]
    total: int


# ──────────────────────────────────────────────
# Experiment
# ──────────────────────────────────────────────
class ExperimentCreate(BaseModel):
    name: str
    experiment_type: str
    status: str = "draft"
    start_date: Optional[dt.date] = None
    end_date: Optional[dt.date] = None
    treatment_description: Optional[str] = None
    control_description: Optional[str] = None
    config_json: Optional[Any] = None


class ExperimentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    experiment_type: str
    status: str
    start_date: Optional[dt.date] = None
    end_date: Optional[dt.date] = None
    treatment_description: Optional[str] = None
    control_description: Optional[str] = None
    config_json: Optional[Any] = None
    results_json: Optional[Any] = None
    created_at: datetime


class ExperimentList(BaseModel):
    items: List[ExperimentRead]
    total: int


# ──────────────────────────────────────────────
# ClassificationRule
# ──────────────────────────────────────────────
class ClassificationRuleCreate(BaseModel):
    pattern: str
    match_type: str = "contains"
    classification: str
    priority: int = 0
    is_active: bool = True


class ClassificationRuleUpdate(BaseModel):
    pattern: Optional[str] = None
    match_type: Optional[str] = None
    classification: Optional[str] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class ClassificationRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pattern: str
    match_type: str
    classification: str
    priority: int
    is_active: bool
    created_at: datetime


class ClassificationRuleList(BaseModel):
    items: List[ClassificationRuleRead]
    total: int


# ──────────────────────────────────────────────
# Insight
# ──────────────────────────────────────────────
class InsightCreate(BaseModel):
    date: dt.date
    category: str
    title: str
    body: Optional[str] = None
    interpretation: Optional[str] = None
    confidence: str = "medium"
    recommended_action: Optional[str] = None
    evidence_json: Optional[Any] = None


class InsightRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: dt.date
    category: str
    title: str
    body: Optional[str] = None
    interpretation: Optional[str] = None
    confidence: str
    recommended_action: Optional[str] = None
    evidence_json: Optional[Any] = None
    is_dismissed: bool
    created_at: datetime


class InsightList(BaseModel):
    items: List[InsightRead]
    total: int


# ──────────────────────────────────────────────
# Recommendation
# ──────────────────────────────────────────────
class RecommendationCreate(BaseModel):
    date: dt.date
    action: str
    rationale: Optional[str] = None
    expected_effect: Optional[str] = None
    confidence: str = "medium"
    risk: Optional[str] = None
    evidence_json: Optional[Any] = None


class RecommendationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: dt.date
    action: str
    rationale: Optional[str] = None
    expected_effect: Optional[str] = None
    confidence: str
    risk: Optional[str] = None
    evidence_json: Optional[Any] = None
    status: str
    created_at: datetime


class RecommendationList(BaseModel):
    items: List[RecommendationRead]
    total: int


class RecommendationStatusUpdate(BaseModel):
    status: str  # accepted/rejected


# ──────────────────────────────────────────────
# Simulator
# ──────────────────────────────────────────────
class SimulatorInput(BaseModel):
    brand_spend_change_pct: float = 0.0
    nonbrand_spend_change_pct: float = 0.0
    is_promo: bool = False
    context_overrides: Optional[dict] = None


class HistoricalAnalogue(BaseModel):
    date: dt.date
    brand_spend_change: float
    nonbrand_spend_change: float
    revenue_change: float
    was_promo: bool


class SimulatorOutput(BaseModel):
    projected_revenue_change_pct: float
    confidence_low: float
    confidence_high: float
    historical_analogues: List[HistoricalAnalogue]
    warnings: List[str]
