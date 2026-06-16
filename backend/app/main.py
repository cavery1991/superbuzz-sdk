"""
SuperBuzz PPC Analytics - FastAPI Application

eCommerce PPC analytics decision-support system.
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
import random

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import settings
from app.database import engine, Base, SessionLocal
from app.models.campaign import (
    DataSource,
    Campaign,
    DailyMetrics,
    SearchTerm,
    BrandKeyword,
    OrganicMetrics,
    ShopifyOrder,
    ContextualData,
    ClassificationRule,
)
from app.api.routes import (
    campaigns,
    metrics,
    search_terms,
    incrementality,
    causation,
    patterns,
    insights,
    recommendations,
    simulator,
    admin,
)

logger = logging.getLogger(__name__)


def _seed_data_if_empty(db) -> None:
    """Seed the database with sample data if tables are empty."""
    if db.query(DataSource).count() > 0:
        return

    logger.info("Seeding database with sample data...")
    random.seed(42)

    # ── Data Sources ──
    google_ads = DataSource(
        name="Google Ads",
        source_type="google_ads",
        config_json={"account_id": "123-456-7890"},
        is_active=True,
    )
    meta_ads = DataSource(
        name="Meta Ads",
        source_type="meta_ads",
        config_json={"account_id": "act_123456"},
        is_active=True,
    )
    ga4 = DataSource(
        name="GA4",
        source_type="ga4",
        config_json={"property_id": "properties/123456"},
        is_active=True,
    )
    shopify = DataSource(
        name="Shopify",
        source_type="shopify",
        config_json={"shop_domain": "mystore.myshopify.com"},
        is_active=True,
    )
    db.add_all([google_ads, meta_ads, ga4, shopify])
    db.flush()

    # ── Campaigns ──
    campaign_defs = [
        {"ds": google_ads, "name": "Brand - Core Terms", "type": "brand", "channel": "google_search"},
        {"ds": google_ads, "name": "Brand - Misspellings", "type": "brand", "channel": "google_search"},
        {"ds": google_ads, "name": "Nonbrand - Category Terms", "type": "nonbrand", "channel": "google_search"},
        {"ds": google_ads, "name": "Nonbrand - Product Terms", "type": "nonbrand", "channel": "google_search"},
        {"ds": google_ads, "name": "Nonbrand - Competitor Terms", "type": "competitor", "channel": "google_search"},
        {"ds": google_ads, "name": "Shopping - Brand", "type": "brand", "channel": "google_shopping"},
        {"ds": google_ads, "name": "Shopping - Nonbrand", "type": "nonbrand", "channel": "google_shopping"},
        {"ds": google_ads, "name": "Performance Max - All", "type": "unknown", "channel": "google_pmax"},
        {"ds": meta_ads, "name": "Meta - Prospecting LAL", "type": "nonbrand", "channel": "meta_prospecting"},
        {"ds": meta_ads, "name": "Meta - Retargeting", "type": "nonbrand", "channel": "meta_retargeting"},
    ]

    campaigns_list = []
    for cd in campaign_defs:
        c = Campaign(
            data_source_id=cd["ds"].id,
            external_id=f"ext_{random.randint(100000, 999999)}",
            name=cd["name"],
            campaign_type=cd["type"],
            channel=cd["channel"],
            status="active",
        )
        campaigns_list.append(c)
    db.add_all(campaigns_list)
    db.flush()

    # ── Daily Metrics (90 days) ──
    start = date.today() - timedelta(days=90)
    daily_metrics_batch = []
    shopify_orders_batch = []
    organic_batch = []
    context_batch = []

    seasons = {"winter": [12, 1, 2], "spring": [3, 4, 5], "summer": [6, 7, 8], "fall": [9, 10, 11]}
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    weather_options = ["sunny", "cloudy", "rainy", "partly_cloudy", "overcast"]

    promo_dates = set()
    # Add a few promo periods
    promo_start_1 = start + timedelta(days=15)
    for i in range(5):
        promo_dates.add(promo_start_1 + timedelta(days=i))
    promo_start_2 = start + timedelta(days=55)
    for i in range(7):
        promo_dates.add(promo_start_2 + timedelta(days=i))

    for day_offset in range(91):
        current_date = start + timedelta(days=day_offset)
        day_of_week = day_names[current_date.weekday()]
        month_name = current_date.strftime("%B")
        season = "winter"
        for s, months in seasons.items():
            if current_date.month in months:
                season = s
                break

        is_promo = current_date in promo_dates
        is_weekend = current_date.weekday() >= 5

        # Base multipliers
        weekend_mult = 1.15 if is_weekend else 1.0
        promo_mult = 1.4 if is_promo else 1.0

        for c in campaigns_list:
            # Base metrics vary by campaign type and channel
            if c.campaign_type == "brand":
                base_impr = random.randint(2000, 5000)
                base_clicks = int(base_impr * random.uniform(0.08, 0.15))
                base_cost = base_clicks * random.uniform(0.8, 2.5)
                base_conv = int(base_clicks * random.uniform(0.04, 0.10))
                base_aov = random.uniform(60, 120)
            elif c.campaign_type == "nonbrand":
                base_impr = random.randint(5000, 15000)
                base_clicks = int(base_impr * random.uniform(0.02, 0.06))
                base_cost = base_clicks * random.uniform(1.5, 5.0)
                base_conv = int(base_clicks * random.uniform(0.02, 0.05))
                base_aov = random.uniform(50, 100)
            elif c.campaign_type == "competitor":
                base_impr = random.randint(1000, 3000)
                base_clicks = int(base_impr * random.uniform(0.01, 0.04))
                base_cost = base_clicks * random.uniform(3.0, 8.0)
                base_conv = int(base_clicks * random.uniform(0.01, 0.03))
                base_aov = random.uniform(55, 95)
            else:  # unknown / pmax
                base_impr = random.randint(3000, 10000)
                base_clicks = int(base_impr * random.uniform(0.03, 0.07))
                base_cost = base_clicks * random.uniform(1.0, 4.0)
                base_conv = int(base_clicks * random.uniform(0.03, 0.06))
                base_aov = random.uniform(55, 110)

            # Apply multipliers
            clicks = max(1, int(base_clicks * weekend_mult * promo_mult))
            cost = round(base_cost * weekend_mult * promo_mult, 2)
            conversions = max(0, int(base_conv * weekend_mult * promo_mult))
            revenue = round(conversions * base_aov * promo_mult, 2)
            orders = conversions
            new_cust = max(0, int(conversions * random.uniform(0.2, 0.5)))
            returning_cust = conversions - new_cust
            cogs_rate = random.uniform(0.3, 0.5)
            cogs = round(revenue * cogs_rate, 2)
            gross_margin = round(revenue - cogs, 2)

            dm = DailyMetrics(
                campaign_id=c.id,
                date=current_date,
                impressions=int(base_impr * weekend_mult * promo_mult),
                clicks=clicks,
                cost=cost,
                conversions=float(conversions),
                revenue=revenue,
                new_customers=new_cust,
                returning_customers=returning_cust,
                orders=orders,
                cogs=cogs,
                gross_margin=gross_margin,
            )
            daily_metrics_batch.append(dm)

        # ── Organic Metrics ──
        organic_sessions = int(random.uniform(500, 1500) * weekend_mult * (1.1 if is_promo else 1.0))
        brand_org = int(organic_sessions * random.uniform(0.3, 0.5))
        nb_org = organic_sessions - brand_org

        om = OrganicMetrics(
            date=current_date,
            source="ga4",
            organic_sessions=organic_sessions,
            organic_revenue=round(organic_sessions * random.uniform(1.5, 4.0), 2),
            organic_conversions=round(organic_sessions * random.uniform(0.02, 0.05), 2),
            brand_organic_sessions=brand_org,
            nonbrand_organic_sessions=nb_org,
        )
        organic_batch.append(om)

        # ── Shopify Orders ──
        n_orders = random.randint(8, 30)
        if is_promo:
            n_orders = int(n_orders * 1.5)
        for _ in range(n_orders):
            order_rev = round(random.uniform(30, 200), 2)
            order_cogs = round(order_rev * random.uniform(0.3, 0.5), 2)
            channels = ["google", "meta", "organic", "direct", "email", "referral"]
            ch = random.choice(channels)
            so = ShopifyOrder(
                external_id=f"shopify_{random.randint(1000000, 9999999)}",
                date=current_date,
                revenue=order_rev,
                cogs=order_cogs,
                gross_margin=round(order_rev - order_cogs, 2),
                new_customer=random.random() < 0.35,
                source_channel=ch,
                utm_source=ch if ch in ["google", "meta"] else None,
                utm_medium="cpc" if ch in ["google", "meta"] else None,
                utm_campaign=random.choice(["brand", "nonbrand", "retarget"]) if ch in ["google", "meta"] else None,
                promo_code="PROMO20" if is_promo and random.random() < 0.4 else None,
            )
            shopify_orders_batch.append(so)

        # ── Contextual Data ──
        temp = round(random.uniform(-5, 35), 1)
        if season == "winter":
            temp = round(random.uniform(-5, 10), 1)
        elif season == "summer":
            temp = round(random.uniform(20, 35), 1)

        ctx = ContextualData(
            date=current_date,
            day_of_week=day_of_week,
            month=month_name,
            season=season,
            temperature_c=temp,
            weather_condition=random.choice(weather_options),
            is_promo=is_promo,
            promo_name="Spring Sale" if is_promo and current_date < start + timedelta(days=30) else (
                "Summer Blitz" if is_promo else None
            ),
            stock_status="normal",
            notes=None,
        )
        context_batch.append(ctx)

    db.add_all(daily_metrics_batch)
    db.add_all(organic_batch)
    db.add_all(shopify_orders_batch)
    db.add_all(context_batch)

    # ── Brand Keywords ──
    brand_keywords = [
        BrandKeyword(keyword="superbuzz", match_type="contains", classification="brand"),
        BrandKeyword(keyword="super buzz", match_type="contains", classification="brand"),
        BrandKeyword(keyword="superbuz", match_type="contains", classification="brand"),
        BrandKeyword(keyword="sbuzz", match_type="exact", classification="brand"),
        BrandKeyword(keyword="competitorx", match_type="contains", classification="competitor"),
        BrandKeyword(keyword="rivalbrand", match_type="contains", classification="competitor"),
    ]
    db.add_all(brand_keywords)

    # ── Classification Rules ──
    rules = [
        ClassificationRule(pattern="superbuzz", match_type="contains", classification="brand", priority=100),
        ClassificationRule(pattern="super buzz", match_type="contains", classification="brand", priority=100),
        ClassificationRule(pattern="buy .+ online", match_type="regex", classification="nonbrand", priority=50),
        ClassificationRule(pattern="best .+ for", match_type="regex", classification="nonbrand", priority=50),
        ClassificationRule(pattern="competitorx", match_type="contains", classification="competitor", priority=80),
        ClassificationRule(pattern="cheap", match_type="contains", classification="nonbrand", priority=30),
        ClassificationRule(pattern="coupon", match_type="contains", classification="nonbrand", priority=30),
    ]
    db.add_all(rules)

    # ── Search Terms ──
    search_term_data = [
        ("superbuzz shoes", "brand"), ("super buzz sneakers", "brand"),
        ("superbuzz promo code", "brand"), ("sbuzz store", "brand"),
        ("best running shoes", "nonbrand"), ("buy sneakers online", "nonbrand"),
        ("cheap athletic shoes", "nonbrand"), ("comfortable walking shoes", "nonbrand"),
        ("waterproof hiking boots", "nonbrand"), ("mens casual shoes", "nonbrand"),
        ("best shoes for flat feet", "nonbrand"), ("running shoes under 100", "nonbrand"),
        ("competitorx shoes", "competitor"), ("competitorx vs superbuzz", "competitor"),
        ("rivalbrand sneakers", "competitor"),
        ("shoes", "nonbrand"), ("footwear online", "nonbrand"),
    ]
    for term, cls in search_term_data:
        # Pick a random brand or nonbrand campaign
        if cls == "brand":
            camp = [c for c in campaigns_list if c.campaign_type == "brand"][0]
        elif cls == "competitor":
            camp = [c for c in campaigns_list if c.campaign_type == "competitor"][0]
        else:
            camp = [c for c in campaigns_list if c.campaign_type == "nonbrand"][0]

        st = SearchTerm(
            campaign_id=camp.id,
            term=term,
            classification=cls,
            match_type="broad",
            date=date.today() - timedelta(days=random.randint(1, 30)),
            impressions=random.randint(50, 5000),
            clicks=random.randint(5, 500),
            cost=round(random.uniform(5, 500), 2),
            conversions=round(random.uniform(0, 50), 2),
            revenue=round(random.uniform(0, 5000), 2),
        )
        db.add(st)

    db.commit()
    logger.info("Database seeded with sample data.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: create tables and seed data on startup."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _seed_data_if_empty(db)
    except Exception:
        logger.exception("Error seeding database")
        db.rollback()
    finally:
        db.close()
    yield


app = FastAPI(
    title=settings.app_name,
    description=(
        "eCommerce PPC analytics decision-support system. "
        "Provides brand/nonbrand analysis, incrementality estimation, "
        "causal inference, pattern matching, and simulation capabilities."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS Middleware ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Include Routers ──
app.include_router(campaigns.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(search_terms.router, prefix="/api/v1")
app.include_router(incrementality.router, prefix="/api/v1")
app.include_router(causation.router, prefix="/api/v1")
app.include_router(patterns.router, prefix="/api/v1")
app.include_router(insights.router, prefix="/api/v1")
app.include_router(recommendations.router, prefix="/api/v1")
app.include_router(simulator.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": settings.app_name}


# ── Serve Frontend Static Files ──
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """Serve the React SPA for all non-API routes."""
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
else:
    @app.get("/")
    def root():
        """Root endpoint returning app info."""
        return {
            "name": settings.app_name,
            "version": "1.0.0",
            "description": "eCommerce PPC analytics decision-support system",
            "docs_url": "/docs",
            "health_url": "/health",
            "api_prefix": "/api/v1",
        }
